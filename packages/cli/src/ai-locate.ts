// packages/cli/src/ai-locate.ts
// Tiered AI element locator. Off by default (requires ANTHROPIC_API_KEY).
//
// When the deterministic resolver fails on structurally-hard cases (.map()
// iterations, reused component instances, conditional/state-dependent
// rendering), this seeds an LLM with our best-guess candidates AND read-only
// access to the actual source, and asks it to LOCATE the exact node to edit —
// never to edit. The deterministic transform then applies + validates at the
// returned location. Hard guardrails: read-only tools, location-only output,
// this-one-edit-only.
//
// Tiers: tier 1 is a cheap fast model; when it fails OR refuses, tier 2 retries
// with a stronger model, double the budget, one extra read-only tool, and a
// summary of what tier 1 already tried. Tier 2 is automatic (config kill-switch).

import * as fs from "node:fs";
import path from "node:path";

import type { BatchOperation } from "@themelab/shared";

import { executeBatch } from "./batch-transform.js";
import type { BatchResult, OperationResult } from "./batch-transform.js";
import { discoverFile } from "./file-discovery.js";
import { logger, getLogLevel } from "./logger.js";
import {
  resolveProjectFilePath,
  isProjectFilePathSafe,
} from "./path-resolver.js";

const TIER1_MODEL = "claude-haiku-4-5-20251001";
// Exact model string — do NOT append a date suffix (dated variants 404).
const TIER2_MODEL = "claude-sonnet-4-6";
const TIER_BUDGET = {
  1: { maxSteps: 8, maxTokens: 2048 },
  2: { maxSteps: 16, maxTokens: 4096 },
} as const;
const MAX_GREP_RESULTS = 40;
const SOURCE_EXT = new Set([".tsx", ".jsx", ".ts", ".js", ".mdx"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
]);

export type LocateKind =
  | "direct"
  | "map-template"
  | "conditional"
  | "instance"
  | "array-item";

export interface LocateIdentity {
  tagName?: string;
  className?: string;
  parentTagName?: string;
  parentClassName?: string;
  nthOfType?: number;
  componentName?: string;
  text?: string;
  /** Nearby static text (ancestor labels) — anchors computed-value elements. */
  contextText?: string;
}

export interface LocateInput {
  /** Human description of the specific edit to perform. */
  intent: string;
  /** Captured DOM identity of the selected element. */
  identity: LocateIdentity;
  /** Deterministic best-guess candidate locations (hints, not a constraint). */
  candidates: { line: number; col: number; snippet: string }[];
  /** The op's source file (project-relative path + content). */
  primaryFile: { path: string; content: string };
  /** Pre-computed project grep for the element's text (front-loads the answer
   *  so the model usually resolves in one step). */
  textMatches?: { file: string; line: number; text: string }[];
  projectRoot: string;
}

export interface LocateResult {
  /** Project-relative path of the node to edit (may differ from primaryFile). */
  filePath: string;
  line: number;
  col: number;
  kind: LocateKind;
  reasoning: string;
}

/** The AI ran but deliberately gave up, with a user-facing reason. */
export interface LocateFailure {
  cannotLocate: string;
}

export type LocateOutcome = LocateResult | LocateFailure | null;

function isLocateResult(o: LocateOutcome): o is LocateResult {
  return !!o && "filePath" in o;
}

/** User-facing message when the AI itself couldn't resolve the element. */
function aiFailureMessage(answer: LocateOutcome): string {
  if (answer && "cannotLocate" in answer) {
    return `AI couldn't locate this element — ${answer.cannotLocate}`;
  }
  return "The AI couldn't pinpoint this element in the source.";
}

export interface LocateAttemptOptions {
  apiKey: string;
  baseURL?: string;
  model?: string;
  tier: 1 | 2;
  maxSteps: number;
  maxTokens: number;
  /** The locator appends one human-readable line per tool call here — tier 1's
   *  trace becomes tier 2's "what was already tried" context. */
  trace?: string[];
  /** Tier 2 only: what tier 1 explored and why it failed. */
  priorAttempt?: { trace: string[]; failure: string };
}

export type LocateFn = (
  input: LocateInput,
  opts: LocateAttemptOptions
) => Promise<LocateOutcome>;

export interface AiProposal {
  /** Index into the original operations array. */
  index: number;
  op: BatchOperation;
  target: LocateResult;
  /** Human description of the deterministic change (the WHAT), for the confirm UI. */
  intent: string;
}

export interface AiOptions {
  apiKey?: string;
  /** Custom Anthropic-compatible base URL (gateway/proxy). */
  baseURL?: string;
  /** Override the default model. */
  model?: string;
  /** Defaults to !!apiKey. Set false to force-disable (tests / embedding). */
  enableAi?: boolean;
  /** Resolve every op via the locator up front (the "Confirm with AI" path),
   *  instead of trying deterministic first and only escalating failures. */
  forceAi?: boolean;
  /** Tier-2 retry on tier-1 failure/refusal. Absent = no escalation (tests). */
  escalation?: { enabled: boolean; model?: string };
  /** Injectable locator (default = SDK tool-use loop). Tests pass a stub. */
  locate?: LocateFn;
  /** Called when an AI attempt actually starts (not on cache hits) — for a UI
   *  "locating…" indicator. Tier 2 = the escalated retry. */
  onEscalate?: (tier: 1 | 2) => void;
}

export interface AiBatchResult extends BatchResult {
  /** Structural / cross-file resolutions awaiting user confirmation. */
  proposals?: AiProposal[];
}

// ── Read-only project-scoped tools ─────────────────────────────────────────

function numbered(content: string): string {
  return content
    .split("\n")
    .map((l, i) => `${i + 1}: ${l}`)
    .join("\n");
}

export function readFileTool(
  input: { path?: string; offset?: number; limit?: number },
  projectRoot: string
): string {
  const rel = input?.path;
  if (!rel || !isProjectFilePathSafe(rel, projectRoot)) {
    return "ERROR: path outside project";
  }
  const resolved = resolveProjectFilePath(rel, projectRoot);
  if (!resolved) {
    return "ERROR: could not resolve path";
  }
  try {
    const all = fs.readFileSync(resolved, "utf-8").split("\n");
    const start =
      input.offset && input.offset > 0 ? Math.floor(input.offset) : 1; // 1-based
    const limit =
      input.limit && input.limit > 0 ? Math.floor(input.limit) : 500;
    const end = Math.min(all.length, start - 1 + limit);
    // Number with REAL line numbers so resolve_location lines stay correct.
    const body = all
      .slice(start - 1, end)
      .map((l, i) => `${start + i}: ${l}`)
      .join("\n");
    const tail =
      end < all.length
        ? `\n…[${all.length - end} more lines — pass offset:${end + 1} to continue]`
        : "";
    return body.slice(0, 20_000) + tail;
  } catch {
    return "ERROR: could not read file";
  }
}

function listDirTool(input: { path?: string }, projectRoot: string): string {
  const rel = input?.path ?? ".";
  if (!isProjectFilePathSafe(rel, projectRoot)) {
    return "ERROR: path outside project";
  }
  const resolved =
    resolveProjectFilePath(rel, projectRoot) ?? path.resolve(projectRoot, rel);
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return (
      entries
        .filter((e) => !SKIP_DIRS.has(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join("\n") || "(empty)"
    );
  } catch {
    return "ERROR: could not list directory";
  }
}

function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Search project source files for a regex. Returns structured matches. */
function grepProject(
  query: string,
  projectRoot: string,
  max = MAX_GREP_RESULTS
): { file: string; line: number; text: string }[] {
  let re: RegExp;
  try {
    re = new RegExp(query);
  } catch {
    return [];
  }
  const hits: { file: string; line: number; text: string }[] = [];
  const walk = (dir: string) => {
    if (hits.length >= max) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= max) {
        return;
      }
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) {
          walk(path.join(dir, e.name));
        }
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(e.name))) {
        continue;
      }
      const full = path.join(dir, e.name);
      let content: string;
      try {
        content = fs.readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (re.test(lines[i])) {
          hits.push({
            file: path.relative(projectRoot, full),
            line: i + 1,
            text: lines[i].trim().slice(0, 120),
          });
          if (hits.length >= max) {
            break;
          }
        }
      }
    }
  };
  walk(projectRoot);
  return hits;
}

function grepTool(input: { query?: string }, projectRoot: string): string {
  if (!input?.query) {
    return "ERROR: missing query";
  }
  const hits = grepProject(input.query, projectRoot);
  return hits.length > 0
    ? hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join("\n")
    : "(no matches)";
}

// Tier-2 only: the dominant tier-1 failure is "element rendered by a reused
// component defined elsewhere" — this answers that in one step instead of a
// grep-and-guess walk. Read-only like everything else here.
const FIND_COMPONENT_DEFINITION_TOOL = {
  name: "find_component_definition",
  description:
    "Find the source file that DEFINES a React component by name (follows barrel re-exports). Use when the element is rendered by a reused component and you need its definition file.",
  input_schema: {
    type: "object" as const,
    properties: { componentName: { type: "string" } },
    required: ["componentName"],
  },
};

export async function findComponentDefinitionTool(
  input: { componentName?: string },
  projectRoot: string
): Promise<string> {
  const name = input?.componentName?.trim();
  if (!name) {
    return "ERROR: missing componentName";
  }
  try {
    const found = await discoverFile(name, projectRoot);
    return found ?? "(not found)";
  } catch {
    return "(not found)";
  }
}

const TOOLS = [
  {
    name: "read_file",
    description:
      "Read a project source file (project-relative path). Returns numbered lines. Use offset (1-based start line) + limit to read a window of a large file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" },
        offset: {
          type: "number",
          description: "1-based start line (default 1)",
        },
        limit: {
          type: "number",
          description: "max lines to return (default 500)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description:
      "Search project source files for a JS regex. Returns matching 'path:line: text'.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "list_dir",
    description: "List entries under a project-relative directory.",
    input_schema: {
      type: "object" as const,
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "cannot_locate",
    description:
      "Call this if you genuinely cannot identify the exact element to edit — e.g. it's generated dynamically, the relevant data/component isn't in the codebase, or there isn't enough information to be sure. Give a clear one-sentence reason for the user. Prefer this over guessing or returning a wrong location.",
    input_schema: {
      type: "object" as const,
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "resolve_location",
    description:
      "FINAL ANSWER. The single exact source location to edit for THIS change. " +
      "kind: 'direct' (the element itself), 'map-template' (a .map() template — affects all items), " +
      "'conditional' (a branch of conditional/state rendering), 'instance' (inside a reused component).",
    input_schema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string" },
        line: { type: "number" },
        col: { type: "number" },
        kind: {
          type: "string",
          enum: ["direct", "map-template", "conditional", "instance"],
        },
        reasoning: { type: "string" },
      },
      required: ["filePath", "line", "col", "kind", "reasoning"],
    },
  },
];

const SYSTEM_PROMPT = `You are a precise source-location resolver for a React + Tailwind codebase.

Your ONLY job: identify the EXACT source location (file, line, column) that must be edited to fulfill ONE specific change the user made in a visual editor. A deterministic tool already tried and could not disambiguate the element — usually because the DOM does not map 1:1 to the source: a .map() renders many instances from one template, an element lives in a reused component defined elsewhere, or it sits inside conditional/state-dependent rendering.

You may READ code to understand the structure (read_file, grep, list_dir) — follow imports, find where a mapped item or component is defined, inspect conditionals. The owner-stack file/line is often WRONG (it can point at a shared UI primitive like card.tsx instead of the real usage): if the primary file has no matching element, grep the project for the element's distinctive visible text or className to find where it actually lives. You may NOT modify anything, propose other edits, write code, or do anything beyond locating this one element.

When sure, call resolve_location exactly once with the opening-tag position of the node to edit:
- 'direct' — the element itself, in this file.
- 'map-template' — the single JSX template inside a .map() (editing it affects every rendered item).
- 'conditional' — the correct branch of a conditional/ternary/state-driven render.
- 'instance' — the relevant node inside a reused component (possibly another file).
- 'array-item' — for REORDERING a .map()-rendered list item: return the position of the matching ELEMENT in the source data array (the object/value in the array literal that produces this item, identified by its text/label), NOT the JSX. The list is reordered by swapping array data.

If, after investigating, you genuinely cannot pinpoint the element, call cannot_locate with a clear one-sentence reason — do NOT guess or return a wrong/parent node.

Be decisive: if a provided candidate or text-grep line clearly matches the element (its text and/or className line up), call resolve_location immediately — don't keep exploring. The 'col' is the 0-based column of the opening '<'. 'reasoning' is ONE sentence on WHY this is the right node (which file/element and how you identified it) — do NOT restate or guess the styling change; that is applied deterministically.`;

function buildSeedMessage(
  input: LocateInput,
  priorAttempt?: LocateAttemptOptions["priorAttempt"]
): string {
  const id = input.identity;
  const idLines = [
    id.componentName ? `  component: ${id.componentName}` : "",
    id.tagName ? `  tag: <${id.tagName}>` : "",
    id.className ? `  className (DOM): "${id.className}"` : "",
    id.parentTagName
      ? `  parent: <${id.parentTagName}>${id.parentClassName ? ` class="${id.parentClassName}"` : ""}`
      : "",
    id.nthOfType === undefined ? "" : `  nthOfType: ${id.nthOfType}`,
    id.text ? `  text: "${id.text.slice(0, 80)}"` : "",
    id.contextText
      ? `  surrounding text: "${id.contextText.slice(0, 160)}"  (the element's own text may be a COMPUTED value like {count}; use these nearby static labels — e.g. a card title — to find the right one of several identical elements)`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const cands = input.candidates.length
    ? input.candidates
        .map((c, i) => `  ${i + 1}. line ${c.line}, col ${c.col}: ${c.snippet}`)
        .join("\n")
    : "  (none — the element may be a map template, a conditional branch, or in another file)";

  const textGrep =
    input.textMatches && input.textMatches.length
      ? `\n## Project lines containing the element's text (strong hint — the target is very likely one of these)\n${input.textMatches.map((m) => `  ${m.file}:${m.line}: ${m.text}`).join("\n")}\n`
      : "";

  // Tier 2: tier 1's failed exploration is valuable negative information —
  // a compact trace, not the transcript.
  const prior = priorAttempt
    ? `\n## Previous attempt (smaller model) — FAILED
It explored the following and could not resolve (don't repeat dead ends; consider what it missed):
${priorAttempt.trace.length ? priorAttempt.trace.map((t) => `  - ${t}`).join("\n") : "  (no tool calls recorded)"}
Outcome: ${priorAttempt.failure}\n`
    : "";

  return `## Change to locate
${input.intent}

## Selected element identity
${idLines}

## Deterministic best-guess candidates (hints — the true target may be elsewhere)
${cands}
${textGrep}${prior}
## Primary file: ${input.primaryFile.path}
\`\`\`tsx
${numbered(input.primaryFile.content)}
\`\`\`

Locate the exact node to edit and call resolve_location.`;
}

/** Light validation of the model's answer — deeper "is a real JSX node" check
 *  happens when the deterministic transform re-runs at this location. */
export function validateAnswer(
  ans: unknown,
  projectRoot: string
): LocateResult | null {
  if (!ans || typeof ans !== "object") {
    return null;
  }
  const { filePath, line, col, kind, reasoning } = ans as Record<
    string,
    unknown
  >;
  if (
    typeof filePath !== "string" ||
    !isProjectFilePathSafe(filePath, projectRoot)
  ) {
    return null;
  }
  if (typeof line !== "number" || line < 1) {
    return null;
  }
  if (typeof col !== "number" || col < 0) {
    return null;
  }
  if (typeof kind !== "string") {
    return null;
  }
  const validKinds: LocateKind[] = [
    "direct",
    "map-template",
    "conditional",
    "instance",
    "array-item",
  ];
  if (!validKinds.includes(kind as LocateKind)) {
    return null;
  }
  return {
    filePath,
    line,
    col,
    kind: kind as LocateKind,
    reasoning: typeof reasoning === "string" ? reasoning : "",
  };
}

// ── Default locator: SDK tool-use loop (lazy-imported) ─────────────────────

// Minimal local shape of the Anthropic SDK surface we actually use — the SDK
// is lazy-imported (optional dependency), so we don't take a static type
// dependency on its exact (overloaded) types.
interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  cache_control?: { type: "ephemeral" };
  tool_use_id?: string;
  content?: string;
}
interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface AnthropicMessage {
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: AnthropicUsage;
}
interface AnthropicClientInstance {
  messages: {
    create: (params: Record<string, unknown>) => Promise<AnthropicMessage>;
  };
}
type AnthropicCtor = new (opts: {
  apiKey: string;
  baseURL?: string;
}) => AnthropicClientInstance;

async function getAnthropicClient(
  apiKey: string,
  baseURL: string | undefined,
  logPrefix: string
): Promise<AnthropicClientInstance | null> {
  try {
    const mod = await import("@anthropic-ai/sdk");
    const Ctor = mod.default as unknown as AnthropicCtor;
    return new Ctor(baseURL ? { apiKey, baseURL } : { apiKey });
  } catch (error) {
    logger.warn(
      `${logPrefix} @anthropic-ai/sdk not available:`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

async function callAnthropicStep(
  client: AnthropicClientInstance,
  model: string,
  maxTokens: number,
  tools: Record<string, unknown>[],
  messages: { role: string; content: AnthropicContentBlock[] }[]
): Promise<AnthropicMessage | null> {
  try {
    return await client.messages.create({
      model,
      max_tokens: maxTokens,
      // Locating is a precision task — pin the sampling. NOTE: drop this if an
      // Opus 4.7+ model is ever configured here (those reject temperature).
      temperature: 0,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools,
      messages,
    });
  } catch (error) {
    logger.warn(
      "[ai-locate] API error:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

function logVerboseRequest(
  tier: 1 | 2,
  model: string,
  seedBlock: AnthropicContentBlock,
  tools: Record<string, unknown>[]
): void {
  logger.debug(
    `\n════════ [ai-locate] REQUEST (tier ${tier}) → ${model} ════════`
  );
  logger.debug(`──── system prompt ────\n${SYSTEM_PROMPT}`);
  logger.debug(`──── user seed ────\n${seedBlock.text}`);
  logger.debug(`──── tools ────\n${tools.map((t) => t.name).join(", ")}`);
}

function accumulateUsage(
  usage: { in: number; out: number; cacheRead: number; cacheWrite: number },
  respUsage: AnthropicUsage | undefined
): void {
  if (!respUsage) {
    return;
  }
  usage.in += respUsage.input_tokens ?? 0;
  usage.out += respUsage.output_tokens ?? 0;
  usage.cacheRead += respUsage.cache_read_input_tokens ?? 0;
  usage.cacheWrite += respUsage.cache_creation_input_tokens ?? 0;
}

function logVerboseStep(
  tier: 1 | 2,
  step: number,
  resp: AnthropicMessage
): void {
  const u = resp.usage
    ? ` · tokens in=${resp.usage.input_tokens} (cache read ${resp.usage.cache_read_input_tokens ?? 0}) out=${resp.usage.output_tokens}`
    : "";
  logger.debug(
    `\n──── [ai-locate] tier ${tier} step ${step + 1} ← ${resp.stop_reason ?? "?"}${u} ────`
  );
  for (const b of resp.content ?? []) {
    if (b.type === "text") {
      logger.debug(`  [text] ${b.text}`);
    } else if (b.type === "tool_use") {
      logger.debug(`  [tool_use] ${b.name}(${JSON.stringify(b.input)})`);
    }
  }
}

type StepOutcome = { done: true; outcome: LocateOutcome } | { done: false };

/** Check whether this tool call is a terminal answer (cannot_locate /
 *  resolve_location) — returns `done: false` for exploratory tools. */
function checkTerminalTool(
  tu: AnthropicContentBlock,
  tier: 1 | 2,
  projectRoot: string,
  verbose: boolean
): StepOutcome {
  if (tu.name === "cannot_locate") {
    const reasonInput = tu.input?.reason;
    const reason =
      typeof reasonInput === "string" && reasonInput.trim()
        ? reasonInput.trim()
        : "couldn't determine the source location.";
    if (verbose) {
      logger.debug(`  [cannot_locate] ${reason}`);
    }
    logger.info(`[ai-locate] tier ${tier} cannot_locate: ${reason}`);
    return { done: true, outcome: { cannotLocate: reason } };
  }
  if (tu.name === "resolve_location") {
    const answer = validateAnswer(tu.input, projectRoot);
    if (verbose) {
      logger.debug(
        `  [resolve_location] input=${JSON.stringify(tu.input)} → ${answer ? "accepted" : "REJECTED (out-of-project / bad shape)"}`
      );
    }
    logger.debug(
      `[ai-locate] resolve_location → ${answer ? `${answer.filePath}:${answer.line}:${answer.col} (${answer.kind})` : "invalid"}`
    );
    return { done: true, outcome: answer };
  }
  return { done: false };
}

/** Run one read-only exploration tool call and return its text output. */
async function executeToolCall(
  tu: AnthropicContentBlock,
  projectRoot: string,
  trace: string[] | undefined
): Promise<string> {
  const toolInput = (tu.input ?? {}) as {
    path?: string;
    offset?: number;
    limit?: number;
    query?: string;
    componentName?: string;
  };
  if (tu.name === "read_file") {
    const out = readFileTool(toolInput, projectRoot);
    trace?.push(
      `read_file ${toolInput.path ?? "?"}${toolInput.offset ? ` (offset ${toolInput.offset})` : ""}`
    );
    return out;
  }
  if (tu.name === "grep") {
    const out = grepTool(toolInput, projectRoot);
    trace?.push(
      `grep /${toolInput.query ?? "?"}/ → ${out === "(no matches)" ? "0 hits" : `${out.split("\n").length} hits`}`
    );
    return out;
  }
  if (tu.name === "list_dir") {
    const out = listDirTool(toolInput, projectRoot);
    trace?.push(`list_dir ${toolInput.path ?? "."}`);
    return out;
  }
  if (tu.name === "find_component_definition") {
    const out = await findComponentDefinitionTool(toolInput, projectRoot);
    trace?.push(
      `find_component_definition ${toolInput.componentName ?? "?"} → ${out}`
    );
    return out;
  }
  return "ERROR: unknown tool";
}

// --verbose: dump exactly what we send and what the model sends back.
function vtrunc(s: string, n = 4000): string {
  return s.length > n
    ? `${s.slice(0, n)}\n…[+${s.length - n} chars truncated]`
    : s;
}

/** Run every tool call in one agentic turn, in order. Returns the terminal
 *  outcome if resolve_location/cannot_locate was called, else the tool_result
 *  blocks to send back for the next turn. */
async function runToolTurn(
  toolUses: AnthropicContentBlock[],
  tier: 1 | 2,
  projectRoot: string,
  trace: string[] | undefined,
  verbose: boolean
): Promise<{ terminal: LocateOutcome } | { results: AnthropicContentBlock[] }> {
  const toolResults: AnthropicContentBlock[] = [];
  for (const tu of toolUses) {
    const terminal = checkTerminalTool(tu, tier, projectRoot, verbose);
    if (terminal.done) {
      return { terminal: terminal.outcome };
    }
    // Tool calls within one turn are processed in order: find_component_definition
    // is async and its trace entry (and the tool_result it produces) must stay
    // ordered relative to any sibling tool calls in the same turn.
    // oxlint-disable-next-line no-await-in-loop -- ordered tool execution within one agentic turn (trace + tool_use_id ordering)
    const out = await executeToolCall(tu, projectRoot, trace);
    if (verbose) {
      logger.debug(
        `  [tool_result] ${tu.name}(${JSON.stringify(tu.input)}) →\n${vtrunc(out)}`
      );
    }
    toolResults.push({
      type: "tool_result",
      tool_use_id: tu.id,
      content: out,
    });
  }
  return { results: toolResults };
}

export const defaultLocate: LocateFn = async (input, opts) => {
  const { apiKey, baseURL, tier, maxSteps, maxTokens, trace, priorAttempt } =
    opts;
  const model = opts.model || (tier === 2 ? TIER2_MODEL : TIER1_MODEL);
  const client = await getAnthropicClient(apiKey, baseURL, "[ai-locate]");
  if (!client) {
    return null;
  }
  const tools =
    tier === 2
      ? [
          ...TOOLS.slice(0, 3),
          FIND_COMPONENT_DEFINITION_TOOL,
          ...TOOLS.slice(3),
        ]
      : TOOLS;

  // Prompt caching: the loop re-sends the whole prefix every step (up to
  // maxSteps×). Breakpoints: system prompt + the seed message (it embeds the
  // full primary file — first prefix big enough to clear the model's minimum
  // cacheable size) + a MOVING breakpoint on the latest tool_result (the prior
  // turn's marker is stripped each step so we never exceed the 4-breakpoint cap).
  const seedBlock: AnthropicContentBlock = {
    type: "text",
    text: buildSeedMessage(input, priorAttempt),
    cache_control: { type: "ephemeral" },
  };
  const messages: { role: string; content: AnthropicContentBlock[] }[] = [
    { role: "user", content: [seedBlock] },
  ];
  let lastMarkedBlock: AnthropicContentBlock | null = null;
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, steps: 0 };

  const finish = (outcome: LocateOutcome): LocateOutcome => {
    logger.info(
      `[ai-locate] tier ${tier} (${model}): ${usage.steps} step${usage.steps === 1 ? "" : "s"} · tokens in=${usage.in} (cached ${usage.cacheRead}) out=${usage.out}`
    );
    return outcome;
  };

  const verbose = getLogLevel() === "debug";
  if (verbose) {
    logVerboseRequest(tier, model, seedBlock, tools);
  }

  for (let step = 0; step < maxSteps; step += 1) {
    // Sequential agentic tool-use turns — each step depends on the model's
    // response to the previous one, so these calls cannot run in parallel.
    // oxlint-disable-next-line no-await-in-loop -- sequential agentic tool-use loop; each turn depends on the previous model response
    const resp = await callAnthropicStep(
      client,
      model,
      maxTokens,
      tools,
      messages
    );
    if (!resp) {
      return finish(null);
    }
    usage.steps += 1;
    accumulateUsage(usage, resp.usage);

    if (verbose) {
      logVerboseStep(tier, step, resp);
    }

    const toolUses = (resp.content ?? []).filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      return finish(null);
    } // no tool call — give up (fail safe)

    messages.push({ role: "assistant", content: resp.content ?? [] });

    // Sequential turns: each turn's tool calls are awaited in order within
    // runToolTurn (see its own no-await-in-loop disable-line).
    // oxlint-disable-next-line no-await-in-loop -- sequential agentic tool-use loop; each turn depends on the previous model response
    const turn = await runToolTurn(
      toolUses,
      tier,
      input.projectRoot,
      trace,
      verbose
    );
    if ("terminal" in turn) {
      return finish(turn.terminal);
    }
    const toolResults = turn.results;
    // Move the cache breakpoint to this turn's last tool_result.
    if (lastMarkedBlock) {
      delete lastMarkedBlock.cache_control;
    }
    lastMarkedBlock = toolResults.at(-1) ?? null;
    if (lastMarkedBlock) {
      lastMarkedBlock.cache_control = { type: "ephemeral" };
    }
    messages.push({ role: "user", content: toolResults });
  }
  logger.debug(
    `[ai-locate] tier ${tier} exhausted maxSteps without resolve_location`
  );
  return finish(null);
};

// ── Intent / identity extraction from an op ────────────────────────────────

/** Generic accessor for BatchOperation's common optional fields. Used by
 *  describeIntent/identityOf/cacheKey, which read across every locatable
 *  operation kind ("reorder" is filtered out before ever reaching them). */
interface OpCommonFields {
  file: string;
  line?: number;
  col?: number;
  tagName?: string;
  className?: string;
  parentTagName?: string;
  parentClassName?: string;
  nthOfType?: number;
  componentName?: string;
  text?: string;
  originalText?: string;
  newText?: string;
  contextText?: string;
  axis?: string;
  direction?: string;
  updates?: {
    tailwindPrefix: string;
    tailwindToken: string | null;
    value: string;
  }[];
}

function opFields(op: BatchOperation): OpCommonFields {
  return op as OpCommonFields;
}

/** Cache key for an op's resolution — text + structural context, not just the
 *  (often mis-resolved, shared) owner-stack coords: sibling instances with
 *  identical file/line/col/tag/className (e.g. four <h4 className="font-medium">)
 *  would otherwise collide and all resolve to whichever was cached first. */
function cacheKey(op: BatchOperation): string {
  const o = opFields(op);
  return [
    o.file,
    o.line,
    o.col,
    o.tagName ?? "",
    o.className ?? "",
    o.text ?? o.originalText ?? "",
    o.nthOfType ?? "",
    o.parentClassName ?? "",
  ].join("|");
}

function describeIntent(op: BatchOperation): string {
  const o = opFields(op);
  switch (op.op) {
    case "updateClass": {
      const changes = (o.updates ?? [])
        .map((u) => {
          const suffix = u.tailwindToken || u.value; // token holds the real class suffix
          return suffix ? `${u.tailwindPrefix}-${suffix}` : u.tailwindPrefix;
        })
        .join(", ");
      return `Apply Tailwind class(es) [${changes || "class edit"}] to the selected <${o.tagName ?? "element"}>${o.text ? ` (text: "${String(o.text).slice(0, 40)}")` : ""}.`;
    }
    case "updateText": {
      return `Change text "${(o.originalText ?? "").slice(0, 60)}" → "${(o.newText ?? "").slice(0, 60)}".`;
    }
    case "moveSpacing": {
      return `Adjust spacing (${o.axis}-axis) on the selected <${o.tagName ?? "element"}>.`;
    }
    case "moveSibling": {
      return `The user wants to reorder the selected ${o.componentName ? `<${o.componentName}>` : `<${o.tagName ?? "element"}>`}${o.text ? ` (text: "${String(o.text).slice(0, 50)}")` : ""} ${o.direction} among its siblings. Find WHERE it is rendered:
- If it is a LITERAL JSX element written out alongside sibling elements of the same kind (e.g. one of several <Card> spelled out in a grid), return THAT element as 'direct'.
- If it is rendered by a .map() over an array (a list item), the order comes from the DATA. Find the matching element in the source array literal (the object whose label/text is "${String(o.text ?? "").slice(0, 40)}") and return ITS position with kind 'array-item' — we'll swap the array data. If you can't find the array, return 'map-template'.
- NEVER climb up to a parent/ancestor component and return that instead — moving a parent (e.g. the whole <Sidebar/>) is never the intent.`;
    }
    default: {
      return `Edit the selected <${o.tagName ?? "element"}> (${op.op}).`;
    }
  }
}

function identityOf(op: BatchOperation): LocateIdentity {
  const o = opFields(op);
  return {
    tagName: o.tagName,
    className: o.className,
    parentTagName: o.parentTagName,
    parentClassName: o.parentClassName,
    nthOfType: o.nthOfType,
    componentName: o.componentName,
    text: o.text ?? o.originalText,
    contextText: o.contextText,
  };
}

function isEscalatable(r: OperationResult, op?: BatchOperation): boolean {
  if (r.success) {
    return false;
  }
  const e = r.error ?? "";
  if (e.startsWith("FILE_CHANGED:")) {
    return false;
  } // stale → re-select, never escalate
  // Escalate on ambiguity OR no-match — the no-match-with-zero-candidates case
  // (element rendered by a reused component / not in this file) is exactly what
  // the locator's code-reading is for. Candidates may be empty.
  if (e.startsWith("AMBIGUOUS:") || e.startsWith("No JSX element found")) {
    return true;
  }
  // A moveSibling that resolved to an element with NO siblings is almost always
  // the wrong node (owner stack pointed at a component's internal root, e.g.
  // <Card>'s root <div>). Escalate to find the real usage that has siblings.
  // Do NOT escalate a genuine first/last-sibling boundary.
  if (
    op?.op === "moveSibling" &&
    /no sibling container|could not locate this element among/i.test(e)
  ) {
    return true;
  }
  return false;
}

// Per-element resolution cache: property scrubbing fires many commits for the
// same element, so cache WHERE (not the edit value). Positive results live for
// the process; negatives expire so a fix (e.g. enabling AI) can retry.
const NEG_TTL_MS = 60_000;
const locateCache = new Map<
  string,
  { result: LocateOutcome; at: number; maxTierTried: 1 | 2 }
>();

function highestEnabledTier(ai: AiOptions): 1 | 2 {
  return ai.escalation?.enabled ? 2 : 1;
}

/** Drop a cached resolution so a retry re-resolves from scratch — called
 *  whenever an AI-resolved change fails to apply for any reason. */
export function invalidateLocateCache(op: BatchOperation): void {
  locateCache.delete(cacheKey(op));
}

/** Pick the most useful grep query: the element's own text if it's a real label,
 *  otherwise a distinctive static phrase from the surrounding text (when the own
 *  text is a computed value like {count} or "20%"). */
function longestAlphaPhrase(s?: string): string | undefined {
  // Longest run of letters/spaces — skips embedded computed values ("Users 6
  // registered users" → "registered users"), digits, %, etc.
  const phrases = (s ?? "").match(/[A-Za-z][A-Za-z ]{2,}[A-Za-z]/g);
  // toSorted() would need ES2023 lib, which this project's tsconfig (target
  // ES2022) doesn't enable — sort() here is safe: it mutates a fresh spread
  // copy, never the original match array.
  // oxlint-disable-next-line unicorn/no-array-sort -- toSorted() needs ES2023 lib (project targets ES2022); this sorts a fresh spread copy, not the original array
  return [...(phrases ?? [])].sort((a, b) => b.length - a.length)[0]?.trim();
}

function pickGrepQuery(id: LocateIdentity): string | undefined {
  const fromText = longestAlphaPhrase(id.text);
  if (fromText && fromText.length >= 4) {
    return fromText;
  }
  const fromCtx = longestAlphaPhrase(id.contextText);
  return fromCtx && fromCtx.length >= 4 ? fromCtx : undefined;
}

/** Grep the project for the element's text (or a surrounding label), ranking
 *  element-like lines first. */
function computeTextMatches(
  id: LocateIdentity,
  projectRoot: string
): { file: string; line: number; text: string }[] | undefined {
  const query = pickGrepQuery(id);
  if (!query || query.length < 3) {
    return undefined;
  }
  const classTokens = (id.className ?? "").split(/\s+/).filter(Boolean);
  const found = grepProject(escapeRegExp(query), projectRoot, 60);
  const score = (m: { text: string }) =>
    (id.tagName && m.text.includes(`<${id.tagName}`) ? 2 : 0) +
    (classTokens.some((c) => m.text.includes(c)) ? 1 : 0);
  found.sort((a, b) => score(b) - score(a));
  return found.slice(0, 12);
}

/** Apply an AI answer: auto-apply 'direct'/'conditional', else return a proposal. */
function applyAnswer(
  op: BatchOperation,
  index: number,
  answer: LocateResult,
  projectRoot: string
): {
  result?: OperationResult;
  undoEntries?: AiBatchResult["undoEntries"];
  proposal?: AiProposal;
} {
  // Reordering a .map() list → swap the source array data. Editing data is a
  // bit higher-stakes, so always confirm — surface it as a reorderArrayItem
  // proposal at the array element's location.
  if (answer.kind === "array-item" && op.op === "moveSibling") {
    const arrayOp = {
      op: "reorderArrayItem",
      file: answer.filePath,
      line: answer.line,
      col: answer.col,
      direction: op.direction,
    } as BatchOperation;
    return {
      proposal: {
        index,
        op: arrayOp,
        target: answer,
        intent: `Reorder the list (swap the array item ${op.direction})`,
      },
    };
  }

  const autoApply = answer.kind === "direct" || answer.kind === "conditional";
  if (autoApply) {
    const rerun = executeBatch(
      [
        {
          ...op,
          file: answer.filePath,
          line: answer.line,
          col: answer.col,
          fileMtime: undefined,
          fileSize: undefined,
          trustLocation: true,
        } as BatchOperation,
      ],
      projectRoot
    );
    const [rr] = rerun.results;
    if (rr?.success) {
      return {
        result: {
          ...rr,
          file: answer.filePath,
          resolvedBy: "ai",
          aiKind: answer.kind,
          aiReasoning: answer.reasoning,
        },
        undoEntries: rerun.undoEntries,
      };
    }
    return {}; // didn't apply cleanly
  }
  return {
    proposal: { index, op, target: answer, intent: describeIntent(op) },
  };
}

// ── Orchestrator ───────────────────────────────────────────────────────────

/** Positive resolutions cache for the process. Negatives (null / cannot_locate)
 *  expire after the TTL, and are only honored when they were produced at the
 *  highest tier we'd run now — a tier-1-only negative must not block a tier-2
 *  retry after escalation is enabled. Returns `undefined` on a cache miss. */
function getCachedLocate(
  key: string,
  ai: AiOptions
): LocateOutcome | undefined {
  const cached = locateCache.get(key);
  if (
    cached &&
    (isLocateResult(cached.result) ||
      (Date.now() - cached.at < NEG_TTL_MS &&
        cached.maxTierTried >= highestEnabledTier(ai)))
  ) {
    return cached.result;
  }
  return undefined;
}

function buildLocateInput(
  op: BatchOperation,
  candidates: { line: number; col: number; snippet: string }[],
  projectRoot: string
): LocateInput {
  const resolved = resolveProjectFilePath(op.file, projectRoot);
  let content = "";
  if (resolved) {
    try {
      content = fs.readFileSync(resolved, "utf-8");
    } catch {
      /* unreadable */
    }
  }
  const id = identityOf(op);
  return {
    intent: describeIntent(op),
    identity: id,
    candidates,
    primaryFile: { path: op.file, content },
    textMatches: computeTextMatches(id, projectRoot),
    projectRoot,
  };
}

/** Run one tier of the locator, swallowing/logging errors as a null outcome
 *  (matching the pre-refactor try/catch-per-tier behavior). */
async function runTierLocate(
  input: LocateInput,
  ai: AiOptions,
  locate: LocateFn,
  apiKey: string,
  tier: 1 | 2,
  trace: string[],
  priorAttempt?: LocateAttemptOptions["priorAttempt"]
): Promise<LocateOutcome> {
  const model =
    tier === 2
      ? (ai.escalation?.model ?? TIER2_MODEL)
      : (ai.model ?? TIER1_MODEL);
  try {
    return await locate(input, {
      apiKey,
      baseURL: ai.baseURL,
      model,
      tier,
      ...TIER_BUDGET[tier],
      // Only tier 1 records its own exploration into `trace` — tier 2 receives
      // that trace as read-only prior-attempt context instead.
      trace: tier === 1 ? trace : undefined,
      priorAttempt,
    });
  } catch (error) {
    logger.warn(
      `[ai-locate] ${tier === 2 ? "tier-2 " : ""}locator threw:`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

function describeAnswerForLog(answer: LocateOutcome): string {
  if (isLocateResult(answer)) {
    return `${answer.filePath}:${answer.line} (${answer.kind})`;
  }
  if (answer) {
    return `cannot_locate: ${answer.cannotLocate}`;
  }
  return "no resolution";
}

/**
 * Run the deterministic batch, then escalate unresolved structural cases to the
 * AI locator. 'direct' same-file resolutions apply immediately; structural /
 * cross-file resolutions are returned as proposals for user confirmation.
 */
async function locateOp(
  op: BatchOperation,
  candidates: { line: number; col: number; snippet: string }[],
  ai: AiOptions,
  locate: LocateFn,
  projectRoot: string,
  useCache: boolean
): Promise<LocateOutcome> {
  const key = cacheKey(op);
  if (useCache) {
    const cached = getCachedLocate(key, ai);
    if (cached !== undefined) {
      return cached;
    }
  }

  const { apiKey } = ai;
  if (!apiKey) {
    // Invariant: callers (executeBatchWithAi / forcedAiBatch) only reach
    // locateOp once an apiKey is confirmed present — this is a safety net.
    return null;
  }

  const input = buildLocateInput(op, candidates, projectRoot);

  // Tier 1: cheap fast model.
  ai.onEscalate?.(1);
  const trace: string[] = [];
  let maxTierTried: 1 | 2 = 1;
  let answer = await runTierLocate(input, ai, locate, apiKey, 1, trace);

  // Tier 2: stronger model retries any tier-1 failure — including explicit
  // cannot_locate refusals (the small model gives up too easily on cases the
  // bigger one resolves). Tier 2's outcome is final.
  if (!isLocateResult(answer) && ai.escalation?.enabled) {
    const tier1Answer = answer;
    const failure = answer
      ? `tier 1 refused: ${answer.cannotLocate}`
      : "exhausted exploration without a confident answer";
    logger.info(
      `[ai-locate] tier 1 failed — escalating to ${ai.escalation.model ?? TIER2_MODEL}`
    );
    ai.onEscalate?.(2);
    maxTierTried = 2;
    answer = await runTierLocate(input, ai, locate, apiKey, 2, trace, {
      trace,
      failure,
    });
    // Tier 2 hard-failed but tier 1 gave a reasoned refusal — keep the reason
    // (better user-facing message than the generic "couldn't pinpoint").
    if (answer === null && tier1Answer) {
      answer = tier1Answer;
    }
  }

  locateCache.set(key, { result: answer, at: Date.now(), maxTierTried });
  logger.info(`[ai-locate] → ${describeAnswerForLog(answer)}`);
  return answer;
}

/** Force the locator for every op (no deterministic-first apply). Falls back to
 *  a deterministic apply for any op the locator can't resolve. */
async function forcedAiBatch(
  operations: BatchOperation[],
  projectRoot: string,
  ai: AiOptions,
  locate: LocateFn
): Promise<AiBatchResult> {
  const results: OperationResult[] = Array.from({ length: operations.length });
  const undoEntries: AiBatchResult["undoEntries"] = [];
  const proposals: AiProposal[] = [];

  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i];
    if (op.op === "reorder" || !resolveProjectFilePath(op.file, projectRoot)) {
      const det = executeBatch([op], projectRoot);
      [results[i]] = det.results;
      undoEntries.push(...det.undoEntries);
      continue;
    }

    logger.info(`[ai-locate] forced resolve ${op.op} @ ${op.file}`);
    // Ops are resolved one at a time: each locateOp call may consult/update the
    // shared locateCache and issue rate-limited model calls — parallelizing
    // would race the cache and burst the API.
    // oxlint-disable-next-line no-await-in-loop -- sequential AI resolution; shares a mutable cache and must not burst the API
    const answer = await locateOp(op, [], ai, locate, projectRoot, false);

    // The AI explicitly gave up — surface its reason (forced mode means the AI
    // is the resolver, so its failure is the failure).
    if (answer && !isLocateResult(answer)) {
      results[i] = {
        op: op.op,
        file: op.file,
        line: (op as { line?: number }).line ?? 0,
        success: false,
        error: aiFailureMessage(answer),
        aiReasoning: answer.cannotLocate,
      };
      continue;
    }
    if (answer) {
      const {
        result,
        undoEntries: ue,
        proposal,
      } = applyAnswer(op, i, answer, projectRoot);
      if (result) {
        results[i] = result;
        if (ue) {
          undoEntries.push(...ue);
        }
        continue;
      }
      if (proposal) {
        proposals.push(proposal);
        results[i] = {
          op: op.op,
          file: op.file,
          line: (op as { line?: number }).line ?? 0,
          success: false,
          error: "Pending AI confirmation",
          aiKind: answer.kind,
          aiReasoning: answer.reasoning,
        };
        continue;
      }
      // AI location didn't apply — drop cache so a retry re-resolves.
      invalidateLocateCache(op);
    }

    // Locator failed / didn't apply → deterministic apply as a fallback.
    const det = executeBatch([op], projectRoot);
    [results[i]] = det.results;
    undoEntries.push(...det.undoEntries);
  }

  return proposals.length > 0
    ? { results, undoEntries, proposals }
    : { results, undoEntries };
}

export async function executeBatchWithAi(
  operations: BatchOperation[],
  projectRoot: string,
  ai: AiOptions = {}
): Promise<AiBatchResult> {
  const enabled = ai.enableAi ?? !!ai.apiKey;
  if (!enabled || !ai.apiKey) {
    return executeBatch(operations, projectRoot);
  }
  const locate = ai.locate ?? defaultLocate;

  // Forced mode ("Confirm with AI"): resolve every op via the locator up front
  // instead of trying deterministic first and only escalating failures.
  if (ai.forceAi) {
    return forcedAiBatch(operations, projectRoot, ai, locate);
  }

  const base = executeBatch(operations, projectRoot);
  const proposals: AiProposal[] = [];

  for (let i = 0; i < base.results.length; i += 1) {
    const r = base.results[i];
    const op = operations[i];
    if (op.op === "reorder") {
      continue;
    }
    if (!isEscalatable(r, op)) {
      continue;
    }
    if (!resolveProjectFilePath(op.file, projectRoot)) {
      continue;
    }

    logger.info(
      `[ai-locate] escalating ${op.op} @ ${op.file} (${(r.error ?? "").slice(0, 48)})`
    );
    // Ops are resolved one at a time: each locateOp call may consult/update the
    // shared locateCache and issue rate-limited model calls — parallelizing
    // would race the cache and burst the API.
    // oxlint-disable-next-line no-await-in-loop -- sequential AI resolution; shares a mutable cache and must not burst the API
    const answer = await locateOp(
      op,
      r.candidates ?? [],
      ai,
      locate,
      projectRoot,
      true
    );

    // The AI ran and explained why it couldn't (or gave nothing) — surface its
    // message, since the AI is the one that failed here (not the deterministic pass).
    if (!isLocateResult(answer)) {
      base.results[i] = {
        ...r,
        error: aiFailureMessage(answer),
        aiReasoning: answer?.cannotLocate,
      };
      continue;
    }

    const { result, undoEntries, proposal } = applyAnswer(
      op,
      i,
      answer,
      projectRoot
    );
    if (result) {
      base.results[i] = result;
      if (undoEntries) {
        base.undoEntries.push(...undoEntries);
      }
    } else if (proposal) {
      proposals.push(proposal);
      base.results[i] = {
        ...r,
        aiKind: answer.kind,
        aiReasoning: answer.reasoning,
      };
    } else {
      invalidateLocateCache(op);
      base.results[i] = {
        ...r,
        error: aiFailureMessage(null),
        aiKind: answer.kind,
        aiReasoning: answer.reasoning,
      };
    } // apply failed — drop cache so retry re-resolves
  }

  return proposals.length > 0 ? { ...base, proposals } : base;
}

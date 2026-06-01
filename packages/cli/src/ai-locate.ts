// packages/cli/src/ai-locate.ts
// Tier-1 AI element locator. Off by default (requires ANTHROPIC_API_KEY).
//
// When the deterministic resolver fails on structurally-hard cases (.map()
// iterations, reused component instances, conditional/state-dependent
// rendering), this seeds an LLM with our best-guess candidates AND read-only
// access to the actual source, and asks it to LOCATE the exact node to edit —
// never to edit. The deterministic transform then applies + validates at the
// returned location. Hard guardrails: read-only tools, location-only output,
// this-one-edit-only.

import * as fs from "node:fs";
import * as path from "node:path";
import type { BatchOperation } from "@react-rewrite/shared";
import {
  executeBatch,
  type BatchResult,
  type OperationResult,
} from "./batch-transform.js";
import { resolveProjectFilePath, isProjectFilePathSafe } from "./path-resolver.js";
import { logger } from "./logger.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_STEPS = 8;
const MAX_GREP_RESULTS = 40;
const SOURCE_EXT = new Set([".tsx", ".jsx", ".ts", ".js", ".mdx"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage"]);

export type LocateKind = "direct" | "map-template" | "conditional" | "instance";

export interface LocateIdentity {
  tagName?: string;
  className?: string;
  parentTagName?: string;
  parentClassName?: string;
  nthOfType?: number;
  componentName?: string;
  text?: string;
}

export interface LocateInput {
  /** Human description of the specific edit to perform. */
  intent: string;
  /** Captured DOM identity of the selected element. */
  identity: LocateIdentity;
  /** Deterministic best-guess candidate locations (hints, not a constraint). */
  candidates: Array<{ line: number; col: number; snippet: string }>;
  /** The op's source file (project-relative path + content). */
  primaryFile: { path: string; content: string };
  /** Pre-computed project grep for the element's text (front-loads the answer
   *  so the model usually resolves in one step). */
  textMatches?: Array<{ file: string; line: number; text: string }>;
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

export type LocateFn = (
  input: LocateInput,
  opts: { apiKey: string; baseURL?: string; model?: string },
) => Promise<LocateResult | null>;

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
  /** Injectable locator (default = SDK tool-use loop). Tests pass a stub. */
  locate?: LocateFn;
  /** Called when the AI loop actually starts (not on cache hits) — for a UI
   *  "locating…" indicator. */
  onEscalate?: () => void;
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

export function readFileTool(input: { path?: string }, projectRoot: string): string {
  const rel = input?.path;
  if (!rel || !isProjectFilePathSafe(rel, projectRoot)) return "ERROR: path outside project";
  const resolved = resolveProjectFilePath(rel, projectRoot);
  if (!resolved) return "ERROR: could not resolve path";
  try {
    const content = fs.readFileSync(resolved, "utf-8");
    return numbered(content.slice(0, 20000));
  } catch {
    return "ERROR: could not read file";
  }
}

function listDirTool(input: { path?: string }, projectRoot: string): string {
  const rel = input?.path ?? ".";
  if (!isProjectFilePathSafe(rel, projectRoot)) return "ERROR: path outside project";
  const resolved = resolveProjectFilePath(rel, projectRoot) ?? path.resolve(projectRoot, rel);
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return entries
      .filter((e) => !SKIP_DIRS.has(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join("\n") || "(empty)";
  } catch {
    return "ERROR: could not list directory";
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Search project source files for a regex. Returns structured matches. */
function grepProject(query: string, projectRoot: string, max = MAX_GREP_RESULTS): Array<{ file: string; line: number; text: string }> {
  let re: RegExp;
  try {
    re = new RegExp(query);
  } catch {
    return [];
  }
  const hits: Array<{ file: string; line: number; text: string }> = [];
  const walk = (dir: string) => {
    if (hits.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= max) return;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(e.name))) continue;
      const full = path.join(dir, e.name);
      let content: string;
      try {
        content = fs.readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push({ file: path.relative(projectRoot, full), line: i + 1, text: lines[i].trim().slice(0, 120) });
          if (hits.length >= max) break;
        }
      }
    }
  };
  walk(projectRoot);
  return hits;
}

function grepTool(input: { query?: string }, projectRoot: string): string {
  if (!input?.query) return "ERROR: missing query";
  const hits = grepProject(input.query, projectRoot);
  return hits.length > 0 ? hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join("\n") : "(no matches)";
}

const TOOLS = [
  {
    name: "read_file",
    description: "Read a project source file (project-relative path). Returns numbered lines.",
    input_schema: {
      type: "object" as const,
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description: "Search project source files for a JS regex. Returns matching 'path:line: text'.",
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
        kind: { type: "string", enum: ["direct", "map-template", "conditional", "instance"] },
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

Be decisive: if a provided candidate or text-grep line clearly matches the element (its text and/or className line up), call resolve_location immediately — don't keep exploring. The 'col' is the 0-based column of the opening '<'. 'reasoning' is ONE sentence on WHY this is the right node (which file/element and how you identified it) — do NOT restate or guess the styling change; that is applied deterministically.`;

function buildSeedMessage(input: LocateInput): string {
  const id = input.identity;
  const idLines = [
    id.componentName ? `  component: ${id.componentName}` : "",
    id.tagName ? `  tag: <${id.tagName}>` : "",
    id.className ? `  className (DOM): "${id.className}"` : "",
    id.parentTagName ? `  parent: <${id.parentTagName}>${id.parentClassName ? ` class="${id.parentClassName}"` : ""}` : "",
    id.nthOfType != null ? `  nthOfType: ${id.nthOfType}` : "",
    id.text ? `  text: "${id.text.slice(0, 80)}"` : "",
  ].filter(Boolean).join("\n");

  const cands = input.candidates.length
    ? input.candidates.map((c, i) => `  ${i + 1}. line ${c.line}, col ${c.col}: ${c.snippet}`).join("\n")
    : "  (none — the element may be a map template, a conditional branch, or in another file)";

  const textGrep = input.textMatches && input.textMatches.length
    ? `\n## Project lines containing the element's text (strong hint — the target is very likely one of these)\n${input.textMatches.map((m) => `  ${m.file}:${m.line}: ${m.text}`).join("\n")}\n`
    : "";

  return `## Change to locate
${input.intent}

## Selected element identity
${idLines}

## Deterministic best-guess candidates (hints — the true target may be elsewhere)
${cands}
${textGrep}
## Primary file: ${input.primaryFile.path}
\`\`\`tsx
${numbered(input.primaryFile.content)}
\`\`\`

Locate the exact node to edit and call resolve_location.`;
}

/** Light validation of the model's answer — deeper "is a real JSX node" check
 *  happens when the deterministic transform re-runs at this location. */
export function validateAnswer(ans: any, projectRoot: string): LocateResult | null {
  if (!ans || typeof ans !== "object") return null;
  const { filePath, line, col, kind, reasoning } = ans;
  if (typeof filePath !== "string" || !isProjectFilePathSafe(filePath, projectRoot)) return null;
  if (typeof line !== "number" || line < 1) return null;
  if (typeof col !== "number" || col < 0) return null;
  if (!["direct", "map-template", "conditional", "instance"].includes(kind)) return null;
  return { filePath, line, col, kind, reasoning: typeof reasoning === "string" ? reasoning : "" };
}

// ── Default locator: SDK tool-use loop (lazy-imported) ─────────────────────

export const defaultLocate: LocateFn = async (input, { apiKey, baseURL, model }) => {
  let Anthropic: any;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch (err) {
    logger.warn("[ai-locate] @anthropic-ai/sdk not available:", err instanceof Error ? err.message : String(err));
    return null;
  }
  const client = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey });
  const messages: any[] = [{ role: "user", content: buildSeedMessage(input) }];

  for (let step = 0; step < MAX_STEPS; step++) {
    let resp: any;
    try {
      resp = await client.messages.create({
        model: model || HAIKU_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
    } catch (err) {
      logger.warn("[ai-locate] API error:", err instanceof Error ? err.message : String(err));
      return null;
    }

    const toolUses = (resp.content ?? []).filter((b: any) => b.type === "tool_use");
    if (toolUses.length === 0) return null; // no tool call — give up (fail safe)

    messages.push({ role: "assistant", content: resp.content });

    const toolResults: any[] = [];
    for (const tu of toolUses) {
      if (tu.name === "resolve_location") {
        const answer = validateAnswer(tu.input, input.projectRoot);
        logger.debug(`[ai-locate] resolve_location → ${answer ? `${answer.filePath}:${answer.line}:${answer.col} (${answer.kind})` : "invalid"}`);
        return answer;
      }
      let out = "ERROR: unknown tool";
      if (tu.name === "read_file") out = readFileTool(tu.input, input.projectRoot);
      else if (tu.name === "grep") out = grepTool(tu.input, input.projectRoot);
      else if (tu.name === "list_dir") out = listDirTool(tu.input, input.projectRoot);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    messages.push({ role: "user", content: toolResults });
  }
  logger.debug("[ai-locate] exhausted maxSteps without resolve_location");
  return null;
};

// ── Intent / identity extraction from an op ────────────────────────────────

function describeIntent(op: BatchOperation): string {
  const o = op as any;
  switch (op.op) {
    case "updateClass": {
      const changes = (o.updates ?? [])
        .map((u: any) => {
          const suffix = u.tailwindToken || u.value; // token holds the real class suffix
          return suffix ? `${u.tailwindPrefix}-${suffix}` : u.tailwindPrefix;
        })
        .join(", ");
      return `Apply Tailwind class(es) [${changes || "class edit"}] to the selected <${o.tagName ?? "element"}>${o.text ? ` (text: "${String(o.text).slice(0, 40)}")` : ""}.`;
    }
    case "updateText":
      return `Change text "${(o.originalText ?? "").slice(0, 60)}" → "${(o.newText ?? "").slice(0, 60)}".`;
    case "moveSpacing":
      return `Adjust spacing (${o.axis}-axis) on the selected <${o.tagName ?? "element"}>.`;
    default:
      return `Edit the selected <${o.tagName ?? "element"}> (${op.op}).`;
  }
}

function identityOf(op: BatchOperation): LocateIdentity {
  const o = op as any;
  return {
    tagName: o.tagName,
    className: o.className,
    parentTagName: o.parentTagName,
    parentClassName: o.parentClassName,
    nthOfType: o.nthOfType,
    componentName: o.componentName,
    text: o.text ?? o.originalText,
  };
}

function isEscalatable(r: OperationResult): boolean {
  if (r.success) return false;
  const e = r.error ?? "";
  if (e.startsWith("FILE_CHANGED:")) return false; // stale → re-select, never escalate
  // Escalate on ambiguity OR no-match — the no-match-with-zero-candidates case
  // (element rendered by a reused component / not in this file) is exactly what
  // the locator's code-reading is for. Candidates may be empty.
  return e.startsWith("AMBIGUOUS:") || e.startsWith("No JSX element found");
}

// Per-element resolution cache: property scrubbing fires many commits for the
// same element, so cache WHERE (not the edit value). Positive results live for
// the process; negatives expire so a fix (e.g. enabling AI) can retry.
const NEG_TTL_MS = 60_000;
const locateCache = new Map<string, { result: LocateResult | null; at: number }>();

/** Drop a cached resolution so a retry re-resolves from scratch — called
 *  whenever an AI-resolved change fails to apply for any reason. */
export function invalidateLocateCache(op: BatchOperation): void {
  locateCache.delete(cacheKey(op));
}

function cacheKey(op: any): string {
  // Include text + structural context, not just the (often mis-resolved,
  // shared) owner-stack coords: sibling instances with identical
  // file/line/col/tag/className (e.g. four <h4 className="font-medium">) would
  // otherwise collide and all resolve to whichever was cached first.
  return [
    op.file, op.line, op.col,
    op.tagName ?? "", op.className ?? "",
    op.text ?? op.originalText ?? "",
    op.nthOfType ?? "", op.parentClassName ?? "",
  ].join("|");
}

/** Grep the project for the element's text, ranking element-like lines first. */
function computeTextMatches(id: LocateIdentity, projectRoot: string): Array<{ file: string; line: number; text: string }> | undefined {
  if (!id.text || id.text.length < 3) return undefined;
  const classTokens = (id.className ?? "").split(/\s+/).filter(Boolean);
  const found = grepProject(escapeRegExp(id.text), projectRoot, 60);
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
  projectRoot: string,
): { result?: OperationResult; undoEntries?: AiBatchResult["undoEntries"]; proposal?: AiProposal } {
  const autoApply = answer.kind === "direct" || answer.kind === "conditional";
  if (autoApply) {
    const rerun = executeBatch(
      [{ ...op, file: answer.filePath, line: answer.line, col: answer.col, fileMtime: undefined, fileSize: undefined, trustLocation: true } as BatchOperation],
      projectRoot,
    );
    const rr = rerun.results[0];
    if (rr?.success) {
      return { result: { ...rr, file: answer.filePath, resolvedBy: "ai", aiKind: answer.kind, aiReasoning: answer.reasoning }, undoEntries: rerun.undoEntries };
    }
    return {}; // didn't apply cleanly
  }
  return { proposal: { index, op, target: answer, intent: describeIntent(op) } };
}

// ── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Run the deterministic batch, then escalate unresolved structural cases to the
 * AI locator. 'direct' same-file resolutions apply immediately; structural /
 * cross-file resolutions are returned as proposals for user confirmation.
 */
async function locateOp(
  op: BatchOperation,
  candidates: Array<{ line: number; col: number; snippet: string }>,
  ai: AiOptions,
  locate: LocateFn,
  projectRoot: string,
  useCache: boolean,
): Promise<LocateResult | null> {
  const key = cacheKey(op);
  if (useCache) {
    const cached = locateCache.get(key);
    if (cached && (cached.result !== null || Date.now() - cached.at < NEG_TTL_MS)) {
      logger.debug(`[ai-locate] cache hit ${key} → ${cached.result ? cached.result.kind : "null"}`);
      return cached.result;
    }
  }
  const resolved = resolveProjectFilePath(op.file, projectRoot);
  let content = "";
  if (resolved) { try { content = fs.readFileSync(resolved, "utf-8"); } catch { /* unreadable */ } }

  ai.onEscalate?.();
  const id = identityOf(op);
  let answer: LocateResult | null = null;
  try {
    answer = await locate(
      { intent: describeIntent(op), identity: id, candidates, primaryFile: { path: op.file, content }, textMatches: computeTextMatches(id, projectRoot), projectRoot },
      { apiKey: ai.apiKey!, baseURL: ai.baseURL, model: ai.model },
    );
  } catch (err) {
    logger.warn("[ai-locate] locator threw:", err instanceof Error ? err.message : String(err));
  }
  locateCache.set(key, { result: answer, at: Date.now() });
  logger.info(`[ai-locate] → ${answer ? `${answer.filePath}:${answer.line} (${answer.kind})` : "no resolution"}`);
  return answer;
}

export async function executeBatchWithAi(
  operations: BatchOperation[],
  projectRoot: string,
  ai: AiOptions = {},
): Promise<AiBatchResult> {
  const enabled = ai.enableAi ?? !!ai.apiKey;
  if (!enabled || !ai.apiKey) return executeBatch(operations, projectRoot);
  const locate = ai.locate ?? defaultLocate;

  // Forced mode ("Confirm with AI"): resolve every op via the locator up front
  // instead of trying deterministic first and only escalating failures.
  if (ai.forceAi) return forcedAiBatch(operations, projectRoot, ai, locate);

  const base = executeBatch(operations, projectRoot);
  const proposals: AiProposal[] = [];

  for (let i = 0; i < base.results.length; i++) {
    const r = base.results[i];
    if (!isEscalatable(r)) continue;
    const op = operations[i];
    if (op.op === "reorder") continue;
    if (!resolveProjectFilePath(op.file, projectRoot)) continue;

    logger.info(`[ai-locate] escalating ${op.op} @ ${op.file} (${(r.error ?? "").slice(0, 48)})`);
    const answer = await locateOp(op, r.candidates ?? [], ai, locate, projectRoot, true);
    if (!answer) continue;

    const { result, undoEntries, proposal } = applyAnswer(op, i, answer, projectRoot);
    if (result) { base.results[i] = result; if (undoEntries) base.undoEntries.push(...undoEntries); }
    else if (proposal) { proposals.push(proposal); base.results[i] = { ...r, aiKind: answer.kind, aiReasoning: answer.reasoning }; }
    else { invalidateLocateCache(op); base.results[i] = { ...r, aiKind: answer.kind, aiReasoning: answer.reasoning }; } // apply failed — drop cache so retry re-resolves
  }

  return proposals.length > 0 ? { ...base, proposals } : base;
}

/** Force the locator for every op (no deterministic-first apply). Falls back to
 *  a deterministic apply for any op the locator can't resolve. */
async function forcedAiBatch(
  operations: BatchOperation[],
  projectRoot: string,
  ai: AiOptions,
  locate: LocateFn,
): Promise<AiBatchResult> {
  const results: OperationResult[] = new Array(operations.length);
  const undoEntries: AiBatchResult["undoEntries"] = [];
  const proposals: AiProposal[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.op === "reorder" || !resolveProjectFilePath(op.file, projectRoot)) {
      const det = executeBatch([op], projectRoot);
      results[i] = det.results[0];
      undoEntries.push(...det.undoEntries);
      continue;
    }

    logger.info(`[ai-locate] forced resolve ${op.op} @ ${op.file}`);
    const answer = await locateOp(op, [], ai, locate, projectRoot, false);

    if (answer) {
      const { result, undoEntries: ue, proposal } = applyAnswer(op, i, answer, projectRoot);
      if (result) { results[i] = result; if (ue) undoEntries.push(...ue); continue; }
      if (proposal) {
        proposals.push(proposal);
        results[i] = { op: op.op, file: op.file, line: (op as { line?: number }).line ?? 0, success: false, error: "Pending AI confirmation", aiKind: answer.kind, aiReasoning: answer.reasoning };
        continue;
      }
      // AI location didn't apply — drop cache so a retry re-resolves.
      invalidateLocateCache(op);
    }

    // Locator failed / didn't apply → deterministic apply as a fallback.
    const det = executeBatch([op], projectRoot);
    results[i] = det.results[0];
    undoEntries.push(...det.undoEntries);
  }

  return proposals.length > 0 ? { results, undoEntries, proposals } : { results, undoEntries };
}

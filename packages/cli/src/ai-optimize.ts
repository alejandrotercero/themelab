// packages/cli/src/ai-optimize.ts
//
// "Optimize for mobile" — the built-in AI generator that regenerates a JSX
// element's className to be mobile-first responsive, then applies it on user
// confirm via a location-locked `replaceClassName` op.
//
// Reuses the same AI plumbing as ai-locate.ts (lazy SDK import, Anthropic
// tool-use loop, prompt caching, tier-2 escalation): a single tool the model
// calls exactly once — `propose_classname` — to return the regenerated string.
// Strict guardrails, mirroring the locator: read-only context, one element,
// output is a className string only (no code edits). The deterministic
// `mutateClassNameReplace` transform writes it to source.
//
// Off by default (requires ANTHROPIC_API_KEY); off ⇒ the action surfaces a
// "Set ANTHROPIC_API_KEY to use Optimize." toast instead of calling the model.

import { logger, getLogLevel } from "./logger.js";

// Exact model strings — do NOT append a date suffix (dated variants 404).
const TIER1_MODEL = "claude-haiku-4-5-20251001";
const TIER2_MODEL = "claude-sonnet-4-6";
const TIER_BUDGET = {
  1: { maxSteps: 4, maxTokens: 2048 },
  2: { maxSteps: 6, maxTokens: 3072 },
} as const;

export interface OptimizeOptions {
  apiKey: string;
  baseURL?: string;
  model?: string;
  /** Tier-2 retry on tier-1 failure/refusal. */
  escalation?: { enabled: boolean; model?: string };
  /** Called when an AI attempt actually starts — for a "generating…" indicator. */
  onEscalate?: (tier: 1 | 2) => void;
}

export interface OptimizeInput {
  /** Project-relative path of the element's source file. */
  filePath: string;
  /** 1-based opening-tag line + 0-based column, as the locator/overlay report. */
  line: number;
  col: number;
  /** Current className string on the element (the "before"). */
  oldClassName: string;
  /** A short snippet of the element's source line, for orientation. */
  snippet: string;
  /** The project's declared breakpoints (name → min-width), for the prompt. */
  screens: Record<string, string>;
  /** Current viewport width — the regenerated className must not change the
   *  rendered result at this width. */
  viewportWidth: number;
  projectRoot: string;
}

export interface OptimizeProposal {
  /** Regenerated mobile-first className (the "after"). */
  newClassName: string;
  /** One-sentence rationale from the model. */
  reasoning: string;
}

/** The model ran but deliberately gave up, with a user-facing reason. */
export interface OptimizeFailure {
  cannotGenerate: string;
}

export type OptimizeOutcome = OptimizeProposal | OptimizeFailure | null;

export function isOptimizeProposal(o: OptimizeOutcome): o is OptimizeProposal {
  return !!o && "newClassName" in o;
}

// ── Tools ──────────────────────────────────────────────────────────────────

const PROPOSE_CLASSNAME_TOOL = {
  name: "propose_classname",
  description:
    "Return the regenerated, mobile-first className string for the element. " +
    "Call this EXACTLY ONCE when you have produced the optimized className.",
  input_schema: {
    type: "object" as const,
    properties: {
      className: {
        type: "string",
        description:
          "The full regenerated className string (space-separated Tailwind utilities).",
      },
      reasoning: {
        type: "string",
        description:
          "ONE sentence on what you changed and why (e.g. demoted desktop spacing to a base, kept xl: override).",
      },
    },
    required: ["className", "reasoning"],
  },
};

const CANNOT_GENERATE_TOOL = {
  name: "cannot_generate",
  description:
    "Call if you genuinely cannot produce a safe mobile-first className for this element.",
  input_schema: {
    type: "object" as const,
    properties: { reason: { type: "string" } },
    required: ["reason"],
  },
};

const TOOLS = [PROPOSE_CLASSNAME_TOOL, CANNOT_GENERATE_TOOL];

// ── Prompt ───────────────────────────────────────────────────────────────────

function buildSystemPrompt(screens: Record<string, string>): string {
  const screenList = Object.entries(screens)
    .map(([name, min]) => `${name} (≥ ${min})`)
    .join(", ");
  return `You are a Tailwind CSS expert refactoring ONE React element's className to be mobile-first responsive.

You are given the element's current className and a source snippet. Produce a regenerated className that is MOBILE-FIRST:
- Base (mobile) utilities come FIRST, then breakpoint overrides in ascending order: ${screenList || "sm, md, lg, xl, 2xl"}.
- Add sensible base (mobile) values for any property that currently ONLY exists behind a breakpoint, so the element looks intentional on mobile rather than unstyled.
- KEEP existing breakpoint values exactly as they are — only ADD a mobile base where missing; do not change what already renders at desktop widths.
- The RENDERED RESULT at the current viewport must NOT change. Treat the current viewport width as the width to preserve.
- Preserve classes you should not touch: state variants (hover:, focus:, active:), dark: variants, group/peer, and any non-utility classes. Keep them attached to their correct layer.
- Do not invent tokens that don't exist in Tailwind's default scale. Prefer the scale over arbitrary values.
- Reorder only for readability (mobile-first order); do not remove classes unless they are redundant duplicates.

Output the FULL new className string (not a diff) via propose_classname. If you cannot safely do this (e.g. the className is fully dynamic), call cannot_generate with a reason. Do not call any tool other than propose_classname / cannot_generate.`;
}

function buildSeedMessage(input: OptimizeInput): string {
  return `## Element to optimize
File: ${input.filePath}:${input.line}:${input.col}
Current viewport width: ${input.viewportWidth}px — the rendered result at this width must not change.

## Source snippet (the element's line)
\`\`\`
${input.snippet}
\`\`\`

## Current className
\`\`\`
${input.oldClassName}
\`\`\`

## Project breakpoints (ascending)
${
  Object.entries(input.screens)
    .map(([n, m]) => `- ${n}: ≥ ${m}`)
    .join("\n") || "- sm, md, lg, xl, 2xl (Tailwind defaults)"
}

Regenerate this className to be mobile-first responsive and call propose_classname with the full new className string.`;
}

// ── Validate the model's answer ──────────────────────────────────────────────

function validateProposal(input: unknown): OptimizeProposal | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const { className, reasoning } = input as Record<string, unknown>;
  if (typeof className !== "string" || className.trim().length === 0) {
    return null;
  }
  // Sanity cap — a className shouldn't balloon by an order of magnitude.
  if (className.length > 4000) {
    return null;
  }
  return {
    newClassName: className.replaceAll(/\s+/g, " ").trim(),
    reasoning: typeof reasoning === "string" ? reasoning : "",
  };
}

// ── Generator: SDK tool-use loop (lazy-imported) ─────────────────────────────

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

type TierIteration = { done: true; outcome: OptimizeOutcome } | { done: false };

/** Inspect this step's tool calls for a terminal answer (propose/cannot). */
function resolveTierStep(
  toolUses: AnthropicContentBlock[],
  tier: 1 | 2,
  verbose: boolean
): TierIteration {
  for (const tu of toolUses) {
    if (tu.name === "cannot_generate") {
      const reasonInput = tu.input?.reason;
      const reason =
        typeof reasonInput === "string" && reasonInput.trim()
          ? reasonInput.trim()
          : "couldn't generate a mobile-first className.";
      logger.info(`[ai-optimize] tier ${tier} cannot_generate: ${reason}`);
      return { done: true, outcome: { cannotGenerate: reason } };
    }
    if (tu.name === "propose_classname") {
      const proposal = validateProposal(tu.input);
      if (verbose) {
        logger.debug(
          `  [propose_classname] → ${proposal ? "accepted" : "REJECTED"}`
        );
      }
      logger.debug(
        `[ai-optimize] propose_classname → ${proposal ? "accepted" : "invalid"}`
      );
      return { done: true, outcome: proposal };
    }
  }
  return { done: false };
}

async function runTier(
  input: OptimizeInput,
  opts: OptimizeOptions,
  tier: 1 | 2
): Promise<OptimizeOutcome> {
  const { apiKey, baseURL } = opts;
  const model = opts.model || (tier === 2 ? TIER2_MODEL : TIER1_MODEL);
  const { maxSteps, maxTokens } = TIER_BUDGET[tier];

  const client = await getAnthropicClient(apiKey, baseURL, "[ai-optimize]");
  if (!client) {
    return null;
  }

  const seedBlock: AnthropicContentBlock = {
    type: "text",
    text: buildSeedMessage(input),
    cache_control: { type: "ephemeral" },
  };
  const messages: { role: string; content: AnthropicContentBlock[] }[] = [
    { role: "user", content: [seedBlock] },
  ];
  let lastMarkedBlock: AnthropicContentBlock | null = null;
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, steps: 0 };

  const finish = (outcome: OptimizeOutcome): OptimizeOutcome => {
    logger.info(
      `[ai-optimize] tier ${tier} (${model}): ${usage.steps} step${usage.steps === 1 ? "" : "s"} · tokens in=${usage.in} (cached ${usage.cacheRead}) out=${usage.out}`
    );
    return outcome;
  };

  const verbose = getLogLevel() === "debug";
  const systemPrompt = buildSystemPrompt(input.screens);
  if (verbose) {
    logger.debug(
      `\n════════ [ai-optimize] REQUEST (tier ${tier}) → ${model} ════════`
    );
    logger.debug(`──── user seed ────\n${seedBlock.text}`);
  }

  for (let step = 0; step < maxSteps; step += 1) {
    let resp: AnthropicMessage;
    try {
      // Sequential agentic tool-use turns — each step depends on the model's
      // prior response, so these calls cannot run in parallel.
      // oxlint-disable-next-line no-await-in-loop -- sequential agentic tool-use loop; each turn depends on the previous model response
      resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: TOOLS,
        messages,
      });
    } catch (error) {
      logger.warn(
        "[ai-optimize] API error:",
        error instanceof Error ? error.message : String(error)
      );
      return finish(null);
    }
    usage.steps += 1;
    if (resp.usage) {
      usage.in += resp.usage.input_tokens ?? 0;
      usage.out += resp.usage.output_tokens ?? 0;
      usage.cacheRead += resp.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += resp.usage.cache_creation_input_tokens ?? 0;
    }

    const toolUses = (resp.content ?? []).filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      return finish(null);
    }

    messages.push({ role: "assistant", content: resp.content ?? [] });

    const iteration = resolveTierStep(toolUses, tier, verbose);
    if (iteration.done) {
      return finish(iteration.outcome);
    }

    // Shouldn't reach here (only propose/cannot tools exist) — but if it does, loop again.
    const toolResults: AnthropicContentBlock[] = toolUses.map((tu) => ({
      type: "tool_result",
      tool_use_id: tu.id,
      content: "ERROR: unknown tool",
    }));
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
    `[ai-optimize] tier ${tier} exhausted maxSteps without propose_classname`
  );
  return finish(null);
}

/**
 * Generate a mobile-first className for `input`, escalating to a stronger model
 * on tier-1 failure (when enabled). Returns the proposal, a failure, or null.
 */
export async function generateMobileFirstClassName(
  input: OptimizeInput,
  opts: OptimizeOptions
): Promise<OptimizeOutcome> {
  opts.onEscalate?.(1);
  let answer = await runTier(input, opts, 1);

  if (!isOptimizeProposal(answer) && opts.escalation?.enabled) {
    logger.info(
      `[ai-optimize] tier 1 failed — escalating to ${opts.escalation.model ?? TIER2_MODEL}`
    );
    opts.onEscalate?.(2);
    const tier2 = await runTier(
      input,
      { ...opts, model: opts.escalation.model ?? TIER2_MODEL },
      2
    );
    if (tier2 !== null) {
      answer = tier2;
    }
  }
  return answer;
}

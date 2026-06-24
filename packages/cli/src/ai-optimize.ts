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
        description: "The full regenerated className string (space-separated Tailwind utilities).",
      },
      reasoning: {
        type: "string",
        description: "ONE sentence on what you changed and why (e.g. demoted desktop spacing to a base, kept xl: override).",
      },
    },
    required: ["className", "reasoning"],
  },
};

const CANNOT_GENERATE_TOOL = {
  name: "cannot_generate",
  description: "Call if you genuinely cannot produce a safe mobile-first className for this element.",
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
${Object.entries(input.screens).map(([n, m]) => `- ${n}: ≥ ${m}`).join("\n") || "- sm, md, lg, xl, 2xl (Tailwind defaults)"}

Regenerate this className to be mobile-first responsive and call propose_classname with the full new className string.`;
}

// ── Validate the model's answer ──────────────────────────────────────────────

function validateProposal(input: any): OptimizeProposal | null {
  if (!input || typeof input !== "object") return null;
  const { className, reasoning } = input;
  if (typeof className !== "string" || className.trim().length === 0) return null;
  // Sanity cap — a className shouldn't balloon by an order of magnitude.
  if (className.length > 4000) return null;
  return {
    newClassName: className.replace(/\s+/g, " ").trim(),
    reasoning: typeof reasoning === "string" ? reasoning : "",
  };
}

// ── Generator: SDK tool-use loop (lazy-imported) ─────────────────────────────

async function runTier(
  input: OptimizeInput,
  opts: OptimizeOptions,
  tier: 1 | 2,
): Promise<OptimizeOutcome> {
  const { apiKey, baseURL } = opts;
  const model = opts.model || (tier === 2 ? TIER2_MODEL : TIER1_MODEL);
  const { maxSteps, maxTokens } = TIER_BUDGET[tier];

  let Anthropic: any;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch (err) {
    logger.warn("[ai-optimize] @anthropic-ai/sdk not available:", err instanceof Error ? err.message : String(err));
    return null;
  }
  const client = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey });

  const seedBlock: any = { type: "text", text: buildSeedMessage(input), cache_control: { type: "ephemeral" } };
  const messages: any[] = [{ role: "user", content: [seedBlock] }];
  let lastMarkedBlock: any = null;
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, steps: 0 };

  const finish = (outcome: OptimizeOutcome): OptimizeOutcome => {
    logger.info(
      `[ai-optimize] tier ${tier} (${model}): ${usage.steps} step${usage.steps === 1 ? "" : "s"} · tokens in=${usage.in} (cached ${usage.cacheRead}) out=${usage.out}`,
    );
    return outcome;
  };

  const verbose = getLogLevel() === "debug";
  const systemPrompt = buildSystemPrompt(input.screens);
  if (verbose) {
    logger.debug(`\n════════ [ai-optimize] REQUEST (tier ${tier}) → ${model} ════════`);
    logger.debug(`──── user seed ────\n${seedBlock.text}`);
  }

  for (let step = 0; step < maxSteps; step++) {
    let resp: any;
    try {
      resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      });
    } catch (err) {
      logger.warn("[ai-optimize] API error:", err instanceof Error ? err.message : String(err));
      return finish(null);
    }
    usage.steps++;
    if (resp.usage) {
      usage.in += resp.usage.input_tokens ?? 0;
      usage.out += resp.usage.output_tokens ?? 0;
      usage.cacheRead += resp.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += resp.usage.cache_creation_input_tokens ?? 0;
    }

    const toolUses = (resp.content ?? []).filter((b: any) => b.type === "tool_use");
    if (toolUses.length === 0) return finish(null);

    messages.push({ role: "assistant", content: resp.content });

    for (const tu of toolUses) {
      if (tu.name === "cannot_generate") {
        const reason = typeof tu.input?.reason === "string" && tu.input.reason.trim()
          ? tu.input.reason.trim()
          : "couldn't generate a mobile-first className.";
        logger.info(`[ai-optimize] tier ${tier} cannot_generate: ${reason}`);
        return finish({ cannotGenerate: reason });
      }
      if (tu.name === "propose_classname") {
        const proposal = validateProposal(tu.input);
        if (verbose) logger.debug(`  [propose_classname] → ${proposal ? "accepted" : "REJECTED"}`);
        logger.debug(`[ai-optimize] propose_classname → ${proposal ? "accepted" : "invalid"}`);
        return finish(proposal);
      }
    }

    // Shouldn't reach here (only propose/cannot tools exist) — but if it does, loop again.
    const toolResults: any[] = toolUses.map((tu: any) => ({
      type: "tool_result",
      tool_use_id: tu.id,
      content: "ERROR: unknown tool",
    }));
    if (lastMarkedBlock) delete lastMarkedBlock.cache_control;
    lastMarkedBlock = toolResults[toolResults.length - 1];
    lastMarkedBlock.cache_control = { type: "ephemeral" };
    messages.push({ role: "user", content: toolResults });
  }
  logger.debug(`[ai-optimize] tier ${tier} exhausted maxSteps without propose_classname`);
  return finish(null);
}

/**
 * Generate a mobile-first className for `input`, escalating to a stronger model
 * on tier-1 failure (when enabled). Returns the proposal, a failure, or null.
 */
export async function generateMobileFirstClassName(
  input: OptimizeInput,
  opts: OptimizeOptions,
): Promise<OptimizeOutcome> {
  opts.onEscalate?.(1);
  let answer = await runTier(input, opts, 1);

  if (!isOptimizeProposal(answer) && opts.escalation?.enabled) {
    const tier1Failure = answer ? `tier 1 refused: ${answer.cannotGenerate}` : "exhausted steps without a proposal";
    logger.info(`[ai-optimize] tier 1 failed — escalating to ${opts.escalation.model ?? TIER2_MODEL}`);
    opts.onEscalate?.(2);
    const tier2 = await runTier(
      input,
      { ...opts, model: opts.escalation.model ?? TIER2_MODEL },
      2,
    );
    if (tier2 !== null) answer = tier2;
  }
  return answer;
}

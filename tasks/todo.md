# Tiered AI escalation for the locator (2026-06-09)

- [x] Tier 2 escalation in `ai-locate.ts`: tier-1 (Haiku, 8 steps/2048 tok) failure
      OR cannot_locate refusal → automatic tier-2 retry (Sonnet `claude-sonnet-4-6`,
      16 steps/4096 tok) with tier-1's tool-call trace as priorAttempt context and
      one extra read-only tool (`find_component_definition` → discoverFile).
- [x] Per-tier negative cache (`maxTierTried`); tier-1-only negatives don't block
      tier 2 after enabling escalation.
- [x] Quick wins: temperature 0, prompt caching (system + seed + moving tool_result
      breakpoint), per-tier token usage logging.
- [x] Config: `escalationEnabled`/`escalationModel` (file + `THEMELAB_AI_ESCALATION`,
      `THEMELAB_AI_MODEL_ESCALATED` env); settings UI checkbox + retry-model input;
      `aiResolving {tier}` → "Looking harder…" indicator (45s safety timeout).
- [x] Tests: 192/192 pass (9 new tiering cases + 1 config case); tsc clean; build OK.
- [x] README "Smart retry" bullet.
- Invariant preserved: AI locates only — read-only tools at every tier; edits still
  applied by deterministic transforms; off by default without an API key.

# Detection improvements from react-grab comparison

## Plan

- [x] Fix blunt full-page filter: `isFullPageElement` rejected ANY element covering
      ≥90% of the viewport, making legit full-page heroes/sections unselectable.
      Replaced with the overlay-shaped heuristic (`isOverlayLikeElement`) that only
      rejects transparent/dev-tools/high-z overlays. Updated `interaction.ts` and
      `isValidElement` call sites; dropped unused import in `selection.ts`.
- [x] Add Next.js RSC symbolication (ported from react-grab):
      - `utils/source-resolve.ts`: devirtualize `rsc://React/...` / `about://React/...`
        URLs so unsymbolicated server frames still yield real relative paths.
      - New `utils/server-symbolication.ts`: enrich server frames from `_debugStack`,
        symbolicate via Next.js dev endpoint `/__nextjs_original-stack-frames`,
        expose `getResolvedOwnerStack(fiber)` wrapper.
      - Swapped all 8 `getOwnerStack(fiber)` call sites (selection, move-state,
        inline-text-edit, resolve-helper ×2, property-controller ×3) to the wrapper.
- [x] Typecheck + build + tests.
- [x] Z-stack navigation: `z` drills deeper / `x` surfaces up through elements
      stacked at the selection's center (elementsFromPoint walk). `[`/`]` sibling
      reorder kept unchanged (it writes to source — user chose z/x instead).
- [x] Selection history: new `selection-history.ts` (50-entry stack, dedupe,
      ElementIdentity for HMR reacquire), recorded in `selectElement`. Panel is
      now tabbed: History (default) + Logs — per-entry revert in Logs survives.

## Review

- `tsc --noEmit` clean on overlay package; full `pnpm build` succeeds
  (overlay IIFE 291 KB, embedded into CLI); `pnpm test` 182/182 pass.
- `isFullPageElement` removed entirely; overlay detection now distinguishes
  "covers the viewport" (fine, selectable) from "looks like an overlay"
  (fixed/absolute + transparent/low-opacity or z>1000, or dev-tools canvas).
- RSC symbolication is centralized in `getResolvedOwnerStack` so every owner-stack
  consumer (selection, HMR reacquire, inline text edit, draw/text/color tools,
  property inspector) benefits. No CLI changes needed — the proxy already
  forwards the POST to the dev server. Non-Next.js apps short-circuit to plain
  `getOwnerStack`; endpoint failures fall back to devirtualized paths (5s abort).
- Z-stack + selection history landed in a follow-up pass (see above).
- Still deferred: page-freeze system (pin :hover/pause animations during
  selection) — biggest remaining UX win, start without dispatcher patching.

# Desktop overlay parity pass

## Plan

- [x] Inventory the original overlay toolbar, inspector, theme dock, and color controls.
- [x] Wire desktop controls through the injected overlay runtime instead of placeholder actions.
- [x] Restore semantic color bindings, the Kibo-style picker, variant controls, and floating toolbar behavior.
- [x] Reuse the overlay Tailwind v4 palette for property colors and theme-token rows, preserving token-class write-back.
- [x] Replace approximate toolbar glyphs with source SVGs, remove deferred infinite-canvas control, and bind the box model to real selected spacing values.
- [x] Add responsive preview ownership and a resizable native inspector without stale compositor bounds.
- [x] Verify a live element selection populates its source identity, computed styles, color tokens, and native controls.
- [ ] Finish a manual side-by-side visual pass for remaining small geometry and typography differences.

## Review (in progress)

- `@themelab/desktop` and `@themelab/overlay` typechecks pass; `pnpm build:desktop` passes and launches Electron against the real overlay runtime.
- Live Electron inspection confirmed the desktop inspector receives `app/page.tsx` selection data and exposes `var(--primary)` / `var(--primary-foreground)` values for Background and Color.
- CLI regression suite: 15 files, 228 tests passing.

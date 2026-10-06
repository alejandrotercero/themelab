# /tailwind follow-ups — format selector, sidebar, alpha caption (2026-10-06)

- [x] "Copy as" seg (oklch/hsl/rgb/hex) in the sidebar drives both swatch
      click-to-copy (`reformat`, toast names the format) and the Code dialog
      (dialog-local selector removed, current format shown as a label).
- [x] Sidebar layout: 320px left rail (scale-set name, stacked ScaleRowsInput
      cards, Algorithm, Appearance, Copy-as) + ramp pane; stacks on mobile.
      `ScaleRowsInput` gains a `layout="stacked"` variant (inline kept,
      unused for now).
- [x] Figma alpha explained in-product: caption now reads "The alpha row is
      one mid-tone tint per family at stepped opacities (8-digit hex)" — in
      both scale-export-dialog and export-dialog (/create shares the SVG).
- [x] Verify: web typecheck clean, eslint 0 errors (2 accepted data-URI
      `<img>` warnings), `next build` passes with `/tailwind` prerendered.

# /tailwind scale tool (2026-09-29)

## Plan (approved — Plan A library save, building now)

Goal: standalone `/tailwind` tool — one color per row, as many rows as
wanted, each producing a named Tailwind scale. ThemeLab 50–950 XOR Radix
1–12 via algorithm toggle. Scales only, no shadcn theme. Tailwind `@theme`
CSS export + copy-as-SVG (same Figma paste flow as /create). Save scale
sets into the SAME library (Plan A): `SavedTheme.scales` holds the
*inputs*; theme entries untouched.

- [ ] Engine — `packages/theme-engine/src/radix/index.ts`: add
      `radixScaleFromColor(accent, appearance)` single-input wrapper
      (gray = accent so neutrals come out tinted; bg defaults `#ffffff` /
      `#111111`, matching /create's DEFAULT_RADIX). Returns the existing
      `{ primary, neutral }` 12-step scales.
- [ ] Engine — `packages/theme-engine/src/figma.ts`: generalize
      `scalesToFigmaSvg` from fixed `{ primary, neutral }` to
      `families: { name, scale }[]` stacked vertically (keep a thin
      compat wrapper or update /create's call site). Keeps 11/12-stop
      alpha progressions per family.
- [ ] UI — `components/theme-transpiler/tailwind-creator.tsx` (new):
      dynamic rows of `{ name, color, neutral }` (default one row,
      `brand` / `#3b82f6`); SwatchPopover + name text input + neutral
      checkbox + add/remove. Algorithm seg toggle (ThemeLab `buildScale`
      vs Radix wrapper); appearance seg (light/dark, Radix only — its
      scales are appearance-specific). No EditorShell (that's theme
      chrome); slim `tl-overlay` page with own header.
- [ ] UI — output: reuse `ScaleView` with one row per family; dedicated
      `scale-export-dialog.tsx` (tailwind tab with format select + copy,
      figma tab with SVG preview + "Copy SVG for Figma", mirroring
      ExportDialog patterns — ExportDialog itself stays theme-bound).
- [ ] Route — `apps/web/app/tailwind/page.tsx` + metadata
      ("Build a Tailwind color scale from a single color …").
- [ ] Nav — add `{ title: "Tailwind", url: "/tailwind" }` to
      `app/page.tsx` navLinks and `app/how-it-works/page.tsx` NAV_LINKS.
- [ ] Verify: web typecheck, web vitest (new: radix helper smoke —
      12 steps, all parse as oklch; figma N-family — family ids present),
      `next build`.

Assumptions: (1) row list, not strictly one input — each row is a single
color producing its own named scale; (2) Radix gray = the anchor (tinted
neutrals), backgrounds fixed, no config modal for now; (3) scales-only —
no token sidebar / preview / shadcn export (those stay on /create).

## Review (2026-09-30, built)

- Web: 119/119 vitest (4 new scale-set store tests), engine 85/85
  (radix-scale 2, figma N-family 3), both typechecks clean,
  `next build` passes with `/tailwind` prerendered.
- ESLint: 0 errors on touched files; 1 `<img>` warning on the figma
  preview (same accepted data-URI pattern as export-dialog, 4 at HEAD).
- `LibraryControls.open` routes scale sets to `/tailwind?saved=` instead
  of loading empty theme maps into the theme editor; `/library` opens
  scale sets in `/tailwind`, themes in `/edit`.
- TailwindCreator hydrates via lazy useState initializers (no
  set-state-in-effect); radix+neutral row uses the gray scale so the
  neutral toggle stays meaningful under Radix too.

# Library import/export (2026-06-10)

## Plan

- [x] `lib/saved-themes.ts`: portable file format (`{ version, exportedAt, count, themes }`) —
      `serializeThemesFile`, `parseThemesFile` (accepts wrapped object, bare array, or a single
      bare theme), `sanitizeImportedTheme` (defaults + drop empty themes), `themesFileName`;
      store method `importThemes` that skips duplicate ids and uniquifies names.
- [x] New `components/library/library-io-controls.tsx`: hidden file input + Import (merge) and
      Export (whole library) buttons, toasts for each outcome.
- [x] `library-gallery.tsx`: filter row gains the io controls (shared by /library page and the
      in-tool "My Themes" dialog).
- [x] `saved-theme-card.tsx`: "⋯" menu gains "Export theme (.json)" (same file format, one theme).
- [x] Widen web vitest include to `lib/**` + tests for the file-IO pure functions.
- [x] Verify: web typecheck, eslint, oxlint/oxfmt, web vitest, `next build`.

## Review

- Web: 110/110 vitest (16 new), tsc clean, eslint 0 errors, oxlint clean on touched files,
  `next build` passes with `/library` prerendered.
- Build was broken at HEAD for web (`@themelab/theme-ui` ships TS source but wasn't in
  `transpilePackages`, and its sources used `.js` specifiers Turbopack can't map). Fixed by
  adding `@themelab/theme-ui` to `transpilePackages` and dropping the `.js` extensions
  (Bundler resolution everywhere it's consumed: web + desktop renderer; matches
  `@themelab/shared`'s style). Desktop renderer typecheck passes; desktop main typecheck
  passes once `pnpm build` produces the workspace dists.
- Import semantics: entry ids already in the library are skipped (local copy wins) so
  re-importing a file never duplicates; deleted themes re-import cleanly; names uniquified
  against existing themes and within the batch; favorites preserved; missing fields defaulted
  (`source: "Imported"`, radius `0.625rem`).
- Pre-existing issues not touched: `no-barrel-file` oxlint error in `apps/web/lib/theme-engine/index.ts`,
  4 eslint `<img>` warnings, 17 files failing `format:check:oxc` at HEAD.

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

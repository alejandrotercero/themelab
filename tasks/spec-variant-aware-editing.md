# Spec — Variant-aware editing, optimize-for-mobile, sidebar + font-size shortcuts

> Status tracker for the feature set. Check items off as they land.

## Progress

- [x] **A1** CLI sends Tailwind `screens` + `darkMode` metadata to overlay
- [x] **A2** Variant-target state + segmented selector (`Base·sm·md·lg·xl·2xl`) + `Dark` toggle
- [x] **A3** Apply active variant target on commit; read per-variant value
- [x] **A4** Order-independent variant matching in the CLI transform (+ tests)
- [x] **A5** Dark preview toggle (`.dark` for class strategy; note for media)
- [x] **B** "Optimize for mobile" built-in-AI action (detect → generate → confirm)
- [x] **C** Wider sidebar (300 / 460 / 420 px)
- [x] **D** Font-size token shortcuts (scale picker)

---

## Context

ThemeLab lets you edit a live React app's Tailwind classes from a browser overlay; edits
are written back to source JSX via jscodeshift. Today the property sidebar edits the
**base** utility (or, for responsive, whichever breakpoint variant happens to win at the
*current browser width* — `pickWinningVariant`). Two gaps:

1. **No way to edit `dark:` variants.** `dark:` is treated as a protected state variant —
   preserved but never targetable.
2. **No explicit control over which breakpoint you're editing.** You can only hit a
   breakpoint by physically resizing the browser to it.

Plus three smaller asks: an AI "Optimize for mobile" action after responsive edits, a
wider sidebar, and Tailwind font-size tokens as one-click shortcuts.

**Key architectural finding:** the CLI transform is already *variant-agnostic*.
`buildClass()` prefixes whatever `variant` string it's given, and
`classMatchesPrefixVariant()` matches it (`packages/cli/src/transform.ts:425,454`). So
`variant: "dark"` already produces and targets `dark:bg-red-500` with **zero** transform
changes. The work is almost entirely in the overlay: a variant-target UI, reading the
per-variant value, and a dark-preview toggle. The one CLI change needed is making variant
matching **order-independent** so stacked `dark:md:` ≡ `md:dark:` and edits stay idempotent.

Decisions locked with the user:
- **Optimize for mobile** → ThemeLab's *built-in* AI (CLI calls the configured model, proposes responsive classes, jscodeshift applies on confirm).
- **Variant UI** → explicit segmented selector `Base · sm · md · lg · xl · 2xl` + a `Dark` toggle in the sidebar header.
- **Dark preview** → toggle `.dark` on `<html>` for the Tailwind `class` strategy; detect `media` strategy and show a "can't preview" note.

---

## Feature A — Variant targeting (dark + responsive), unified

A single "active variant target" drives every property edit. UI lives in the sidebar
header (below the file path, above the nav row at `property-sidebar.ts:332`).

### A1. Deliver real Tailwind metadata to the overlay (CLI)

Breakpoints are currently hardcoded (`packages/overlay/src/utils/class-matches-prefix.ts:18`)
and the dark strategy is unknown client-side. Resolve both from the project's Tailwind
config and send them.

- `packages/cli/src/tailwind-resolver.ts` — extend resolution to also return:
  - `screens: Record<string,string>` (breakpoint name → min-width) from v3 `theme.screens` / v4 `--breakpoint-*`.
  - `darkMode: { strategy: "class" | "media"; selector: string }` (v3 `darkMode` config; v4 default `.dark`, or custom `@custom-variant dark`).
- `packages/shared/src/types.ts` — add `screens` and `darkMode` to the `tailwindTokens`
  message payload (extend the existing message at `types.ts:346`).
- `packages/cli/src/server.ts:640` — include them in the `tailwindTokens` send.
- Overlay: `class-matches-prefix.ts` reads `screens` (falling back to hardcoded defaults).

### A2. Variant-target state + selector UI (overlay)

- **New** `packages/overlay/src/properties/variant-target.ts` — module-level state
  `{ breakpoint: "" | "sm" | "md" | "lg" | "xl" | "2xl"; dark: boolean }` with a listener
  pattern (mirrors `canvas-state.ts`). Exposes `getVariantTokens(): string[]` → ordered
  `["dark", "md"]`-style array (dark first, then breakpoint), and `getVariantString()`.
- **New** control in `property-sidebar.ts` header: segmented control of `Base` + each
  project breakpoint, plus a `Dark` toggle pill. Style via existing CSS-in-JS
  (`SIDEBAR_STYLES`, `design-tokens.ts`); reuse `controls/segmented.ts` visual language.
- **Smart default on select:** initialize `breakpoint` to `pickWinningVariant(...)` and
  `dark` to the page's current dark state; the user then overrides.

### A3. Apply the target on commit (overlay)

`packages/overlay/src/properties/property-controller.ts:496-514` is the single commit point:
- Build `variant` from `variant-target.ts` (canonical join, e.g. `"dark:md"`), falling back
  to the winning-viewport variant only when the target is `Base` + no dark (back-compat).
- The displayed value per property comes from the *declared class for the active variant
  set* (new helper `findClassForVariant(classes, matchesBare, variantTokens)`), falling back
  to base / computed style. Touch the read path at `property-controller.ts:440-447`.

### A4. Order-independent variant matching (CLI — the one transform change)

In `packages/cli/src/transform.ts`:
- Rewrite `classMatchesPrefixVariant()` / `classMatchesPattern()` (`transform.ts:454-471`)
  to decompose a class by `:` (bracket-aware — ignore `:` inside `[...]`): last segment is
  the utility, the rest are variant tokens. Match when the variant-token **set** equals the
  update's variant set, then match the utility via `classMatchesPrefix`.
- `buildClass()` writes variants in canonical order (`dark` first, then breakpoint).
- Mirror the decomposition in the overlay copy `utils/class-matches-prefix.ts`.
- Extend fixtures `__tests__/fixtures/classname-variants.tsx` + `update-classname.test.ts`
  with `dark:`, stacked `dark:md:`, and order-swapped cases.

### A5. Dark preview toggle (overlay)

When `dark` turns on and `darkMode.strategy === "class"`: add the configured selector
(default `.dark`) to `<html>`, remembering prior state; remove on toggle off / deselect /
overlay teardown. When `strategy === "media"`: skip the toggle, show a header note ("Dark
uses prefers-color-scheme — preview unavailable"). Editing still writes `dark:`.

---

## Feature B — "Optimize for mobile" (built-in AI)

### B1. Detect & surface (overlay)

After a commit succeeds, if the edited element declares classes at **2+ distinct
breakpoints**, surface an **"Optimize for mobile"** action via the existing toast/action
affordance (`toolbar.ts:172`). Clicking sends a new client message `optimizeResponsive`
with the element identity, current class string, and viewport width.

### B2. Generate (CLI) — **new** `packages/cli/src/ai-optimize.ts`

Reuse the AI infra in `ai-locate.ts` (`ANTHROPIC_API_KEY` gating, Anthropic client, tiered
models, read-only source access):
1. **Locate** the element via the existing deterministic + AI locate path → file/line/node + className.
2. **Generate** a mobile-first className: add base (mobile) utilities, keep existing desktop
   values behind their breakpoints; the render at the current width must not change. Output
   is the new className string only (location-locked, single element, read-only).
3. **Propose** an `old → new` diff via the existing AI confirm UI; apply through the
   deterministic className transform on confirm.
- No key → toast "Set ANTHROPIC_API_KEY to use Optimize."
- `server.ts` handles `optimizeResponsive` and routes to `ai-optimize.ts`.

---

## Feature C — Wider sidebar

`packages/overlay/src/properties/property-sidebar.ts:7-11`:
- `MIN_WIDTH 260 → 300`, `MAX_WIDTH 380 → 460`, `DEFAULT_WIDTH → 420`.
- Keep `loadWidth()` clamp + ~45%-viewport failsafe; clamp a stored width **up** to the new
  `MIN_WIDTH` if below. Sanity-check that controls + token labels stop crowding.

---

## Feature D — Font-size token shortcuts

Font size is a `number-scrub` today (`property-descriptors.ts:119`, `controls/number-scrub.ts`):
- **New** `packages/overlay/src/properties/controls/scale-shortcut.ts` — popover listing the
  project's `fontSize` scale from `getTokenMap().fontSize` (token + resolved px); click
  applies via the same commit path (variant target honored automatically).
- Trigger: a shortcut button next to the font-size token label (like the color swatch's
  palette button). Reuse `number-scrub.ts`'s `getSnapPoints`.
- Build reusably (keyed on `tailwindScale`) but wire up **only font size** now.

---

## Critical files

**CLI**
- `packages/cli/src/tailwind-resolver.ts` — emit `screens` + `darkMode` (A1)
- `packages/cli/src/server.ts` — send metadata (A1); handle `optimizeResponsive` (B)
- `packages/cli/src/transform.ts` — order-independent variant matching (A4)
- **New** `packages/cli/src/ai-optimize.ts` — generate responsive classes (B2)
- `packages/shared/src/types.ts` — `screens`/`darkMode` on tokens msg; `optimizeResponsive` message

**Overlay**
- **New** `packages/overlay/src/properties/variant-target.ts` — variant state (A2)
- `packages/overlay/src/properties/property-sidebar.ts` — selector + Dark toggle (A2); width (C)
- `packages/overlay/src/properties/property-controller.ts` — apply variant on commit, per-variant read (A3)
- `packages/overlay/src/utils/class-matches-prefix.ts` — honor `screens`; set-based match (A1/A4)
- **New** `packages/overlay/src/properties/controls/scale-shortcut.ts` — font-size picker (D)
- `packages/overlay/src/toolbar.ts` — Optimize-for-mobile action (B1)

---

## Verification

1. **Type + build + tests:** `pnpm build`, `pnpm -r exec tsc --noEmit`, `pnpm test`.
   New unit tests: order-independent variant matching (`dark:`, stacked `dark:md:`, order-swapped).
2. **Dark editing (manual, `pnpm dev` — ask before starting a server):** flip `Dark` →
   page goes dark, change background → source gains/edits `dark:bg-*`, base untouched; toggle
   off → restores. On a `media` app the note shows and `dark:` is still written.
3. **Responsive targeting:** narrow viewport, pick `xl`, change padding → writes `xl:p-*`,
   base + other breakpoints intact.
4. **Optimize for mobile:** edit an element with 2+ breakpoints → action appears; with key →
   proposal diff → confirm → mobile-first className, desktop render unchanged; no key → toast.
5. **Sidebar width:** fresh load 420px; controls/popover fit; resize works to 460px max.
6. **Font-size shortcuts:** picker lists text-scale tokens with px; click applies; variant
   target writes `md:`/`dark:` correctly.
7. **Diff vs `main`:** base/`hover:`/`focus:` editing unchanged — only `dark:` and
   explicit-breakpoint editing are new.

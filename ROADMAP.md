# themelab — Roadmap & Spec

> Status: draft v1 · 2026-05-28 (updated 2026-05-31 — M0–M2 + #4 + #5 shipped; resolver hardened + AI locator across edits, move up/down, and .map() list reordering; remaining: #8 fonts, M3 theme v2)
> Scope: turn themelab from a per-element class editor into a full **visual editor for shadcn/Tailwind apps** — both the *elements* and the *theme*.
> Grounded in: the current codebase (`packages/{cli,overlay,shared}`), hands-on testing feedback, and the tweakcn theme-editor model (Apache-2.0, cloned at `/Users/alejandro/DEV/tweakcn`).

---

## 0. North star

Two complaints define the gap between "neat demo" and "daily driver":

1. **It edits the wrong altitude.** Today it writes a static class (`bg-white`) onto one element. shadcn apps are themed through **CSS variables** (`--primary`, `--background`, …) split across light/dark. Editing an element bakes a value in and breaks dark mode. We need to edit the **theme tokens** too.
2. **It doesn't fully own the page.** Ambiguous clicks, no hierarchy navigation, no auto-refresh — friction on every action.

So the product becomes **two editing modes** sharing one overlay:

| Mode | You edit | Written to | Mechanism |
|---|---|---|---|
| **Element mode** (exists) | one element's classes / text / order / position | the element's JSX | jscodeshift AST transform |
| **Theme mode** (new) | design tokens: color, font, radius, shadow, spacing | `globals.css` `:root` + `.dark` | CSS-var block rewrite (PostCSS) |

Editing the *token* is what structurally fixes color/dark-mode/font (issues #2/#3/#8): change `--primary` once and both modes + every component update.

---

## 1. Theme mode (the tweakcn-derived feature)

### 1.1 Data model

Adopt tweakcn's schema (`tweakcn/types/theme.ts`) — it's the canonical shadcn token set:

```ts
type ThemeStyleProps = {
  // colors (paired fg/bg)
  background, foreground, card, "card-foreground", popover, "popover-foreground",
  primary, "primary-foreground", secondary, "secondary-foreground",
  muted, "muted-foreground", accent, "accent-foreground",
  destructive, "destructive-foreground", border, input, ring,
  "chart-1".."chart-5",
  sidebar, "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
  // typography
  "font-sans", "font-serif", "font-mono", "letter-spacing",
  // shape / depth / rhythm
  radius,
  "shadow-color", "shadow-opacity", "shadow-blur", "shadow-spread",
  "shadow-offset-x", "shadow-offset-y",
  spacing?,
};
type ThemeStyles = { light: ThemeStyleProps; dark: ThemeStyleProps };
```

Lives in `packages/shared/src/types.ts`. The overlay edits a `ThemeStyles` object; the CLI reads/writes it to disk.

### 1.2 Import — read the project's current theme

**New CLI capability.** On startup, locate and parse the theme source:
- Tailwind v4: the `@theme {}` / `:root {}` / `.dark {}` blocks in the CSS entry (extend the existing `findThemeFiles()` in `cli/tailwind-resolver.ts`, which already greps for `@theme`).
- shadcn convention: `app/globals.css` or `src/index.css` `:root {}` (light) + `.dark {}` (dark).
- Parse CSS-var declarations into `ThemeStyles`. Reference: `tweakcn/utils/parse-css-input.ts`.

Send `ThemeStyles` to the overlay over the existing WebSocket alongside the Tailwind token map.

### 1.3 Edit — the Theme panel (overlay)

A new sidebar tab beside the element property panel. Controls, by section (mirrors tweakcn's single-panel layout):
- **Colors** — OKLCH/HSL/hex picker per token, fg/bg shown as pairs, with **contrast check** on each pair. A **light/dark toggle** edits `styles.light` vs `styles.dark` (the same toggle re-applies preview — see 1.5).
- **Typography** — `font-sans/serif/mono` pickers from a curated Google-font list + detected project fonts (`tweakcn/utils/theme-fonts.ts`), plus `letter-spacing`.
- **Radius** — single `--radius` slider.
- **Shadows** — composed from `shadow-color/opacity/blur/spread/offset-x/offset-y`.
- **Presets** — starter themes (ship a few; reuse tweakcn's preset JSON shape `ThemePreset`).

### 1.4 Color closeness (fixes #2)

Port the removed **Lab/Delta-E nearest-color** logic from `recovered/cli/resolve-intent.ts` into the overlay. In the picker, show "≈ `red-600` (ΔE 1.8)" against the project's Tailwind palette so you know how far you are from a named token. (This code already exists, just needs relocating + an MIT-clean rewrite.)

### 1.5 Live preview (fixes #3, partially #7)

themelab's advantage over tweakcn: **the overlay is on the same page as the app** (Shadow DOM), not a separate gallery. So preview = override CSS vars on the live `:root`:
- Apply edits by setting `document.documentElement.style.setProperty('--primary', value)` (and a `.dark` scope variant). Instant, no rebuild, no refresh. Reference: `tweakcn/utils/apply-theme.ts` (adapt — we don't need the iframe injector since we're in-page).
- Dark mode: detect the app's dark strategy (`.dark` class on `<html>`/`<body>` or `data-theme`), preview both, and **write both** on confirm.

### 1.6 Color value model — Figma-style variable binding (fixes #2/#3)

Every editable color is in one of two states, mirroring Figma's variable UX:

- **Bound to a token** — the value is a theme var (e.g. `var(--primary)` or a Tailwind token). The control shows the **token name + swatch**, and clicking it opens a **dropdown of available variables** (the project's theme tokens + Tailwind palette) to rebind to a different one. This is the default whenever the resolved color matches a known token.
- **Raw / detached** — a hardcoded color. Reached via a **"Detach"** action on a bound value (Figma's detach), which drops to the OKLCH/hex picker. The picker still shows **Delta-E closeness** ("≈ `red-600`, ΔE 1.8") and offers a one-click **"Use variable"** to re-bind.

Rules:
- Editing a **bound** color in Theme mode edits the **token** (writes `globals.css`, updates light+dark, every consumer) — never bakes a literal onto one element.
- **Detach** is explicit and per-element: it writes a raw class/value to that element's JSX only.
- In **Element mode**, selecting an element whose color resolves to a var shows the same bound-state control: rebind to another var, or detach to a raw color. No silent literal-baking (this is the root of issue #3).

> This makes "bound vs raw" a first-class concept, so dark mode never breaks unless the user explicitly detaches.

### 1.7 Export — write the theme back (fixes #3/#8 at the source)

On Confirm, the CLI rewrites the `:root {}` and `.dark {}` blocks in the theme CSS file:
- Upsert each changed CSS var; preserve untouched declarations, comments, ordering.
- Reference serializer: `tweakcn/utils/theme-style-generator.ts`.
- This is a **CSS/PostCSS edit, not jscodeshift** — simpler and safer than the JSX path. Add `postcss` (or a scoped regex block-rewriter) to the CLI.
- Font additions: if a chosen font isn't loaded, surface the `next/font` or `<link>` snippet to add (don't silently break).

---

## 2. Element mode — the 8 hardening issues

Each is mapped to root cause + fix + files + effort (S/M/L).

### #1 — Interaction-mode ambiguity · **L** · flow-breaker
- **Root cause:** in `select` tool, `interaction.ts` sets overlay `pointer-events:none` so events fall through to the app (app hover/click fires), while `selection.ts` *also* listens in capture phase — two mechanisms racing. No explicit mode.
- **Fix:** introduce an explicit interaction state machine: **Inspect** (overlay owns all pointer events; app is inert; hover = highlight, click = select, dblclick = text-edit) vs **Interact** (pass-through so you can navigate the app). A visible toggle + hotkey (e.g. `Esc`/`I`). In Inspect, overlay div is `pointer-events:auto` and swallows app events; selection is driven from the overlay's own handlers, not capture-phase listeners on the app.
- **Files:** `interaction.ts`, `selection.ts`, `inline-text-edit.ts`, `toolbar.ts`.

### #6 — Hierarchy / level navigation · **M** · flow-breaker
- **Root cause:** selection lands on the deepest hit element (`getPageElementAtPoint` → first visible). No parent traversal; `component-filter.ts` filters validity, not depth.
- **Fix:** (a) keyboard nav — `↑`/`Esc` select parent, `↓` first child, `←/→` siblings (walk fiber/DOM tree). (b) a breadcrumb of ancestors in the sidebar, click to select. (c) optional: hover-hold to cycle ancestors. (d) snap selection to the nearest *component boundary* by default (fiber owner), with drill-down for host elements.
- **Files:** `selection.ts` (key handlers ~896-1052), `component-filter.ts`, `highlight-canvas.ts` (breadcrumb/ancestor outline).

### #7 — No auto-refresh after write · **S–M** · flow-breaker
- **Root cause:** the proxy *does* forward HMR websockets (`inject.ts:121 proxy.ws`) and self-handles HTML to inject the overlay, yet edits need a manual refresh — so HMR-over-proxy isn't applying, or there's no post-write signal.
- **Fix:** diagnose live with `--verbose` + browser console (is the HMR socket connecting to the proxy origin?). Likely fixes: ensure the HMR client connects through the proxy (rewrite the HMR endpoint), and/or after a successful write the CLI pushes a `reload`/`applied` message over the themelab WS and the overlay either relies on HMR or does a soft refresh. With Theme mode (CSS-var preview), color/font edits won't need any reload at all.
- **Files:** `inject.ts`, `server.ts`, overlay WS bridge (`bridge.ts`).

### #4 — Lists / `.map()` → master component · **L** · **done (AI locator)**
- **Root cause:** clicking a mapped `<TweetCard>` builds a jsxPath with an **index discriminator** (4th instance), so `cli/jsx-path-resolver.ts` looks for a 4th element that doesn't exist in source — should target `TweetCard.tsx`.
- **Shipped:** rather than encode every structural shape deterministically, the deterministic resolver now **fails loudly** (typed `AMBIGUOUS` / no-match) and an opt-in **AI locator** (`cli/ai-locate.ts`) reads the source to resolve the residual — `.map()` templates, reused component instances, conditional/state-dependent rendering, and DOM≠source tags (`<Link>`→`<a>`). It returns a *location only*; the deterministic transform still applies the edit. `direct`/`conditional` apply automatically; `map-template`/`instance` confirm first (they affect more than the selected element). Off by default (needs `ANTHROPIC_API_KEY`).
- **Files:** `cli/ai-locate.ts`, `cli/batch-transform.ts` (`verifyIdentity`, candidate surfacing, `trustLocation`), `cli/config.ts`, `overlay/settings-panel.ts`.

### #5 — Reorder siblings in source via drag · **M**
- **Root cause:** the move tool only applies a visual `transform: translate` and never emits a reorder op; source reorder exists only as a line-swap requiring direct AST siblings (`transform.ts mutateReorder`).
- **Fix:** add a "reorder" gesture — when dragging an element over a sibling slot, snap to insertion points and emit `{op:"reorder", fromIndex, toIndex, parentPath}`. Wire it to the existing `mutateReorder`. Show drop indicators (the drag.ts/snap-guides infra exists).
- **Files:** `tools/move.ts`, `move-state.ts`, `drag.ts`, `snap-guides.ts`, `batch-transform.ts`, `cli/transform.ts`.

### #2 / #3 / #8 — colors closeness / shadcn vars+dark / fonts
- **Subsumed by Theme mode.** #2 → Delta-E closeness in the picker (§1.4). #3 → the **bound/detached variable model** (§1.6): element colors that resolve to a var stay bound (edit the token, light+dark together) unless explicitly detached, so dark mode can't silently break. #8 → typography controls (§1.3).

---

## 3. Reuse from tweakcn (Apache-2.0 → MIT)

> **Decision: reimplement, don't lift.** tweakcn is reference-only — we read it to understand the approach, then write our own. Keeps the tree fully MIT-clean with **no NOTICE/attribution burden**. (Plain data — font lists, preset values, the token *names* — isn't copyrightable expression and can be reused directly.)

| Need | tweakcn reference (read only) | Plan |
|---|---|---|
| Token schema | `types/theme.ts` | Reimplement in `shared` |
| Read globals.css → theme | `utils/parse-css-input.ts` | Reimplement (our CSS-block reader) |
| Theme → globals.css | `utils/theme-style-generator.ts` | Reimplement (our writer) |
| OKLCH/HSL/hex conversion | `utils/color-converter.ts` | Reimplement (small) |
| Font catalog | `utils/theme-fonts.ts`, `utils/fonts.ts` | Reuse list (data, not code) |
| Apply vars live | `utils/apply-theme.ts` | Reimplement (in-page, no iframe) |
| Presets | `utils/theme-presets.ts` | Reuse values (data) |

---

## 4. Sequenced roadmap

**M0 — Unblock & validate (now)**
- [x] Build local `main` (ahead of npm 0.1.1)
- [x] **#7 auto-refresh** — effectively resolved; HMR now reflects writes once resolution lands correctly (the earlier "had to refresh" was failing writes, since fixed)
- **Not publishing** — this isn't our repo to release. Work stays local / goes back as a contribution if/when upstream wants it.

**M1 — Own the page (flow-breakers)**
- [x] #1 Interact mode — toggle with `` ` `` (select by default)
- [x] #6 hierarchy navigation — keyboard (↑↓←→) + sidebar buttons (breadcrumb still TODO)

**M2 — Theme mode v1 (the big bet)**
- [x] `shared` ThemeStyles model
- [x] CLI import (`:root`/`.dark` CSS-var blocks → tokens) + export (write back, original format preserved)
- [x] Overlay Theme panel: per-token color swatches (hsl-triple/oklch/hex), light/dark toggle, in-page live preview
- [x] #2 color picking — shipped as a **Tailwind palette picker** (tweakcn-style) instead of Delta-E closeness, per product decision

**M3 — Theme mode v2**
- [ ] Fonts (#8) — pickers + font-loading snippet
- [ ] Shadows, letter-spacing, spacing
- [ ] Presets + import-from-pasted-CSS

**M4 — Structural editing**
- [x] #5 reorder siblings → source — via move up/down buttons + `[` / `]` (server-side AST swap; drag was dropped as unreliable)
- [x] #4 `.map()` / conditional → master-component routing — via the opt-in **AI locator** (reads source to resolve maps/instances/conditionals/DOM≠source tags; deterministic apply; structural edits confirm). Builds on a hardened resolver that fails loudly instead of guessing.

**Don't regress** (validated wins): canvas zoom, flexbox property controls, inline text editing.

---

## 5. Decisions & open questions

**Decided:**
- **No publishing** — not our repo to release (§4 M0).
- **Reimplement, don't lift** tweakcn — reference-only, MIT-clean (§3).
- **Color = bound-or-detached** (Figma-style): vars edit the token by default; explicit Detach for a raw value; rebind to another var anytime (§1.6).

**Open:**
- Theme file discovery when non-standard (monorepo, multiple CSS entries) — config flag?
- Dark-mode strategy detection: class vs `data-theme` vs media — auto-detect + override?

---

### Sources
- [tweakcn (GitHub)](https://github.com/jnsahaj/tweakcn) · Apache-2.0
- [All Shadcn — tweakcn](https://allshadcn.com/tools/tweakcn/)
- [Tailkits — TweakCN](https://tailkits.com/tools/tweakcn/)
- [shadcn/ui theming docs](https://ui.shadcn.com/docs/theming)

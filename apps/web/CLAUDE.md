# CLAUDE.md — @themelab/web (theme studio)

Next.js 16 / React 19 / Tailwind v4 app in the ThemeLab monorepo. Two tools (`/100r`, `/create`) for
generating and translating shadcn themes. Read this before editing — it captures the non-obvious bits.

## Run / verify

```bash
pnpm --filter @themelab/web typecheck   # tsc --noEmit — run after changes
pnpm --filter @themelab/web build        # next build
pnpm dev:web                             # ask before starting a dev server
```

## Architecture

- **Engine** (`lib/theme-engine/`) — pure TS, no React. The source of truth for color math.
  - `oklch.ts` — culori helpers: `toOklch`, `lStar`, `lerpOklch`, `sampleRamp`, `reformat` (oklch/hsl/hex/rgb), `hslTriple`.
  - `transpile.ts` — `hrToThemeStyles` (9 HR colors → 31 tokens), `paletteToThemeStyles` / `paletteToScales` (the **ThemeLab** synthesis), `buildMode`, `THEME_TOKENS`.
  - `scale.ts` — `buildScale` (Tailwind 50–950), `scalesToThemeStyles` (scale stops → tokens), `STOP_LIGHTNESS`.
  - `radix/` — `generate-radix-colors.ts` is **vendored verbatim** from Radix (MIT, `@ts-nocheck`, do not "clean up"); `index.ts` is our adapter: `radixThemeStyles({light,dark})` + `radixScales(...)`.
  - `css.ts` — `themeStylesToCss` (:root/.dark/@theme) + `themeToJson` (flat tweakcn-style object; shadows derive from foreground).
  - `validate.ts` — the `/100r` luminance gate. `presets.ts` — bundled HR themes.
- **UI** (`components/theme-transpiler/`) — both tools share `useThemeEditor` (overrides/mode/radius/apply-to-page + rootRef) and `EditorShell` (toolbar · token sidebar · preview · boom bar). `ThemeTranspiler` = /100r, `ThemeCreator` = /create.
- **Theme model** is `ThemeStyles` from `@themelab/shared` (`{ light, dark }` of `--token` → value).

## Gotchas (learned the hard way)

- **shadcn components are base-ui, NOT Radix.** APIs differ: `Select.onValueChange` is `(value: string | null)`; `Accordion` uses `multiple` (not `type`/`collapsible`); `Slider.onValueChange` value is `number | number[]`. Guard accordingly.
- **Overlay skin** lives in `globals.css` under `.tl-overlay` (the tool chrome's dark-navy look, mirroring `packages/overlay/src/design-tokens.ts`). It maps shadcn tokens to `--ov-*` so embedded controls adopt the look. **`.ov-*` classes are unlayered CSS** → they beat Tailwind utilities (this bit us: `.ov-input { width }` overrode `w-[…]`). Keep `--ov-*` as variables so the skin stays overridable; no raw hex in TSX.
- **Portaled content escapes `.tl-overlay`** (Dialog/Select content render at `<body>`). Add `className="tl-overlay"` to those popups to keep them themed.
- **Preview must be scoped**: `PreviewPane` applies tokens as inline vars on its own element (+ local `.dark`), and uses **Inter** (`--font-inter`) while the chrome uses Google Sans Code. "Apply to page" re-skins the whole root via `ovSkinVars`.
- **Kibo color picker** (`components/kibo-ui/color-picker`): its controlled `value` is buggy and its selection thumb doesn't sync on mount — both patched (we seed `defaultValue` + a mount effect). Alpha is ignored (tokens are opaque).
- **Two algorithms on /create fill BOTH the theme and the scales** so they stay consistent. ThemeLab default; Radix secondary. Radix takes per-mode accent/neutral/background (a modal), so its scales differ by light/dark. Radix output is normalized to `oklch` in the adapter for display parity (export reformats anyway).

## Conventions

- Run `typecheck` after edits. Reuse the engine — don't reimplement color math in components.
- Vendored third-party files carry an attribution header + a `NOTICE` entry (tweakcn, Kibo, Radix).
- The app font is **Google Sans Code** (matches the overlay); the preview opts into **Inter**.

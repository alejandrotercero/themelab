# @themelab/web

The ThemeLab theme studio — a Next.js 16 (Tailwind v4 + shadcn) app for generating and translating
design-token themes. Part of the ThemeLab monorepo.

## Tools

- **`/100r`** — transpile a 9-color Hundred Rabbits SVG theme into a full shadcn theme (light + dark)
  via OKLCH interpolation, with a luminance benchmark, editable tokens, live preview, and CSS / JSON export.
- **`/create`** — generate a theme + matching scales from a palette, with two toggleable algorithms:
  - **ThemeLab** — OKLCH synthesis from a primary + neutral.
  - **Radix** — the real `generateRadixColors` (accent, neutral, per-mode background) → 12-step scales.

## Run

From the repo root:

```bash
pnpm dev:web     # next dev
pnpm build:web   # next build
```

## Layout

```text
app/                 routes: / (home), /100r, /create
lib/theme-engine/    pure-TS color engine
  oklch.ts             culori helpers, format conversion
  transpile.ts         HR → shadcn + palette synthesis
  scale.ts             Tailwind 50–950 scales + scale→token mapping
  css.ts               tokens → CSS / JSON export
  validate.ts          luminance gate (the /100r benchmark)
  presets.ts           bundled HR themes
  radix/               vendored generateRadixColors + adapter
components/
  theme-transpiler/    the studio UI (editor shell, token controls, dialogs, preview)
  kibo-ui/             Kibo color picker
  ui/                  shadcn (base-ui) components
```

See [`CLAUDE.md`](./CLAUDE.md) for engineering notes, and [`NOTICE`](./NOTICE) for attribution
(tweakcn Apache-2.0, Kibo UI MIT, Radix `generateRadixColors` MIT).

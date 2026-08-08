// Serialize a ThemeStyles object into Tailwind-v4 shadcn CSS (`:root` + `.dark`
// + `@theme inline` mappings), shaped to match apps/web/app/globals.css so the
// output can be pasted straight in.
//
// Adapted from tweakcn (https://github.com/jnsahaj/tweakcn), Apache-2.0 —
// utils/theme-style-generator.ts (Tailwind v4 branch). See apps/web/NOTICE.

import type { ThemeStyles } from "@themelab/shared"

import { hslTriple, reformat } from "./oklch"
import type { ColorFormat } from "./oklch"
import { THEME_TOKENS } from "./transpile"

/** The standard shadcn/tweakcn shadow scale, tinted by the theme's foreground. */
function shadowVars(foreground: string): Record<string, string> {
  const c = (a: string) => `hsl(${hslTriple(foreground)} / ${a})`
  return {
    "--shadow-2xs": `0px 1px 3px 0px ${c("0.05")}`,
    "--shadow-xs": `0px 1px 3px 0px ${c("0.05")}`,
    "--shadow-sm": `0px 1px 3px 0px ${c("0.10")}, 0px 1px 2px -1px ${c("0.10")}`,
    "--shadow": `0px 1px 3px 0px ${c("0.10")}, 0px 1px 2px -1px ${c("0.10")}`,
    "--shadow-md": `0px 1px 3px 0px ${c("0.10")}, 0px 2px 4px -1px ${c("0.10")}`,
    "--shadow-lg": `0px 1px 3px 0px ${c("0.10")}, 0px 4px 6px -1px ${c("0.10")}`,
    "--shadow-xl": `0px 1px 3px 0px ${c("0.10")}, 0px 8px 10px -1px ${c("0.10")}`,
    "--shadow-2xl": `0px 1px 3px 0px ${c("0.25")}`,
  }
}

/**
 * Flat `--token: value` object for one mode's tokens, plus the shadow scale
 * (from this mode's foreground). When `meta` is set, also emits the radius,
 * tracking and spacing that belong on `:root` only.
 */
function modeObject(
  vars: Record<string, string>,
  opts: { radius: string; format: ColorFormat; meta: boolean }
): Record<string, string> {
  const out: Record<string, string> = {}
  if (opts.meta) {
    out["--radius"] = opts.radius
  }
  for (const token of THEME_TOKENS) {
    if (vars[token] !== undefined) {
      out[`--${token}`] = reformat(vars[token], opts.format)
    }
  }
  Object.assign(out, shadowVars(vars.foreground ?? "#000000"))
  if (opts.meta) {
    out["--tracking-normal"] = "0em"
    out["--spacing"] = "0.25rem"
  }
  return out
}

/**
 * Flat `--token: value` JSON for one mode's tokens, plus radius, the shadow
 * scale (from foreground), tracking and spacing — the tweakcn theme-object shape.
 */
export function themeToJson(
  vars: Record<string, string>,
  opts: { radius?: string; format?: ColorFormat } = {}
): string {
  const radius = opts.radius ?? "0.625rem"
  const format = opts.format ?? "hex"
  return JSON.stringify(
    modeObject(vars, { radius, format, meta: true }),
    null,
    2
  )
}

/**
 * Dual-mode JSON keyed to the CSS selectors — `{ "root": {…}, "dark": {…} }` —
 * so the JSON export carries both light and dark, mirroring the CSS export.
 * Round-trips through `parseThemeInput` in @themelab/shared.
 */
export function themeStylesToJson(
  theme: ThemeStyles,
  opts: { radius?: string; format?: ColorFormat } = {}
): string {
  const radius = opts.radius ?? "0.625rem"
  const format = opts.format ?? "hex"
  return JSON.stringify(
    {
      root: modeObject(theme.light, { radius, format, meta: true }),
      dark: modeObject(theme.dark, { radius, format, meta: false }),
    },
    null,
    2
  )
}

export interface CssOptions {
  /** Base radius, e.g. "0.625rem". */
  radius?: string
  /** Color format to emit token values in. Defaults to "oklch". */
  format?: ColorFormat
}

export function themeStylesToCss(
  theme: ThemeStyles,
  opts: CssOptions = {}
): string {
  const radius = opts.radius ?? "0.625rem"
  const format = opts.format ?? "oklch"

  const block = (vars: Record<string, string>, withRadius: boolean) => {
    const lines: string[] = []
    if (withRadius) {
      lines.push(`  --radius: ${radius};`)
    }
    for (const token of THEME_TOKENS) {
      if (vars[token] !== undefined) {
        lines.push(`  --${token}: ${reformat(vars[token], format)};`)
      }
    }
    return lines.join("\n")
  }

  const themeInline = [
    "  --radius-sm: calc(var(--radius) - 4px);",
    "  --radius-md: calc(var(--radius) - 2px);",
    "  --radius-lg: var(--radius);",
    "  --radius-xl: calc(var(--radius) + 4px);",
    ...THEME_TOKENS.map((t) => `  --color-${t}: var(--${t});`),
  ].join("\n")

  return [
    `:root {\n${block(theme.light, true)}\n}`,
    `.dark {\n${block(theme.dark, false)}\n}`,
    `@theme inline {\n${themeInline}\n}`,
  ].join("\n\n")
}

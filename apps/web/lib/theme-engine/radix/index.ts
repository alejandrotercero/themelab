// Adapter around Radix's generateRadixColors: turn its 12-step accent/gray
// scales into our shadcn 31-token theme (light + dark) and into our Scale type
// for the scale view / export / token-override palette.

import type { ThemeStyles } from "@themelab/shared"

import { reformat } from "../oklch"
import type { Scale } from "../scale"
import { generateRadixColors } from "./generate-radix-colors"

/** Radix emits sRGB hex; normalize to oklch so the editor reads consistently
 *  with the ThemeLab algorithm (exports reformat independently anyway). */
const oklch = (v: string) => reformat(v, "oklch")

export type Appearance = "light" | "dark"

/** Per-appearance Radix inputs — accent, gray and background tweaked separately. */
export interface RadixModeColors {
  accent: string
  gray: string
  bg: string
}

export interface RadixInputs {
  light: RadixModeColors
  dark: RadixModeColors
}

type RadixResult = ReturnType<typeof generateRadixColors>

// Standard shadcn destructive reds (Radix output carries no red of its own).
const RED_LIGHT = "#dc2626"
const RED_DARK = "#e5484d"

/** Radix steps are 1–12; the hex arrays are 0-indexed, so step N = index N-1. */
function mapTokens(r: RadixResult, red: string): Record<string, string> {
  const a = (step: number) => oklch(r.accentScale[step - 1])
  const g = (step: number) => oklch(r.grayScale[step - 1])
  const bg = oklch(r.background)
  const contrast = oklch(r.accentContrast)
  return {
    background: bg,
    foreground: g(12),
    card: bg,
    "card-foreground": g(12),
    popover: bg,
    "popover-foreground": g(12),
    primary: a(9),
    "primary-foreground": contrast,
    secondary: g(3),
    "secondary-foreground": g(12),
    muted: g(3),
    "muted-foreground": g(11),
    accent: g(4),
    "accent-foreground": g(12),
    destructive: oklch(red),
    "destructive-foreground": oklch("#ffffff"),
    border: g(6),
    input: g(7),
    ring: a(8),
    "chart-1": a(9),
    "chart-2": a(10),
    "chart-3": a(8),
    "chart-4": a(11),
    "chart-5": a(7),
    sidebar: g(2),
    "sidebar-foreground": g(12),
    "sidebar-primary": a(9),
    "sidebar-primary-foreground": contrast,
    "sidebar-accent": g(4),
    "sidebar-accent-foreground": g(12),
    "sidebar-border": g(6),
    "sidebar-ring": a(8),
  }
}

/** Full shadcn theme (both modes) from Radix's real generator. */
export function radixThemeStyles({ light, dark }: RadixInputs): ThemeStyles {
  const lightOut = generateRadixColors({
    appearance: "light",
    accent: light.accent,
    gray: light.gray,
    background: light.bg,
  })
  const darkOut = generateRadixColors({
    appearance: "dark",
    accent: dark.accent,
    gray: dark.gray,
    background: dark.bg,
  })
  return {
    light: mapTokens(lightOut, RED_LIGHT),
    dark: mapTokens(darkOut, RED_DARK),
  }
}

/** The 12-step accent + gray scales for one appearance, as our Scale type. */
export function radixScales(args: {
  accent: string
  gray: string
  background: string
  appearance: Appearance
}): {
  primary: Scale
  neutral: Scale
} {
  const r = generateRadixColors({
    appearance: args.appearance,
    accent: args.accent,
    gray: args.gray,
    background: args.background,
  })
  const toScale = (hexes: string[]): Scale =>
    hexes.map((value, i) => ({ stop: i + 1, value: oklch(value) }))
  return { primary: toScale(r.accentScale), neutral: toScale(r.grayScale) }
}

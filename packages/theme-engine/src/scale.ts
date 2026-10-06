// Tailwind-style 50→950 color scales from a single anchor color, in OKLCH.
// The anchor is placed ON the scale at its own lightness and the rest of the
// ramp is shaped around it, so the picked color is always an actual stop. A
// fixed perceptual lightness curve supplies the ramp's shape and a chroma curve
// that peaks mid-scale (500–600) supplies saturation.

import type { ThemeStyles } from "@themelab/shared"

import { mapToSrgb, oklchCss, reformat, toOklch } from "./oklch"
import type { ColorFormat } from "./oklch"

export const TAILWIND_STOPS = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
] as const

// Chromatic lightness per stop (OKLCH L, 0–1) — Tailwind-like curve, light →
// dark. Its 950 is a deep shade but NOT near-black, matching Tailwind's own
// color ramps (e.g. blue-950 is L 0.282).
export const STOP_LIGHTNESS = [
  0.971, 0.936, 0.885, 0.808, 0.704, 0.637, 0.577, 0.505, 0.444, 0.396, 0.262,
]

// Neutral lightness per stop — Tailwind's actual `gray` ramp. Neutrals need a
// deeper dark end than chromatic scales: Tailwind runs gray/slate 950 to ~0.13
// while its color ramps stop around 0.26. Sharing one curve made neutral scales
// end on charcoal (950 ≈ #242424) instead of near-black (≈ #070707).
export const NEUTRAL_LIGHTNESS = [
  0.985, 0.967, 0.928, 0.872, 0.707, 0.551, 0.446, 0.373, 0.278, 0.21, 0.13,
]

// Fraction of the anchor's chroma per stop — peaks at 500/600, tapers at ends.
const CHROMA_CURVE = [
  0.18, 0.32, 0.55, 0.78, 0.92, 1, 1, 0.94, 0.84, 0.74, 0.55,
]

/** Chroma at or below this counts as achromatic (culori reports exactly 0 for
 *  pure grays, so this cleanly separates them from any real tint). */
const ACHROMATIC_C = 0.002

/** Neutral ramps cap chroma at this value. */
const NEUTRAL_CHROMA_CAP = 0.02

/**
 * Monotone chroma compression whose asymptote is `cap`. A flat `min(c, cap)`
 * collapses every color above the cap to identical output; this keeps the
 * ordering and the differences (however small) between distinct colors.
 */
function softCap(c: number, cap: number): number {
  return cap <= 0 ? 0 : (cap * c) / (c + cap)
}

/** Index of the stop whose reference lightness is closest to `l`. */
function nearestStopIndex(curve: readonly number[], l: number): number {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [i, ref] of curve.entries()) {
    const distance = Math.abs(ref - l)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/**
 * Warp a monotone lightness curve so it passes exactly through `(kStar, l)`
 * while keeping both endpoints. Each side is a rescale of the reference curve's
 * lightness drop, so the ramp keeps its Tailwind-like spacing, stays monotone,
 * and works for any anchor lightness — including one outside the curve's own
 * range (a near-white or near-black anchor simply pulls that end).
 */
function anchorLightness(
  curve: readonly number[],
  kStar: number,
  l: number
): number[] {
  const top = curve[0]!
  const bottom = curve[curve.length - 1]!
  const pivot = curve[kStar]!
  return curve.map((ref, k) => {
    if (k <= kStar) {
      const span = top - pivot
      return span === 0 ? l : top - ((top - ref) / span) * (top - l)
    }
    const span = pivot - bottom
    return span === 0 ? l : l - ((pivot - ref) / span) * (l - bottom)
  })
}

export interface ScaleStop {
  stop: number
  /** `oklch(...)` string. */
  value: string
}

export type Scale = ScaleStop[]

/**
 * Build a 50→950 scale from an anchor color.
 *
 * The anchor lands on the stop nearest its lightness and is emitted there
 * verbatim (same L, C and H), so the color you picked is genuinely in the
 * palette; the remaining stops are rescaled around it. With `neutral` the ramp
 * is desaturated (monotone chroma compression toward 0.02) and uses the deeper
 * neutral lightness curve, so the anchor's chroma is intentionally not
 * reproduced.
 */
export function buildScale(
  anchor: string,
  opts: { neutral?: boolean } = {}
): Scale {
  const o = toOklch(anchor) ?? { mode: "oklch" as const, l: 0.6, c: 0, h: 0 }
  const hue = o.h ?? 0
  const anchorL = Math.min(1, Math.max(0, o.l))
  const anchorC = Math.max(0, o.c ?? 0)
  // A pure gray has no chroma to represent, so it gets the neutral treatment
  // (deeper dark end) even with the toggle off.
  const neutral = opts.neutral === true || anchorC <= ACHROMATIC_C
  const curve = neutral ? NEUTRAL_LIGHTNESS : STOP_LIGHTNESS

  const kStar = nearestStopIndex(curve, anchorL)
  const lightness = anchorLightness(curve, kStar, anchorL)

  // Scale the chroma curve so the anchor's stop carries the anchor's exact
  // chroma. (Neutral ramps substitute the capped chroma — the toggle means
  // "don't reproduce this color's saturation".)
  const targetChroma = neutral
    ? softCap(anchorC, NEUTRAL_CHROMA_CAP)
    : anchorC
  const peak = targetChroma / (CHROMA_CURVE[kStar] || 1)

  return TAILWIND_STOPS.map((stop, i) => ({
    stop,
    // Gamut-mapped so the swatch, the copied hex and the exported CSS agree.
    value: oklchCss(
      mapToSrgb({
        mode: "oklch",
        l: lightness[i]!,
        c: CHROMA_CURVE[i]! * peak,
        h: hue,
      })
    ),
  }))
}

// Standard shadcn destructive reds (scales carry no red of their own).
const RED_LIGHT = "oklch(0.577 0.245 27.325)"
const RED_DARK = "oklch(0.704 0.191 22.216)"

const at = (scale: Scale, stop: number) =>
  scale.find((s) => s.stop === stop)?.value ?? "oklch(0 0 0)"

/**
 * Map a primary + neutral Tailwind scale onto the 31 shadcn tokens (light + dark)
 * — so the generated theme IS the scale: every token is an exact scale stop.
 */
export function scalesToThemeStyles(
  primary: Scale,
  neutral: Scale
): ThemeStyles {
  const p = (stop: number) => at(primary, stop)
  const n = (stop: number) => at(neutral, stop)
  return {
    light: {
      background: n(50),
      foreground: n(950),
      card: n(50),
      "card-foreground": n(950),
      popover: n(50),
      "popover-foreground": n(950),
      primary: p(600),
      "primary-foreground": n(50),
      secondary: n(100),
      "secondary-foreground": n(900),
      muted: n(100),
      "muted-foreground": n(500),
      accent: n(100),
      "accent-foreground": n(900),
      destructive: RED_LIGHT,
      "destructive-foreground": n(50),
      border: n(200),
      input: n(200),
      ring: p(500),
      "chart-1": p(500),
      "chart-2": p(400),
      "chart-3": p(600),
      "chart-4": p(300),
      "chart-5": p(700),
      sidebar: n(50),
      "sidebar-foreground": n(950),
      "sidebar-primary": p(600),
      "sidebar-primary-foreground": n(50),
      "sidebar-accent": n(100),
      "sidebar-accent-foreground": n(900),
      "sidebar-border": n(200),
      "sidebar-ring": p(500),
    },
    dark: {
      background: n(950),
      foreground: n(50),
      card: n(900),
      "card-foreground": n(50),
      popover: n(900),
      "popover-foreground": n(50),
      primary: p(500),
      "primary-foreground": n(950),
      secondary: n(800),
      "secondary-foreground": n(50),
      muted: n(800),
      "muted-foreground": n(400),
      accent: n(800),
      "accent-foreground": n(50),
      destructive: RED_DARK,
      "destructive-foreground": n(50),
      border: n(800),
      input: n(800),
      ring: p(500),
      "chart-1": p(500),
      "chart-2": p(400),
      "chart-3": p(600),
      "chart-4": p(300),
      "chart-5": p(700),
      sidebar: n(900),
      "sidebar-foreground": n(50),
      "sidebar-primary": p(500),
      "sidebar-primary-foreground": n(950),
      "sidebar-accent": n(800),
      "sidebar-accent-foreground": n(50),
      "sidebar-border": n(800),
      "sidebar-ring": p(500),
    },
  }
}

/** A Tailwind v4 `@theme` block of `--color-<name>-<stop>` vars for each scale. */
export function scaleToCss(
  scales: Record<string, Scale>,
  format: ColorFormat = "oklch"
): string {
  const lines: string[] = ["@theme {"]
  for (const [name, scale] of Object.entries(scales)) {
    for (const { stop, value } of scale) {
      lines.push(`  --color-${name}-${stop}: ${reformat(value, format)};`)
    }
    lines.push("")
  }
  if (lines.at(-1) === "") {
    lines.pop()
  }
  lines.push("}")
  return lines.join("\n")
}

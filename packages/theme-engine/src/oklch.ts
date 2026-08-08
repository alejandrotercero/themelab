// OKLCH color helpers built on culori (the lib the repo already standardizes on —
// see packages/overlay/src/utils/color-format.ts). Adds the interpolation and
// ramp-sampling the transcript needs, which don't exist elsewhere in the repo.

import {
  parse,
  converter,
  formatHex,
  formatHsl,
  formatRgb,
  wcagContrast,
} from "culori"
import type { Oklch } from "culori"

const toOklchConv = converter("oklch")

/** Color output formats the exporter can emit. */
export type ColorFormat = "oklch" | "hsl" | "rgb" | "hex"
export const COLOR_FORMATS: ColorFormat[] = ["oklch", "hsl", "rgb", "hex"]

const toHslConv = converter("hsl")

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}
function trim(n: number): number {
  return round(n, 3)
}

/** Bare `H S% L%` triple (no `hsl(...)` wrapper, no alpha) — for shadow colors. */
export function hslTriple(value: string): string {
  const parsed = parse(value)
  if (!parsed) {
    return "0 0% 0%"
  }
  const h = toHslConv(parsed)
  return `${round(h.h ?? 0, 4)} ${round((h.s ?? 0) * 100, 4)}% ${round((h.l ?? 0) * 100, 4)}%`
}

/** Parse any CSS color into normalized OKLCH, or null if unparseable. */
export function toOklch(input: string): Oklch | null {
  const parsed = parse(input)
  if (!parsed) {
    return null
  }
  const o = toOklchConv(parsed)
  return { mode: "oklch", l: o.l ?? 0, c: o.c ?? 0, h: o.h ?? 0 }
}

/** Serialize to the `oklch(L C H)` form used across the app's globals.css. */
export function oklchCss(o: Oklch): string {
  const l = clamp(o.l, 0, 1)
  const c = Math.max(0, o.c)
  const h = o.h ?? 0
  // Match the app's existing token precision (3 decimals, hue dropped when achromatic).
  return `oklch(${trim(l)} ${trim(c)} ${c < 0.0005 ? 0 : trim(h)})`
}

/** Re-serialize any CSS color string into the requested format. */
export function reformat(value: string, format: ColorFormat): string {
  if (format === "oklch") {
    const o = toOklch(value)
    return o ? oklchCss(o) : value
  }
  const parsed = parse(value)
  if (!parsed) {
    return value
  }
  if (format === "hex") {
    return formatHex(parsed) ?? value
  }
  if (format === "hsl") {
    return formatHsl(parsed)
  }
  return formatRgb(parsed)
}

/** Perceptual lightness as the transcript reports it: OKLCH L × 100 (0–100). */
export function lStar(input: string): number {
  const o = toOklch(input)
  return o ? round(o.l * 100, 1) : 0
}

/** WCAG 2.x contrast ratio (1–21) between two CSS colors, rounded to 0.01. */
export function contrastRatio(a: string, b: string): number {
  return round(wcagContrast(a, b), 2)
}

export function oklchToHex(o: Oklch): string {
  return (
    formatHex({
      mode: "oklch",
      l: clamp(o.l, 0, 1),
      c: Math.max(0, o.c),
      h: o.h ?? 0,
    }) ?? "#000000"
  )
}

/** Copy an OKLCH color with a new lightness (0–1). */
export function withL(o: Oklch, l01: number): Oklch {
  return { mode: "oklch", l: clamp(l01, 0, 1), c: o.c, h: o.h }
}

/** Rotate hue by `deg` degrees, wrapping to [0, 360). */
export function rotateHue(o: Oklch, deg: number): Oklch {
  const h = ((((o.h ?? 0) + deg) % 360) + 360) % 360
  return { mode: "oklch", l: o.l, c: o.c, h }
}

/** Scale chroma by `factor` (clamped ≥ 0). */
export function scaleChroma(o: Oklch, factor: number): Oklch {
  return { mode: "oklch", l: o.l, c: Math.max(0, o.c * factor), h: o.h }
}

/** Linear interpolation between two OKLCH colors; hue takes the shortest path. */
export function lerpOklch(a: Oklch, b: Oklch, t: number): Oklch {
  const u = clamp(t, 0, 1)
  const ha = a.h ?? 0
  const hb = b.h ?? 0
  let dh = hb - ha
  if (dh > 180) {
    dh -= 360
  }
  if (dh < -180) {
    dh += 360
  }
  return {
    mode: "oklch",
    l: lerp(a.l, b.l, u),
    c: lerp(a.c, b.c, u),
    h: (ha + dh * u + 360) % 360,
  }
}

/**
 * Sample a neutral ramp (anchors sorted dark→light) at a target lightness
 * `targetL01` (0–1). Inside the anchor range we lerp between the bracketing
 * pair; outside it we extrapolate lightness off the nearest anchor (these are
 * the "synthetic" stops the transcript describes), damping chroma toward the
 * extremes so light/dark ends don't go muddy.
 */
export function sampleRamp(anchors: Oklch[], targetL01: number): Oklch {
  if (anchors.length === 0) {
    return { mode: "oklch", l: targetL01, c: 0, h: 0 }
  }
  const sorted = anchors.toSorted((a, b) => a.l - b.l)
  const t = clamp(targetL01, 0, 1)
  const last = sorted.at(-1) ?? sorted[0]

  let base: Oklch
  if (t <= sorted[0].l) {
    base = withL(sorted[0], t)
  } else if (t >= last.l) {
    base = withL(last, t)
  } else {
    let [lo] = sorted
    let hi = last
    for (let i = 0; i < sorted.length - 1; i += 1) {
      if (t >= sorted[i].l && t <= sorted[i + 1].l) {
        lo = sorted[i]
        hi = sorted[i + 1]
        break
      }
    }
    const span = hi.l - lo.l || 1
    base = lerpOklch(lo, hi, (t - lo.l) / span)
    base = withL(base, t) // pin exact lightness
  }

  // Damp chroma near the extremes (L>0.92 or L<0.08) for clean near-white/black.
  let edge = 1
  if (t > 0.92) {
    edge = (1 - t) / 0.08
  } else if (t < 0.08) {
    edge = t / 0.08
  }
  return scaleChroma(base, clamp(edge, 0, 1))
}

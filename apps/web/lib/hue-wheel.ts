// Pure geometry + color math behind the /tailwind hue wheel (see
// components/theme-transpiler/hue-wheel.tsx). Kept in lib/ so it is unit
// testable — vitest only includes `lib/**` for the web app — and so the
// expensive per-hue gamut search is computed once and cached rather than on
// every render (the wheel re-renders on each color-picker keystroke).

import { inGamut } from "culori"

import { oklchToHex, toOklch } from "@/lib/theme-engine"

const inSrgb = inGamut("rgb")

/** Hues are bucketed to 5° for the wheel; mirror that when normalizing. */
export const HUE_STEP = 5

export function quantizeHue(hue: number): number {
  return (((Math.round(hue / HUE_STEP) * HUE_STEP) % 360) + 360) % 360
}

/** Highest in-gamut chroma for a hue at a given lightness. Coarse search:
 *  this only feeds a background gradient, so ~0.006 resolution is plenty. */
function maxChroma(hue: number, l: number): number {
  let best = 0.02
  for (let c = 0.02; c <= 0.5; c += 0.006) {
    if (!inSrgb({ mode: "oklch", l, c, h: hue })) {
      break
    }
    best = c
  }
  return best
}

/**
 * The most vivid in-gamut color of a hue. Lightness has to vary per hue: at a
 * FIXED lightness an OKLCH wheel goes olive at yellow and dark at blue, because
 * yellow only reaches high chroma near L≈0.95 while blue peaks near L≈0.5.
 * Sweeping L and keeping the max-chroma result gives the vivid wheel look while
 * leaving hue angles exact.
 */
function computeMostVivid(hue: number): { c: number; hex: string } {
  let bestL = 0.7
  let bestC = 0.02
  for (let l = 0.4; l <= 1; l += 0.025) {
    const c = maxChroma(hue, l)
    if (c > bestC) {
      bestC = c
      bestL = l
    }
  }
  return {
    c: bestC,
    hex: oklchToHex({ mode: "oklch", l: bestL, c: bestC, h: hue }),
  }
}

// At most 72 entries — the search above is far too slow to run per render.
const vividCache = new Map<number, { c: number; hex: string }>()

/** Most vivid in-gamut color for a hue, bucketed to 5° and cached. */
export function mostVivid(hue: number): { c: number; hex: string } {
  const key = quantizeHue(hue)
  let hit = vividCache.get(key)
  if (!hit) {
    hit = computeMostVivid(key)
    vividCache.set(key, hit)
  }
  return hit
}

/**
 * The wheel's hue stops: 0°, 5°, … 360° inclusive. Both endpoints are present
 * so the ring closes exactly — CSS spaces unspecified gradient stops evenly
 * from the first to the last, so 73 stops give 72 gaps of exactly 5°, matching
 * the hue buckets. (72 stops would place the last one at 355°, leaving a 5°
 * hue discontinuity at 12 o'clock.)
 */
export function wheelHueStops(): number[] {
  return Array.from({ length: 360 / HUE_STEP + 1 }, (_, i) => i * HUE_STEP)
}

/**
 * The wheel's CSS background: a white radial fade (achromatic center) over a
 * conic hue ring built from the most vivid color of each hue.
 *
 * Deliberately sRGB hex stops rather than `conic-gradient(in oklch, …)`: that
 * interpolation syntax is unsupported in Safari, which drops the ENTIRE
 * background declaration and rendered the wheel invisible (a black circle).
 * Hex stops are universally supported and keep the painted hues identical to
 * the hues used to place the markers.
 */
export function wheelBackground(): string {
  const stops = wheelHueStops().map((h) => mostVivid(h).hex)
  return `radial-gradient(circle at center, #ffffff 0%, rgb(255 255 255 / 0) 62%), conic-gradient(from 0deg, ${stops.join(", ")})`
}

export interface WheelMarker {
  key: string
  name: string
  hex: string
  /** Percentages within the wheel box. */
  xPct: number
  yPct: number
}

/**
 * Place each anchor color on the wheel: angle = OKLCH hue, distance = chroma
 * relative to that hue's own peak (a fully saturated color rides the rim, a
 * gray sits at the center). 0° points up and hues advance clockwise, matching
 * `conic-gradient`'s default orientation.
 */
export function wheelMarkers(
  colors: { name: string; color: string }[]
): WheelMarker[] {
  return colors.flatMap(({ name, color }, i) => {
    const o = toOklch(color)
    if (!o) {
      return []
    }
    const hue = (((o.h ?? 0) % 360) + 360) % 360
    const peak = mostVivid(hue).c || 0.02
    const rFrac = Math.min(Math.max((o.c ?? 0) / peak, 0), 1)
    const rad = (hue * Math.PI) / 180
    return [
      {
        key: `${name}-${i}`,
        name,
        hex: oklchToHex(o),
        xPct: 50 + rFrac * 50 * Math.sin(rad),
        yPct: 50 - rFrac * 50 * Math.cos(rad),
      },
    ]
  })
}

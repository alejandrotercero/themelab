// Regression tests for the /tailwind hue wheel. The wheel once rendered as a
// BLACK circle because `conic-gradient(in oklch, …)` is unsupported in Safari,
// which invalidates the whole background declaration. These tests pin the
// background to a form browsers actually accept, and check the marker geometry.

import { describe, expect, it } from "vitest"

import {
  HUE_STEP,
  mostVivid,
  quantizeHue,
  wheelBackground,
  wheelHueStops,
  wheelMarkers,
} from "../hue-wheel"

const HEX6 = /#[0-9a-f]{6}/gi

/** Ring stops only — the radial layer's white stop is not part of the ring. */
function ringStops(bg: string): string[] {
  const conic = bg.slice(bg.indexOf("conic-gradient("))
  return (conic.match(HEX6) ?? []).map((s) => s.toLowerCase())
}

/** Distance of a marker from the wheel's center, in percent units. */
function distanceFromCenter(m: { xPct: number; yPct: number }): number {
  return Math.hypot(m.xPct - 50, m.yPct - 50)
}

describe("wheelBackground", () => {
  const bg = wheelBackground()

  it("uses sRGB hex stops, never oklch() interpolation", () => {
    // The specific Safari-breaking syntax must not come back.
    expect(bg).not.toContain("in oklch")
    expect(bg).not.toContain("oklch(")
    expect(bg).toContain("radial-gradient(")
    expect(bg).toContain("conic-gradient(from 0deg,")
  })

  it("emits one valid hex stop per hue bucket, plus the white center", () => {
    const ring = ringStops(bg)
    expect(ring).toHaveLength(wheelHueStops().length)
    expect(ring.every((s) => /^#[0-9a-f]{6}$/i.test(s))).toBe(true)
    // The radial fade contributes the achromatic center stop.
    expect((bg.match(HEX6) ?? []).length).toBe(wheelHueStops().length + 1)
  })

  it("paints a full-color ring (not a single/collapsed color)", () => {
    const ring = ringStops(bg)
    // A black or white ring would mean the gamut search failed everywhere.
    expect(ring.every((s) => s !== "#000000" && s !== "#ffffff")).toBe(true)
    expect(new Set(ring).size).toBeGreaterThan(60)
  })

  it("closes the ring (0° and 360° are the same color)", () => {
    const ring = ringStops(bg)
    expect(ring[0]).toBe(ring.at(-1))
  })
})

describe("mostVivid", () => {
  it("is cached per 5° bucket (same object back)", () => {
    expect(mostVivid(110)).toBe(mostVivid(112))
    expect(mostVivid(110)).toBe(mostVivid(110))
  })

  it("finds genuinely chromatic colors across the wheel", () => {
    // Every hue should beat a weak chroma floor; yellow is the classic
    // regression (an L-fixed wheel made it olive).
    for (const hue of [25, 60, 110, 145, 200, 264, 330]) {
      expect(mostVivid(hue).c).toBeGreaterThan(0.1)
    }
  })

  it("quantizeHue wraps into [0, 360)", () => {
    expect(quantizeHue(0)).toBe(0)
    expect(quantizeHue(362)).toBe(0)
    expect(quantizeHue(-5)).toBe(355)
    expect(quantizeHue(103)).toBe(105)
  })
})

describe("wheelMarkers", () => {
  it("places a pure gray at the exact center", () => {
    const [m] = wheelMarkers([{ name: "gray", color: "#808080" }])
    expect(m?.xPct).toBeCloseTo(50, 5)
    expect(m?.yPct).toBeCloseTo(50, 5)
  })

  it("puts 0° (red-ish) above center and 180° below", () => {
    const markers = wheelMarkers([
      { name: "up", color: "oklch(0.6 0.2 0)" },
      { name: "down", color: "oklch(0.6 0.2 180)" },
    ])
    expect(markers[0]?.xPct).toBeCloseTo(50, 5)
    expect(markers[0]?.yPct).toBeLessThan(50)
    expect(markers[1]?.yPct).toBeGreaterThan(50)
  })

  it("keeps every marker inside the wheel box", () => {
    const markers = wheelMarkers([
      { name: "brand", color: "#3b82f6" },
      { name: "vivid", color: "oklch(0.7 0.35 330)" },
      { name: "gray", color: "#71717a" },
      { name: "junk", color: "not-a-color" }, // skipped
    ])
    expect(markers).toHaveLength(3)
    for (const m of markers) {
      expect(m.xPct).toBeGreaterThanOrEqual(0)
      expect(m.xPct).toBeLessThanOrEqual(100)
      expect(m.yPct).toBeGreaterThanOrEqual(0)
      expect(m.yPct).toBeLessThanOrEqual(100)
      expect(m.hex).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it("moves a more saturated color farther from the center", () => {
    const [dull, vivid] = wheelMarkers([
      { name: "dull", color: "oklch(0.6 0.05 264)" },
      { name: "vivid", color: "oklch(0.5 0.28 264)" },
    ])
    if (!dull || !vivid) {
      throw new Error("expected two markers")
    }
    expect(distanceFromCenter(vivid)).toBeGreaterThan(distanceFromCenter(dull))
  })

  it("uses the hue step for its buckets", () => {
    expect(HUE_STEP).toBe(5)
  })
})

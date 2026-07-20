import type { Oklch } from "culori"
import { describe, expect, it } from "vitest"

import {
  toOklch,
  lStar,
  oklchCss,
  lerpOklch,
  sampleRamp,
  reformat,
} from "../oklch.js"

function mustToOklch(input: string): Oklch {
  const result = toOklch(input)
  if (!result) {
    throw new Error(`could not parse oklch from "${input}"`)
  }
  return result
}

describe("toOklch", () => {
  it("parses black", () => {
    const result = toOklch("#000000")
    expect(result).not.toBeNull()
    if (!result) {
      throw new Error("unreachable")
    }
    expect(result.l).toBeCloseTo(0, 5)
  })

  it("returns null for unparseable input", () => {
    expect(toOklch("not-a-color")).toBeNull()
  })

  it("parses white", () => {
    const result = toOklch("#ffffff")
    expect(result).not.toBeNull()
    if (!result) {
      throw new Error("unreachable")
    }
    expect(result.l).toBeCloseTo(1, 3)
  })
})

describe("lStar", () => {
  it("returns 100 for white", () => {
    expect(lStar("#ffffff")).toBe(100)
  })

  it("returns 0 for unparseable input", () => {
    // "bad" IS a valid CSS named color (culori resolves it to an RGB value) — use a
    // clearly invalid string. Characterization note: lStar("bad") === 77, not 0.
    expect(lStar("not-a-color")).toBe(0)
  })

  it("returns approximately 0 for black", () => {
    expect(lStar("#000000")).toBeCloseTo(0, 1)
  })
})

describe("oklchCss", () => {
  it("renders hue as 0 for achromatic color (c < 0.0005)", () => {
    const o: Oklch = { mode: "oklch", l: 0.5, c: 0, h: 200 }
    const result = oklchCss(o)
    // c < 0.0005 → hue forced to 0
    expect(result).toBe("oklch(0.5 0 0)")
  })

  it("preserves hue when chroma is above the threshold", () => {
    const o: Oklch = { mode: "oklch", l: 0.5, c: 0.1, h: 200 }
    const result = oklchCss(o)
    expect(result).toMatch(/^oklch\(/)
    expect(result).toContain("200")
  })

  it("uses 3-decimal precision", () => {
    const o: Oklch = { mode: "oklch", l: 0.12345, c: 0.09876, h: 123.456789 }
    const result = oklchCss(o)
    // Each number should be at most 3 decimal places
    expect(result).toMatch(/^oklch\(\d+\.\d{1,3} \d+\.\d{1,3} \d+\.?\d{0,3}\)$/)
  })

  it("clamps L above 1 to 1", () => {
    const o: Oklch = { mode: "oklch", l: 1.5, c: 0, h: 0 }
    const result = oklchCss(o)
    expect(result).toBe("oklch(1 0 0)")
  })
})

describe("lerpOklch", () => {
  it("takes the shortest path across the 0/360 boundary (350→10 at t=0.5 ≈ 0°)", () => {
    const a: Oklch = { mode: "oklch", l: 0.5, c: 0.1, h: 350 }
    const b: Oklch = { mode: "oklch", l: 0.5, c: 0.1, h: 10 }
    const mid = lerpOklch(a, b, 0.5)
    // Shortest path goes 350 → (350+20*0.5) mod 360 = 0
    // hue should be near 0 (or 360), NOT near 180
    const h = mid.h ?? 0
    expect(h <= 20 || h >= 340).toBe(true)
  })

  it("returns midpoint lightness at t=0.5", () => {
    const a: Oklch = { mode: "oklch", l: 0.2, c: 0.1, h: 0 }
    const b: Oklch = { mode: "oklch", l: 0.8, c: 0.1, h: 0 }
    const mid = lerpOklch(a, b, 0.5)
    expect(mid.l).toBeCloseTo(0.5, 10)
  })

  it("clamps t to [0,1]", () => {
    const a: Oklch = { mode: "oklch", l: 0.2, c: 0.1, h: 0 }
    const b: Oklch = { mode: "oklch", l: 0.8, c: 0.1, h: 0 }
    expect(lerpOklch(a, b, -1).l).toBeCloseTo(0.2, 10)
    expect(lerpOklch(a, b, 2).l).toBeCloseTo(0.8, 10)
  })
})

describe("sampleRamp", () => {
  it("returns {l: targetL01, c:0, h:0} for empty anchors", () => {
    const result = sampleRamp([], 0.5)
    expect(result).toEqual({ mode: "oklch", l: 0.5, c: 0, h: 0 })
  })

  it("damps chroma to 0 at L=1 (extreme end)", () => {
    const blue = mustToOklch("#3b82f6")
    const navy = mustToOklch("#1e3a5f")
    const anchors = [navy, blue]
    const result = sampleRamp(anchors, 1)
    // At L=1, edge factor = (1-1)/0.08 = 0 → chroma = 0
    expect(result.c).toBeCloseTo(0, 10)
  })

  it("damps chroma to 0 at L=0 (extreme end)", () => {
    const blue = mustToOklch("#3b82f6")
    const navy = mustToOklch("#1e3a5f")
    const anchors = [navy, blue]
    const result = sampleRamp(anchors, 0)
    // At L=0, edge factor = 0/0.08 = 0 → chroma = 0
    expect(result.c).toBeCloseTo(0, 10)
  })

  it("preserves chroma at mid-range lightness", () => {
    const blue = mustToOklch("#3b82f6")
    const navy = mustToOklch("#1e3a5f")
    const anchors = [navy, blue]
    const result = sampleRamp(anchors, 0.5)
    // Not at extreme → chroma should be non-trivial
    expect(result.c).toBeGreaterThan(0)
  })
})

describe("reformat", () => {
  it("round-trips #ff0000 through hex", () => {
    const result = reformat("#ff0000", "hex")
    expect(result).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("formats #ff0000 as hsl starting with hsl", () => {
    const result = reformat("#ff0000", "hsl")
    expect(result).toMatch(/^hsl\(/)
  })

  it("formats as oklch string", () => {
    const result = reformat("#3b82f6", "oklch")
    expect(result).toMatch(/^oklch\(/)
  })

  it("formats as rgb string", () => {
    const result = reformat("#3b82f6", "rgb")
    expect(result).toMatch(/^rgb\(/)
  })
})

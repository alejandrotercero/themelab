import { inGamut } from "culori"
import { describe, expect, it } from "vitest"

import { oklchToHex, reformat, toOklch } from "../oklch.js"
import {
  NEUTRAL_LIGHTNESS,
  STOP_LIGHTNESS,
  TAILWIND_STOPS,
  buildScale,
  scalesToThemeStyles,
} from "../scale.js"
import type { Scale } from "../scale.js"

// Stops are emitted with 3-decimal precision, so a parsed stop can differ from
// the anchor's raw OKLCH by at most ~0.0005.
const ANCHOR_TOL = 0.0006
// Same 3-decimal print granularity, as a small margin on top of a hard cap.
const PRINT_EPSILON = 0.0005

function findStop(scale: Scale, stop: number) {
  const entry = scale.find((s) => s.stop === stop)
  if (!entry) {
    throw new Error(`stop ${stop} not found in scale`)
  }
  return entry
}

function mustToOklch(value: string) {
  const oklch = toOklch(value)
  if (!oklch) {
    throw new Error(`could not parse oklch from "${value}"`)
  }
  return oklch
}

const values = (scale: Scale) => scale.map((s) => s.value)
const inSrgb = inGamut("rgb")

describe("buildScale stop shape", () => {
  it("returns 11 stops matching TAILWIND_STOPS", () => {
    const scale = buildScale("#3b82f6")
    expect(scale).toHaveLength(11)
    expect(scale.map((s) => s.stop)).toEqual([...TAILWIND_STOPS])
  })

  it("emits canonical oklch(...) strings", () => {
    for (const { value } of buildScale("#3b82f6")) {
      expect(value).toMatch(/^oklch\(/)
      expect(reformat(value, "oklch")).toBe(value)
    }
  })
})

describe("buildScale places the anchor on an exact stop", () => {
  const ANCHOR_CASES = [
    { anchor: "#3b82f6", stop: 500 },
    { anchor: "#e11d48", stop: 600 },
    { anchor: "#14506b", stop: 900 },
    { anchor: "#808080", stop: 500 },
  ] as const

  it.each(ANCHOR_CASES)(
    "$anchor lands on stop $stop with its own L, C and H",
    ({ anchor, stop }) => {
      const scale = buildScale(anchor)
      const anchorOklch = mustToOklch(anchor)

      // The stop whose lightness is nearest the anchor's.
      const match = scale.find(
        (s) => Math.abs(mustToOklch(s.value).l - anchorOklch.l) <= ANCHOR_TOL
      )
      expect(
        match,
        `no stop within ${ANCHOR_TOL} of anchor L ${anchorOklch.l}`
      ).toBeDefined()

      const hit = match as (typeof scale)[number]
      expect(hit.stop).toBe(stop)

      const hitOklch = mustToOklch(hit.value)
      expect(hitOklch.l).toBeCloseTo(anchorOklch.l, 3)
      expect(hitOklch.c).toBeCloseTo(anchorOklch.c, 3)
      expect(hitOklch.h ?? 0).toBeCloseTo(anchorOklch.h ?? 0, 3)
    }
  )

  it.each(ANCHOR_CASES)(
    "$anchor round-trips hex through its anchor stop",
    ({ anchor, stop }) => {
      const hitOklch = mustToOklch(findStop(buildScale(anchor), stop).value)
      expect(oklchToHex(hitOklch)).toBe(anchor)
    }
  )
})

describe("buildScale neutral lightness curve", () => {
  it("ends deeper than the chromatic curve", () => {
    expect(NEUTRAL_LIGHTNESS.at(-1)).toBe(0.13)
    expect(STOP_LIGHTNESS.at(-1)).toBe(0.262)
    expect(NEUTRAL_LIGHTNESS.at(-1) as number).toBeLessThan(
      STOP_LIGHTNESS.at(-1) as number
    )
  })

  it("drives neutral gray 950 to near-black, chromatic 950 stays higher", () => {
    const neutral950 = findStop(buildScale("#808080", { neutral: true }), 950)
    const chromatic950 = findStop(buildScale("#3b82f6"), 950)

    const neutralOklch = mustToOklch(neutral950.value)
    expect(neutralOklch.l).toBeCloseTo(0.13, 3)
    expect(oklchToHex(neutralOklch)).toBe("#070707")

    expect(mustToOklch(chromatic950.value).l).toBeCloseTo(0.262, 3)
  })
})

describe("buildScale does not fabricate chroma", () => {
  it("keeps a pure gray anchor achromatic with the toggle off", () => {
    const scale = buildScale("#808080")
    expect(scale).toHaveLength(11)
    for (const { stop, value } of scale) {
      // The old implementation pushed 0.04 chroma at hue 0 here.
      expect(mustToOklch(value).c, `stop ${stop}`).toBeLessThanOrEqual(0.0005)
    }
  })
})

describe("buildScale keeps every stop in sRGB gamut", () => {
  const HUES = [0, 25, 60, 110, 145, 200, 264, 330]
  const CHROMAS = [0.05, 0.12, 0.22, 0.3]
  const NEUTRAL_FLAGS = [true, false]

  it("passes a hue × chroma × neutral sweep", () => {
    let checked = 0
    for (const h of HUES) {
      for (const c of CHROMAS) {
        for (const neutral of NEUTRAL_FLAGS) {
          const scale = buildScale(`oklch(0.6 ${c} ${h})`, { neutral })
          for (const { stop, value } of scale) {
            const o = mustToOklch(value)
            const label = `h=${h} c=${c} neutral=${neutral} stop=${stop} (${value})`
            expect(
              inSrgb({ mode: "oklch", l: o.l, c: o.c, h: o.h ?? 0 }),
              label
            ).toBe(true)
            checked += 1
          }
        }
      }
    }
    expect(checked).toBe(
      HUES.length * CHROMAS.length * NEUTRAL_FLAGS.length * 11
    )
  })
})

describe("buildScale gives distinct colors distinct palettes", () => {
  it("similar teals yield different ramps, chromatic and neutral", () => {
    expect(values(buildScale("#0e7490"))).not.toEqual(
      values(buildScale("#14506b"))
    )
    expect(values(buildScale("#0e7490", { neutral: true }))).not.toEqual(
      values(buildScale("#14506b", { neutral: true }))
    )
  })

  it("same hue at different lightness yields different ramps", () => {
    expect(values(buildScale("#3b82f6"))).not.toEqual(
      values(buildScale("oklch(0.8 0.188 259.815)"))
    )
  })

  it("same hue at different chroma differs even with neutral on", () => {
    const low = values(buildScale("oklch(0.6 0.02 264)", { neutral: true }))
    const high = values(buildScale("oklch(0.6 0.19 264)", { neutral: true }))
    expect(low).not.toEqual(high)
    // A flat min(c, 0.02) clamp made this pair byte-identical.
    expect(low[5]).not.toBe(high[5])
  })
})

describe("buildScale neutral chroma soft cap", () => {
  const ANCHORS = ["#3b82f6", "#e11d48", "oklch(0.6 0.19 264)"]

  it("keeps every neutral stop under the cap (+ print epsilon)", () => {
    for (const anchor of ANCHORS) {
      for (const { stop, value } of buildScale(anchor, { neutral: true })) {
        expect(
          mustToOklch(value).c,
          `${anchor} stop ${stop} (${value})`
        ).toBeLessThan(0.02 + PRINT_EPSILON)
      }
    }
  })

  it("preserves chroma ordering between vivid colors of one hue", () => {
    const softer = mustToOklch(
      findStop(buildScale("oklch(0.6 0.19 264)", { neutral: true }), 500).value
    )
    const vivid = mustToOklch(
      findStop(buildScale("oklch(0.6 0.3 264)", { neutral: true }), 500).value
    )
    expect(softer.c).toBeLessThan(vivid.c)
    expect(vivid.c).toBeLessThan(0.02 + PRINT_EPSILON)
  })
})

describe("buildScale pins the ramp endpoints", () => {
  const MONOTONE_ANCHORS = ["#ffffff", "#000000", "#3b82f6", "#0e7490"]

  it.each(MONOTONE_ANCHORS)(
    "%s darkens monotonically from 50 to 950",
    (anchor) => {
      const scale = buildScale(anchor)
      const lightness = scale.map((s) => mustToOklch(s.value).l)

      for (let i = 1; i < lightness.length; i += 1) {
        expect(
          lightness[i],
          `stop ${scale[i]!.stop} is lighter than stop ${scale[i - 1]!.stop}`
        ).toBeLessThanOrEqual(lightness[i - 1]!)
      }

      const l50 = mustToOklch(findStop(scale, 50).value).l
      const l950 = mustToOklch(findStop(scale, 950).value).l
      expect(l50).toBe(Math.max(...lightness))
      expect(l950).toBe(Math.min(...lightness))
      expect(l50).toBeGreaterThan(l950)
    }
  )
})

describe("scalesToThemeStyles consumes buildScale output", () => {
  const primary = buildScale("#3b82f6")
  const neutral = buildScale("#71717a", { neutral: true })
  const theme = scalesToThemeStyles(primary, neutral)

  // The repo labels this token set "31", but the emitted objects actually hold
  // 32 keys each (see the key list in scale.test.ts).
  it("produces 32 light and 32 dark tokens", () => {
    expect(Object.keys(theme.light)).toHaveLength(32)
    expect(Object.keys(theme.dark)).toHaveLength(32)
  })

  it("emits only oklch tokens that parse", () => {
    for (const mode of ["light", "dark"] as const) {
      const tokens = theme[mode] as Record<string, string>
      for (const [key, value] of Object.entries(tokens)) {
        expect(value, `${mode}.${key}`).toMatch(/^oklch\(/)
        expect(toOklch(value), `${mode}.${key} (${value})`).not.toBeNull()
      }
    }
  })
})

import { describe, expect, it } from "vitest"

import { MINDFUL_PRESETS } from "../mindful-presets.js"
import { toOklch } from "../oklch.js"
import {
  mindfulToThemeStyles,
  analyzeMindful,
  THEME_TOKENS,
} from "../transpile.js"
import type { MindfulColors } from "../transpile.js"

// Real bundled fixture — the "Ateneo" preset (blue primary, lemon secondary).
const ateneo: MindfulColors = MINDFUL_PRESETS[0].colors

function allValuesParse(map: Record<string, string>): boolean {
  return Object.values(map).every((v) => toOklch(v) !== null)
}

const lOf = (v: string) => toOklch(v)?.l ?? 0
const hOf = (v: string) => toOklch(v)?.h ?? 0
// Shortest angular distance between two hues (degrees).
const hueDist = (a: number, b: number) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360
  return Math.min(d, 360 - d)
}

describe("mindfulToThemeStyles — smoke test", () => {
  const result = mindfulToThemeStyles(ateneo)

  it("all light values parse as oklch", () => {
    expect(allValuesParse(result.light)).toBe(true)
  })

  it("all dark values parse as oklch", () => {
    expect(allValuesParse(result.dark)).toBe(true)
  })

  it("contains all THEME_TOKENS keys in both modes", () => {
    for (const token of THEME_TOKENS) {
      expect(result.light).toHaveProperty(token)
      expect(result.dark).toHaveProperty(token)
    }
  })
})

describe("mindfulToThemeStyles — light/dark anchoring", () => {
  const result = mindfulToThemeStyles(ateneo)

  it("light mode: background is near-white, foreground is dark", () => {
    expect(lOf(result.light.background)).toBeGreaterThan(0.95)
    expect(lOf(result.light.foreground)).toBeLessThan(0.25)
  })

  it("dark mode: background is truly dark, foreground is near-white", () => {
    expect(lOf(result.dark.background)).toBeLessThan(0.2)
    expect(lOf(result.dark.foreground)).toBeGreaterThan(0.95)
  })
})

describe("mindfulToThemeStyles — extreme correction", () => {
  // A palette whose "lights" are only mid-light and "darks" are only mid-dark:
  // correction must still yield a near-white light bg and a truly dark dark bg.
  const tepid: MindfulColors = {
    light1: "#cfd8dc", // L ~0.86
    light2: "#b0bec5",
    accent1: "#ef5350",
    accent2: "#42a5f5",
    dark1: "#37474f", // L ~0.37 — not dark enough on its own
    dark2: "#455a64",
  }
  const result = mindfulToThemeStyles(tepid)

  it("pushes the dark-mode background below L 0.20", () => {
    expect(lOf(result.dark.background)).toBeLessThan(0.2)
  })

  it("pushes the light-mode background above L 0.95", () => {
    expect(lOf(result.light.background)).toBeGreaterThan(0.95)
  })
})

describe("mindfulToThemeStyles — two distinct accents", () => {
  const result = mindfulToThemeStyles(ateneo)

  it("accent surface differs from primary", () => {
    expect(result.light.accent).not.toBe(result.light.primary)
    expect(result.light["chart-2"]).not.toBe(result.light["chart-1"])
  })

  it("accent hue tracks accent-2, primary hue tracks accent-1", () => {
    const a1 = hOf(ateneo.accent1) // blue
    const a2 = hOf(ateneo.accent2) // lemon
    // accent token (secondary) should be near accent-2 and far from accent-1.
    expect(hueDist(hOf(result.light.accent), a2)).toBeLessThan(20)
    expect(hueDist(hOf(result.light.accent), a1)).toBeGreaterThan(40)
    // primary (incl. chart-1) should track accent-1.
    expect(hueDist(hOf(result.light.primary), a1)).toBeLessThan(20)
  })
})

describe("mindfulToThemeStyles — grayscale input", () => {
  it("produces a full theme without throwing", () => {
    const gray: MindfulColors = {
      light1: "#f5f5f5",
      light2: "#dddddd",
      accent1: "#888888",
      accent2: "#999999",
      dark1: "#1a1a1a",
      dark2: "#333333",
    }
    const result = mindfulToThemeStyles(gray)
    for (const token of THEME_TOKENS) {
      expect(result.light).toHaveProperty(token)
      expect(result.dark).toHaveProperty(token)
    }
    expect(allValuesParse(result.light)).toBe(true)
    expect(allValuesParse(result.dark)).toBe(true)
  })
})

describe("analyzeMindful — measurement readout", () => {
  it("reports 6 measures and strong text contrast in both modes", () => {
    const report = analyzeMindful(ateneo)
    expect(report.measures).toHaveLength(6)
    expect(report.contrast.light).toBeGreaterThan(7)
    expect(report.contrast.dark).toBeGreaterThan(7)
  })

  it("flags a not-dark-enough dark anchor as corrected", () => {
    const tepid: MindfulColors = {
      light1: "#ffffff",
      light2: "#eeeeee",
      accent1: "#ef5350",
      accent2: "#42a5f5",
      dark1: "#37474f", // L ~0.37 — too light for a dark bg
      dark2: "#455a64", // lighter still
    }
    const report = analyzeMindful(tepid)
    const darkest = report.measures.find((m) => m.role === "dark 1")
    if (!darkest) {
      throw new Error('expected a "dark 1" measure')
    }
    expect(darkest.correctedL).not.toBeNull()
    expect(darkest.correctedL).toBeLessThan(darkest.lStar)
  })

  it("marks a low-chroma accent as not ok", () => {
    const gray: MindfulColors = {
      light1: "#f5f5f5",
      light2: "#dddddd",
      accent1: "#8a8a8a", // near-neutral — should flag
      accent2: "#42a5f5",
      dark1: "#111111",
      dark2: "#222222",
    }
    const report = analyzeMindful(gray)
    expect(report.measures.find((m) => m.role === "accent 1")?.ok).toBe(false)
  })
})

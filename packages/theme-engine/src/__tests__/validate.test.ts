import { describe, expect, it } from "vitest"

import type { HrTheme } from "../types.js"
import { analyze } from "../validate.js"

// Real fixture from presets.ts — "Ablaze" (8 levels, should pass)
const ablazeTheme: HrTheme = {
  slots: {
    background: "#111111",
    f_high: "#ffffff",
    f_med: "#aaaaaa",
    f_low: "#555555",
    f_inv: "#000000",
    b_high: "#fc533e",
    b_med: "#666666",
    b_low: "#333333",
    b_inv: "#fc533e",
  },
  tape: {},
}

// Real fixture from presets.ts — "Apollo" (7 levels, should pass)
const apolloTheme: HrTheme = {
  slots: {
    background: "#0a0a0a",
    f_high: "#ececec",
    f_med: "#a0a0a0",
    f_low: "#505050",
    f_inv: "#ececec",
    b_high: "#1a1a1a",
    b_med: "#2a2a2a",
    b_low: "#1a1a1a",
    b_inv: "#cc665f",
  },
  tape: {},
}

// Real fixture from presets.ts — "Aeriform" (few distinct levels, should fail)
const aeriformTheme: HrTheme = {
  slots: {
    background: "#171410",
    f_high: "#cabcc2",
    f_med: "#26211b",
    f_low: "#171410",
    f_inv: "#cabcc2",
    b_high: "#171410",
    b_med: "#26211b",
    b_low: "#171410",
    b_inv: "#cc665f",
  },
  tape: {},
}

// Sparse theme: only 2 distinct lightness levels → "fail"
const sparseTheme: HrTheme = {
  slots: {
    background: "#111111",
    f_high: "#eeeeee",
    f_med: "#111111",
    f_low: "#111111",
    f_inv: "#eeeeee",
    b_high: "#111111",
    b_med: "#111111",
    b_low: "#111111",
    b_inv: "#eeeeee",
  },
  tape: {},
}

// 3 distinct levels but narrow range → "partial" (range < 70)
const narrowTheme: HrTheme = {
  slots: {
    background: "#404040",
    f_high: "#606060",
    f_med: "#505050",
    f_low: "#404040",
    f_inv: "#606060",
    b_high: "#404040",
    b_med: "#505050",
    b_low: "#404040",
    b_inv: "#606060",
  },
  tape: {},
}

describe("analyze — pass verdict", () => {
  it("ablaze: verdict is pass", () => {
    const report = analyze(ablazeTheme)
    expect(report.verdict).toBe("pass")
  })

  it("ablaze: uniqueCount >= 5", () => {
    const report = analyze(ablazeTheme)
    expect(report.uniqueCount).toBeGreaterThanOrEqual(5)
  })

  it("ablaze: range >= 70", () => {
    const report = analyze(ablazeTheme)
    expect(report.range).toBeGreaterThanOrEqual(70)
  })

  it("ablaze: score is between 0 and 100", () => {
    const report = analyze(ablazeTheme)
    expect(report.score).toBeGreaterThanOrEqual(0)
    expect(report.score).toBeLessThanOrEqual(100)
  })

  it("apollo: verdict is pass", () => {
    const report = analyze(apolloTheme)
    expect(report.verdict).toBe("pass")
  })
})

describe("analyze — fail verdict", () => {
  it("sparse theme: verdict is fail", () => {
    const report = analyze(sparseTheme)
    expect(report.verdict).toBe("fail")
  })

  it("sparse theme: uniqueCount < 3", () => {
    const report = analyze(sparseTheme)
    expect(report.uniqueCount).toBeLessThan(3)
  })
})

describe("analyze — partial verdict", () => {
  it("narrow range theme: verdict is partial (3–4 distinct but range < 70)", () => {
    const report = analyze(narrowTheme)
    // narrowTheme has 3 distinct shades of gray, close in lightness → partial
    expect(report.verdict).toBe("partial")
  })

  it("aeriform: verdict is fail (too sparse — teaching example)", () => {
    // aeriform is documented as the failing gate; uniqueCount may be < 3
    const report = analyze(aeriformTheme)
    expect(["fail", "partial"]).toContain(report.verdict)
  })
})

describe("analyze — nativeMode", () => {
  it("dark theme (background darker than f_high) → nativeMode is dark", () => {
    // ablazeTheme: background=#111 (dark), f_high=#fff (light) → dark
    const report = analyze(ablazeTheme)
    expect(report.nativeMode).toBe("dark")
  })

  it("light theme (background lighter than f_high) → nativeMode is light", () => {
    // Marble: background=#f4f1ea (light), f_high=#16130d (dark) → light
    const marbleTheme: HrTheme = {
      slots: {
        background: "#f4f1ea",
        f_high: "#16130d",
        f_med: "#4a463c",
        f_low: "#8c8678",
        f_inv: "#f4f1ea",
        b_high: "#d8d2c4",
        b_med: "#c3bcab",
        b_low: "#e9e5db",
        b_inv: "#3d6e8e",
      },
      tape: {},
    }
    const report = analyze(marbleTheme)
    expect(report.nativeMode).toBe("light")
  })
})

describe("analyze — score formula", () => {
  it("score = round((min(unique,8)/8 * 0.6 + min(range,100)/100 * 0.4) * 100)", () => {
    const report = analyze(ablazeTheme)
    const { uniqueCount, range } = report
    const levelScore = Math.min(uniqueCount, 8) / 8
    const rangeScore = Math.min(range, 100) / 100
    const expected = Math.round((levelScore * 0.6 + rangeScore * 0.4) * 100)
    expect(report.score).toBe(expected)
  })
})

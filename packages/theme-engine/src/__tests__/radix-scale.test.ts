import { describe, expect, it } from "vitest"

import { toOklch } from "../oklch.js"
import { radixScaleFromColor } from "../radix/index.js"
import type { Scale } from "../scale.js"

function expectTwelveParsableSteps(scale: Scale, name: string) {
  expect(scale).toHaveLength(12)
  const stops = scale.map((s) => s.stop)
  expect(stops).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  for (const { stop, value } of scale) {
    expect(
      toOklch(value),
      `${name} stop ${stop} should parse via toOklch: ${value}`
    ).not.toBeNull()
  }
}

describe("radixScaleFromColor", () => {
  it("returns 12 parsable steps for primary and neutral (light)", () => {
    const { primary, neutral } = radixScaleFromColor("#3b82f6")
    expectTwelveParsableSteps(primary, "primary")
    expectTwelveParsableSteps(neutral, "neutral")
  })

  it("returns 12 steps for primary and neutral (dark)", () => {
    const { primary, neutral } = radixScaleFromColor("#3b82f6", "dark")
    expect(primary).toHaveLength(12)
    expect(neutral).toHaveLength(12)
    expect(primary.map((s) => s.stop)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    expect(neutral.map((s) => s.stop)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
  })
})

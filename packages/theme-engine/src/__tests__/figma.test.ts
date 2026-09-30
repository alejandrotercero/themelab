import { describe, expect, it } from "vitest"

import { scalesToFigmaSvg } from "../figma.js"
import { buildScale } from "../scale.js"

describe("scalesToFigmaSvg", () => {
  it("two-family output contains <svg, both labels, and stop ids", () => {
    const primary = buildScale("#3b82f6")
    const neutral = buildScale("#71717a", { neutral: true })
    const svg = scalesToFigmaSvg({
      families: [
        { name: "primary", scale: primary },
        { name: "neutral", scale: neutral },
      ],
      mode: "light",
      title: "ThemeLab",
    })

    expect(svg).toContain("<svg")
    // Section labels
    expect(svg).toContain("Primary")
    expect(svg).toContain("Neutral")
    // Header (title · mode)
    expect(svg).toContain("ThemeLab")
    // Solid + alpha ids use actual ThemeLab stops (50..950)
    expect(svg).toContain('id="primary-500"')
    expect(svg).toContain('id="primary-alpha-500"')
    expect(svg).toContain('id="neutral-500"')
    expect(svg).toContain('id="neutral-alpha-500"')
    // White canvas
    expect(svg).toContain('fill="#ffffff"')
  })

  it("three-family output contains all three families' ids", () => {
    const primary = buildScale("#3b82f6")
    const neutral = buildScale("#71717a", { neutral: true })
    const accent = buildScale("#22c55e")
    const svg = scalesToFigmaSvg({
      families: [
        { name: "primary", scale: primary },
        { name: "neutral", scale: neutral },
        { name: "accent", scale: accent },
      ],
      mode: "dark",
      title: "ThemeLab",
    })

    expect(svg).toContain("<svg")
    expect(svg).toContain("Primary")
    expect(svg).toContain("Neutral")
    expect(svg).toContain("Accent")
    expect(svg).toContain('id="primary-500"')
    expect(svg).toContain('id="neutral-500"')
    expect(svg).toContain('id="accent-500"')
    expect(svg).toContain('id="accent-alpha-500"')
  })

  it("sanitizes family names for rect ids", () => {
    const scale = buildScale("#3b82f6")
    const svg = scalesToFigmaSvg({
      families: [{ name: "Brand Primary", scale }],
      mode: "light",
    })
    expect(svg).toContain('id="brand-primary-500"')
    expect(svg).toContain('id="brand-primary-alpha-500"')
  })
})

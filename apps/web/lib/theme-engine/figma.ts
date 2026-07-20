// Generate a Figma-pasteable SVG color scale, modeled after
// https://www.radix-ui.com/colors/custom "Copy as SVG".
// Produces a white-canvas SVG with two families (Primary + Neutral):
//   • solid row (exact scale colors as hex)
//   • alpha row (brand tint at stepped opacities, 8-digit hex)
// Each <rect> gets a stable id so Figma layers are nicely named.
// Works for both ThemeLab (11 stops) and Radix (12 steps).

import { oklchToHex, toOklch } from "./oklch"
import type { Scale } from "./scale"

export interface FigmaSvgOptions {
  primary: Scale
  neutral: Scale
  mode: "light" | "dark"
  /** Label for the source, e.g. "ThemeLab" or "Radix" */
  title?: string
}

function withAlpha(hex6: string, a: number): string {
  const alpha = Math.max(1, Math.min(255, Math.round(a * 255)))
  return hex6 + alpha.toString(16).padStart(2, "0")
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function scalesToFigmaSvg(opts: FigmaSvgOptions): string {
  const { primary, neutral, mode, title = "Theme" } = opts

  // Convert everything to 6-digit hex for the solids (reliable in SVG).
  const pHex = primary.map((s) => {
    const o = toOklch(s.value)
    return o ? oklchToHex(o) : "#808080"
  })
  const nHex = neutral.map((s) => {
    const o = toOklch(s.value)
    return o ? oklchToHex(o) : "#808080"
  })

  const pStops = primary.map((s) => s.stop)
  const nStops = neutral.map((s) => s.stop)
  const count = pHex.length // 11 or 12

  // Visual params — tuned to feel like the Radix custom colors SVG when pasted.
  const sw = 96 // swatch width
  const sh = 48 // swatch height
  const gap = 4
  const startX = 128
  const rowWidth = count * sw + (count - 1) * gap

  // Vertical rhythm
  const headerH = 64
  const labelH = 20
  const rowGapWithin = 4
  const sectionGap = 48

  const row1Y = headerH + labelH // primary solids
  const row2Y = row1Y + sh + rowGapWithin // primary alpha
  const row3Y = row2Y + sh + sectionGap // neutral solids
  const row4Y = row3Y + sh + rowGapWithin // neutral alpha

  const totalW = startX * 2 + rowWidth
  const totalH = row4Y + sh + 56

  // Always a light canvas (exactly like Radix output).
  const bg = "#ffffff"

  // Choose a single "brand" color for the alpha rows so the second row
  // reads as a clean tint/alpha ramp of the main accent (very close to Radix behavior).
  // Pick a strong mid/high step.
  const brandIdx = Math.min(Math.floor(count * 0.65), count - 1)
  const primaryBrand = pHex[brandIdx] ?? pHex[count - 1] ?? "#3b82f6"
  const neutralBrand =
    nHex[Math.min(Math.floor(count * 0.85), count - 1)] ??
    nHex[count - 1] ??
    "#111111"

  // Alpha progression — low for early steps, higher for later ones.
  // Matches the spirit of the Radix alpha rows (very faint → near-opaque).
  const alphas =
    count === 12
      ? [
          0.015, 0.035, 0.07, 0.11, 0.17, 0.26, 0.38, 0.52, 0.65, 0.76, 0.84,
          0.92,
        ]
      : [0.02, 0.045, 0.085, 0.13, 0.2, 0.3, 0.42, 0.55, 0.68, 0.8, 0.91]

  const pAlpha = pHex.map((_, i) => withAlpha(primaryBrand, alphas[i] ?? 0.1))
  const nAlpha = nHex.map((_, i) => withAlpha(neutralBrand, alphas[i] ?? 0.1))

  // Build rect rows.
  const makeRow = (
    fills: string[],
    y: number,
    family: "primary" | "neutral",
    isAlpha: boolean
  ) =>
    fills
      .map((fill, i) => {
        const x = startX + i * (sw + gap)
        const stop = (family === "primary" ? pStops : nStops)[i] ?? i + 1
        const id = isAlpha ? `${family}-alpha-${stop}` : `${family}-${stop}`
        return `<rect x="${x}" y="${y}" width="${sw}" height="${sh}" fill="${fill}" id="${id}"/>`
      })
      .join("\n  ")

  const primaryRow = makeRow(pHex, row1Y, "primary", false)
  const primaryAlphaRow = makeRow(pAlpha, row2Y, "primary", true)
  const neutralRow = makeRow(nHex, row3Y, "neutral", false)
  const neutralAlphaRow = makeRow(nAlpha, row4Y, "neutral", true)

  // Simple text labels (Figma imports these as editable text layers).
  // Using a robust stack so it looks decent without external fonts.
  const label = (text: string, x: number, y: number) =>
    `<text x="${x}" y="${y}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#111111">${escapeXml(text)}</text>`

  const modeLabel = `${title} · ${mode === "light" ? "Light" : "Dark"}`
  const topLabel = `<text x="${startX}" y="28" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="500" fill="#666666">${escapeXml(modeLabel)}</text>`

  // Subtle hairlines between sections (similar spirit to the Radix gradients, but simple).
  const lineY1 = Math.round(row2Y + sh + sectionGap / 2)
  const lineY2 = Math.round(row4Y + sh + 20)
  const line = (y: number) =>
    `<rect x="${startX}" y="${y}" width="${rowWidth}" height="1" fill="#e5e5e5"/>`

  const svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${totalW}" height="${totalH}" fill="${bg}"/>
  ${topLabel}
  ${label("Primary", startX, row1Y - 10)}
  ${primaryRow}
  ${primaryAlphaRow}
  ${line(lineY1)}
  ${label("Neutral", startX, row3Y - 10)}
  ${neutralRow}
  ${neutralAlphaRow}
  ${line(lineY2)}
</svg>`

  return svg
}

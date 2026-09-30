// Generate a Figma-pasteable SVG color scale, modeled after
// https://www.radix-ui.com/colors/custom "Copy as SVG".
// Produces a white-canvas SVG with N families (e.g. Primary + Neutral),
// stacked vertically, each with:
//   • solid row (exact scale colors as hex)
//   • alpha row (brand tint at stepped opacities, 8-digit hex)
// Each <rect> gets a stable id so Figma layers are nicely named.
// Works for both ThemeLab (11 stops) and Radix (12 steps); the alpha
// progression is chosen per family based on that family's stop count.

import { oklchToHex, toOklch } from "./oklch"
import type { Scale } from "./scale"

export interface FigmaSvgFamily {
  name: string
  scale: Scale
}

export interface FigmaSvgOptions {
  families: FigmaSvgFamily[]
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

/** Sanitize a family name for stable rect ids: lowercase, non [a-z0-9] → "-". */
function sanitizeFamilyName(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9]/g, "-")
  return safe || "family"
}

// Alpha progression — low for early steps, higher for later ones.
// Matches the spirit of the Radix alpha rows (very faint → near-opaque).
const ALPHAS_12 = [
  0.015, 0.035, 0.07, 0.11, 0.17, 0.26, 0.38, 0.52, 0.65, 0.76, 0.84,
  0.92,
]
const ALPHAS_11 = [
  0.02, 0.045, 0.085, 0.13, 0.2, 0.3, 0.42, 0.55, 0.68, 0.8, 0.91,
]

/** Alpha ramp for a family, chosen by that family's stop count. */
function alphasFor(count: number): number[] {
  if (count === 12) {
    return ALPHAS_12
  }
  if (count === 11) {
    return ALPHAS_11
  }
  // Arbitrary lengths: resample the 11-stop ramp proportionally.
  if (count <= 0) {
    return []
  }
  if (count === 1) {
    return [ALPHAS_11[ALPHAS_11.length - 1] ?? 0.1]
  }
  return Array.from(
    { length: count },
    (_, i) =>
      ALPHAS_11[
        Math.round((i * (ALPHAS_11.length - 1)) / (count - 1))
      ] ?? 0.1
  )
}

export function scalesToFigmaSvg(opts: FigmaSvgOptions): string {
  const { families, mode, title = "Theme" } = opts

  // Visual params — tuned to feel like the Radix custom colors SVG when pasted.
  const sw = 96 // swatch width
  const sh = 48 // swatch height
  const gap = 4
  const startX = 128

  // Vertical rhythm
  const headerH = 64
  const labelH = 20
  const rowGapWithin = 4
  const sectionGap = 48

  const rowWidthFor = (count: number) =>
    count > 0 ? count * sw + (count - 1) * gap : 0
  // Canvas fits the widest family so mixed 11/12-stop sets still align.
  const maxCount = Math.max(0, ...families.map((f) => f.scale.length))
  const rowWidth = rowWidthFor(maxCount)

  interface PlacedFamily {
    safe: string
    display: string
    hex: string[]
    stops: number[]
    alphaFills: string[]
    solidY: number
    alphaY: number
  }

  // Stack each family vertically: section label + solid row + alpha row,
  // separated by the sectionGap rhythm.
  let cursorY = headerH + labelH
  const placed: PlacedFamily[] = families.map((family) => {
    const solidY = cursorY
    const alphaY = solidY + sh + rowGapWithin
    cursorY = alphaY + sh + sectionGap

    // Convert everything to 6-digit hex for the solids (reliable in SVG).
    const hex = family.scale.map((s) => {
      const o = toOklch(s.value)
      return o ? oklchToHex(o) : "#808080"
    })
    const count = hex.length

    // Choose a single "brand" color for the alpha row so the second row
    // reads as a clean tint/alpha ramp of the family's accent (very close
    // to Radix behavior). Heuristic: floor(count * 0.65) for EVERY family —
    // a strong mid/high step. (The old two-family code used 0.65 for the
    // first family and 0.85 for the rest; the uniform 0.65 keeps N families
    // consistent and is visually equivalent.)
    const brandIdx = Math.min(Math.floor(count * 0.65), Math.max(count - 1, 0))
    const brand = hex[brandIdx] ?? "#3b82f6"

    const ramp = alphasFor(count)
    const alphaFills = hex.map((_, i) => withAlpha(brand, ramp[i] ?? 0.1))

    return {
      safe: sanitizeFamilyName(family.name),
      display:
        family.name.length > 0
          ? family.name[0]!.toUpperCase() + family.name.slice(1)
          : "Family",
      hex,
      stops: family.scale.map((s) => s.stop),
      alphaFills,
      solidY,
      alphaY,
    }
  })

  const lastBottom =
    placed.length > 0 ? placed[placed.length - 1]!.alphaY + sh : headerH
  const totalW = startX * 2 + rowWidth
  const totalH = lastBottom + 56

  // Always a light canvas (exactly like Radix output).
  const bg = "#ffffff"

  // Build rect rows.
  const makeRow = (fam: PlacedFamily, fills: string[], y: number, isAlpha: boolean) =>
    fills
      .map((fill, i) => {
        const x = startX + i * (sw + gap)
        const stop = fam.stops[i] ?? i + 1
        const id = isAlpha
          ? `${fam.safe}-alpha-${stop}`
          : `${fam.safe}-${stop}`
        return `<rect x="${x}" y="${y}" width="${sw}" height="${sh}" fill="${fill}" id="${id}"/>`
      })
      .join("\n  ")

  // Simple text labels (Figma imports these as editable text layers).
  // Using a robust stack so it looks decent without external fonts.
  const label = (text: string, x: number, y: number) =>
    `<text x="${x}" y="${y}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#111111">${escapeXml(text)}</text>`

  const modeLabel = `${title} · ${mode === "light" ? "Light" : "Dark"}`
  const topLabel = `<text x="${startX}" y="28" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="500" fill="#666666">${escapeXml(modeLabel)}</text>`

  // Subtle hairlines between sections (similar spirit to the Radix gradients, but simple).
  const line = (y: number) =>
    `<rect x="${startX}" y="${y}" width="${rowWidth}" height="1" fill="#e5e5e5"/>`
  const separators = placed
    .slice(0, -1)
    .map((fam) => line(Math.round(fam.alphaY + sh + sectionGap / 2)))
  const bottomLine = line(Math.round(lastBottom + 20))

  const sections = placed
    .map((fam, i) => {
      const sep = i < placed.length - 1 ? `\n  ${separators[i]}` : ""
      return `${label(fam.display, startX, fam.solidY - 10)}
  ${makeRow(fam, fam.hex, fam.solidY, false)}
  ${makeRow(fam, fam.alphaFills, fam.alphaY, true)}${sep}`
    })
    .join("\n  ")

  const svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${totalW}" height="${totalH}" fill="${bg}"/>
  ${topLabel}
  ${sections}
  ${bottomLine}
</svg>`

  return svg
}

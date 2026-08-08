// The luminance hard-gate from the transcript. An HR theme can only seed a rich
// shadcn theme if its 9 slots encode enough distinct lightness levels across a
// wide enough range; otherwise mid-tones (Tailwind 300–700) are pure fabrication.

import { lStar } from "./oklch"
import type {
  HrTheme,
  LuminanceLevel,
  LuminanceReport,
  NativeMode,
  Verdict,
} from "./types"

/** Gate thresholds (from 100r.md): need ≥5 distinct L* spanning ≥70 units. */
export const MIN_UNIQUE_LEVELS = 5
export const MIN_RANGE = 70

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

export function analyze(theme: HrTheme): LuminanceReport {
  const levels: LuminanceLevel[] = Object.entries(theme.slots)
    .map(([slot, hex]) => ({
      slot: slot as LuminanceLevel["slot"],
      hex: hex as string,
      lStar: lStar(hex as string),
    }))
    .toSorted((a, b) => a.lStar - b.lStar)

  const uniqueValues = new Set(levels.map((l) => l.lStar.toFixed(1)))
  const uniqueCount = uniqueValues.size
  const min = levels.length ? levels[0].lStar : 0
  const max = levels.length ? (levels.at(-1)?.lStar ?? 0) : 0
  const range = round(max - min, 1)

  const bg = theme.slots.background ? lStar(theme.slots.background) : min
  const fHigh = theme.slots.f_high ? lStar(theme.slots.f_high) : max
  const nativeMode: NativeMode = bg < fHigh ? "dark" : "light"

  let verdict: Verdict
  const notes: string[] = []
  if (uniqueCount >= MIN_UNIQUE_LEVELS && range >= MIN_RANGE) {
    verdict = "pass"
    notes.push(
      `${uniqueCount} distinct lightness levels spanning ${range} — rich enough for both modes.`
    )
  } else if (uniqueCount >= 3) {
    verdict = "partial"
    notes.push(
      `Only ${uniqueCount} distinct levels (range ${range}). The ${nativeMode} mode maps cleanly; the other mode will be largely synthetic.`
    )
  } else {
    verdict = "fail"
    notes.push(
      `Just ${uniqueCount} distinct levels — too sparse to reconstruct a full design system.`
    )
  }

  if (range < MIN_RANGE && verdict !== "fail") {
    notes.push(
      `Lightness range ${range} is below ${MIN_RANGE}; extreme stops (50/950) are extrapolated.`
    )
  }

  // Score: reward both unique levels (up to 8) and range (up to 100).
  const levelScore = Math.min(uniqueCount, 8) / 8
  const rangeScore = Math.min(range, 100) / 100
  const score = Math.round((levelScore * 0.6 + rangeScore * 0.4) * 100)

  return {
    levels,
    uniqueCount,
    min,
    max,
    range,
    nativeMode,
    verdict,
    score,
    notes,
  }
}

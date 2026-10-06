"use client"

// Hue wheel for the /tailwind tool: shows where each scale's anchor color
// sits in hue/chroma space — angle = OKLCH hue, distance from center =
// chroma (vivid → rim, gray → center). The wheel itself is drawn from OKLCH
// stops so markers always land on their own color (an HSL wheel would skew
// angles: OKLCH yellow ~110° vs HSL 60°, OKLCH blue ~264° vs HSL 240°).
// Display-only; positions derive live from the row inputs.

import { useMemo } from "react"

import { oklchToHex, toOklch } from "@/lib/theme-engine"

interface HueWheelProps {
  colors: { name: string; color: string }[]
}

/** Chroma mapped to the rim — vivid anchors rarely exceed ~0.25. */
const C_RIM = 0.28

// Wheel background, built once: a hue ring in OKLCH (fixed L/C) with a white
// radial overlay fading to transparent at the rim, so the center reads as
// achromatic. L/C chosen as a vivid-but-mostly-in-gamut compromise; slight
// per-channel clipping at the rim in cyans/blues is inherent to sRGB.
const WHEEL_STOPS = Array.from({ length: 24 }, (_, i) => i * 15)
const WHEEL_BACKGROUND = `radial-gradient(circle at center, #ffffff 0%, rgb(255 255 255 / 0) 70%), conic-gradient(in oklch, from 0deg, ${[...WHEEL_STOPS.map((h) => `oklch(0.7 0.16 ${h})`), "oklch(0.7 0.16 360)"].join(", ")})`

interface Marker {
  key: string
  name: string
  hex: string
  xPct: number
  yPct: number
}

export function HueWheel({ colors }: HueWheelProps) {
  const markers = useMemo<Marker[]>(
    () =>
      colors.flatMap(({ name, color }, i) => {
        const o = toOklch(color)
        if (!o) {
          return []
        }
        const hex = oklchToHex(o)
        // Clockwise-from-top to match conic-gradient's 0deg-up orientation.
        const hDeg = (((o.h ?? 0) % 360) + 360) % 360
        const rFrac = Math.min(Math.max(o.c ?? 0, 0) / C_RIM, 1)
        const rad = (hDeg * Math.PI) / 180
        return [
          {
            key: `${name}-${i}`,
            name,
            hex,
            xPct: 50 + rFrac * 50 * Math.sin(rad),
            yPct: 50 - rFrac * 50 * Math.cos(rad),
          },
        ]
      }),
    [colors]
  )

  return (
    <div className="mx-auto w-full max-w-[240px]">
      <div
        role="img"
        aria-label={`Hue wheel with ${markers.length} anchor colors`}
        className="relative aspect-square w-full rounded-full border border-[var(--ov-border)]"
        style={{ background: WHEEL_BACKGROUND }}
      >
        {markers.map((m) => (
          <span
            key={m.key}
            title={`${m.name} · ${m.hex}`}
            className="absolute size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
            style={{
              left: `${m.xPct}%`,
              top: `${m.yPct}%`,
              backgroundColor: m.hex,
            }}
          />
        ))}
      </div>
      <p className="mt-1 text-center text-[10px] text-[var(--ov-text-ghost)]">
        angle = hue · distance = vividness
      </p>
    </div>
  )
}

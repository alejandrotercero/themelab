"use client"

// Hue wheel for the /tailwind tool: shows where each scale's anchor color
// sits in hue/chroma space — angle = OKLCH hue, distance from center = chroma
// relative to the most vivid color of that hue (vivid → rim, gray → center).
// The wheel is drawn from OKLCH-derived stops so markers always land on their
// own color (an HSL wheel would skew angles: OKLCH yellow ~110° vs HSL 60°,
// OKLCH blue ~264° vs HSL 240°). Display-only; positions derive live from the
// row inputs. All math lives in lib/hue-wheel.ts (unit tested).

import { useMemo } from "react"

import { wheelBackground, wheelMarkers } from "@/lib/hue-wheel"

interface HueWheelProps {
  colors: { name: string; color: string }[]
}

// Built once per module — the per-hue gamut search is cached inside lib/.
const WHEEL_BACKGROUND = wheelBackground()

export function HueWheel({ colors }: HueWheelProps) {
  const markers = useMemo(() => wheelMarkers(colors), [colors])

  return (
    <figure className="mx-auto w-full max-w-[240px]">
      <div
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
              // Thin dark outer ring so light/pale dots stay visible where the
              // wheel is near-white (the achromatic center).
              boxShadow: "0 0 0 1px rgb(0 0 0 / 0.35), 0 1px 3px rgb(0 0 0 / 0.4)",
            }}
          />
        ))}
      </div>
      <figcaption className="mt-1 text-center text-[10px] text-[var(--ov-text-ghost)]">
        {markers.length} anchors · angle = hue · distance = vividness
      </figcaption>
    </figure>
  )
}

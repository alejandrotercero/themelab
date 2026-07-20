"use client"

// Output pane for /mindfulpalettes: measures whether each input color is light
// /dark/chromatic enough, flags the extremes that were auto-corrected to a true
// near-white / near-black, and shows the resulting text-on-background contrast.

import type { ReactNode } from "react"

import type { MindfulReport } from "@/lib/theme-engine"

export function MindfulReadout({ report }: { report: MindfulReport }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-wide text-[var(--ov-text-ghost)] uppercase">
          Palette check
        </span>
        <span className="text-[10px] text-[var(--ov-text-dim)] tabular-nums">
          text contrast — light {report.contrast.light}:1 · dark{" "}
          {report.contrast.dark}:1
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {report.measures.map((m) => {
          const isAccent = m.role.startsWith("accent")

          let flag: ReactNode = null
          if (m.correctedL !== null) {
            flag = (
              <span
                className="ml-auto shrink-0 text-[var(--ov-accent)] tabular-nums"
                title={`auto-corrected to L ${m.correctedL} for a true light/dark extreme`}
              >
                → {m.correctedL}
              </span>
            )
          } else if (!m.ok) {
            flag = (
              <span
                className="ml-auto shrink-0 text-[var(--ov-danger)]"
                title={
                  isAccent
                    ? "low chroma — accent may read flat"
                    : "outside the ideal light/dark band"
                }
              >
                !
              </span>
            )
          }

          return (
            <li key={m.role} className="flex items-center gap-2 text-[11px]">
              <span
                className="size-3.5 shrink-0 rounded-[var(--ov-radius-xs)] border border-[var(--ov-border)]"
                style={{ backgroundColor: m.hex }}
              />
              <span className="w-12 shrink-0 truncate text-[var(--ov-text-dim)]">
                {m.role}
              </span>
              <span className="shrink-0 text-[var(--ov-text)] tabular-nums">
                {isAccent ? `C ${m.chroma}` : `L ${m.lStar}`}
              </span>
              {flag}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

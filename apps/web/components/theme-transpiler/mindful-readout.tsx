"use client";

// Output pane for /mindfulpalettes: measures whether each input color is light
// /dark/chromatic enough, flags the extremes that were auto-corrected to a true
// near-white / near-black, and shows the resulting text-on-background contrast.

import type { MindfulReport } from "@/lib/theme-engine";

export function MindfulReadout({ report }: { report: MindfulReport }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ov-text-ghost)]">
          Palette check
        </span>
        <span className="text-[10px] tabular-nums text-[var(--ov-text-dim)]">
          text contrast — light {report.contrast.light}:1 · dark {report.contrast.dark}:1
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {report.measures.map((m) => {
          const isAccent = m.role.startsWith("accent");
          return (
            <li key={m.role} className="flex items-center gap-2 text-[11px]">
              <span
                className="size-3.5 shrink-0 rounded-[var(--ov-radius-xs)] border border-[var(--ov-border)]"
                style={{ backgroundColor: m.hex }}
              />
              <span className="w-12 shrink-0 truncate text-[var(--ov-text-dim)]">{m.role}</span>
              <span className="shrink-0 tabular-nums text-[var(--ov-text)]">
                {isAccent ? `C ${m.chroma}` : `L ${m.lStar}`}
              </span>
              {m.correctedL !== null ? (
                <span
                  className="ml-auto shrink-0 tabular-nums text-[var(--ov-accent)]"
                  title={`auto-corrected to L ${m.correctedL} for a true light/dark extreme`}
                >
                  → {m.correctedL}
                </span>
              ) : !m.ok ? (
                <span
                  className="ml-auto shrink-0 text-[var(--ov-danger)]"
                  title={isAccent ? "low chroma — accent may read flat" : "outside the ideal light/dark band"}
                >
                  !
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

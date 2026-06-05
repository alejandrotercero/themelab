"use client";

// Compact quality grader for the boom bar: verdict + native mode + metrics, and
// a single L* track with a tick per slot (dark → light).

import { oklchToHex, toOklch, type LuminanceReport } from "@/lib/theme-engine";

const VERDICT_LABEL: Record<LuminanceReport["verdict"], string> = {
  pass: "Passes",
  partial: "Partial",
  fail: "Too sparse",
};

export function ValidationReadout({ report }: { report: LuminanceReport }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ov-text-ghost)]">
        Theme benchmark
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="ov-chip" data-tone={report.verdict}>
          {VERDICT_LABEL[report.verdict]}
        </span>
        <span className="ov-chip">{report.nativeMode}-native</span>
        <span className="ov-chip">{report.uniqueCount} levels</span>
        <span className="ov-chip">range {report.range}</span>
        <span className="ml-auto text-xs text-[var(--ov-text-dim)]">quality {report.score}/100</span>
      </div>

      {/* L* track — a tick per slot positioned by perceptual lightness. */}
      <div className="relative h-6 rounded-[var(--ov-radius-sm)] border border-[var(--ov-border)] bg-[var(--ov-surface)]">
        {report.levels.map((lvl, i) => {
          const o = toOklch(lvl.hex);
          const hex = o ? oklchToHex(o) : lvl.hex;
          return (
            <span
              key={`${lvl.slot}-${i}`}
              title={`${lvl.slot} · L* ${lvl.lStar}`}
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--ov-bg)]"
              style={{ left: `${lvl.lStar}%`, backgroundColor: hex }}
            />
          );
        })}
      </div>

      {report.notes[0] && (
        <p className="text-[11px] leading-relaxed text-[var(--ov-text-dim)]">{report.notes[0]}</p>
      )}
    </div>
  );
}

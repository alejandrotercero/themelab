"use client";

// A single token color control in the overlay's theme-panel row style: swatch +
// label + mono value input, plus a "source colors" popover (like the overlay's
// palette button) that replaces the value with one of the 9 SVG colors.
//
// Adapted from tweakcn (https://github.com/jnsahaj/tweakcn), Apache-2.0 —
// components/editor/color-picker.tsx (de-coupled from its zustand store).
// See apps/web/NOTICE.

import { useState } from "react";
import { DiamondsFourIcon } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { oklchToHex, toOklch, oklchCss } from "@/lib/theme-engine";
import { SwatchPopover } from "./swatch-popover";

export interface SourceColor {
  slot: string;
  hex: string;
}

interface ColorPickerProps {
  token: string;
  /** Current value as an `oklch(...)` string. */
  value: string;
  /** Whether this token has been manually overridden (label shows accent). */
  edited?: boolean;
  /** The 9 HR source colors, offered for one-click override. */
  palette?: SourceColor[];
  onChange: (next: string) => void;
}

export function ColorPicker({ token, value, edited, palette, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = toOklch(value);
  const hex = parsed ? oklchToHex(parsed) : "#000000";
  // Many swatches (e.g. a full Tailwind scale) → dense, label-less grid.
  const dense = (palette?.length ?? 0) > 12;

  const commitHex = (nextHex: string) => {
    const o = toOklch(nextHex);
    if (o) onChange(oklchCss(o));
  };

  return (
    <div className="ov-row">
      <SwatchPopover value={hex} onChange={commitHex} title={`${token}: ${hex}`} className="size-[18px]" />
      <span
        title={token}
        className="w-28 shrink-0 truncate text-[11px]"
        style={{ color: edited ? "var(--ov-accent)" : "var(--ov-text-dim)" }}
      >
        {token}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="ov-input min-w-0 flex-1 tabular-nums"
      />
      {palette && palette.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className="ov-btn shrink-0 px-1.5"
            aria-label="Replace with a source color"
            title="Replace with a color from the SVG"
          >
            <DiamondsFourIcon weight="bold" className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent align="end" className="tl-overlay w-auto max-w-[19rem] gap-2 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ov-text-ghost)]">
              Source colors
            </div>
            <div className={dense ? "grid grid-cols-6 gap-1" : "grid grid-cols-3 gap-2"}>
              {palette.map((s) => (
                <button
                  key={s.slot}
                  type="button"
                  title={`${s.slot} · ${s.hex}`}
                  onClick={() => {
                    commitHex(s.hex);
                    setOpen(false);
                  }}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className={`${dense ? "size-7" : "size-8"} rounded-[var(--ov-radius-xs)] border border-[var(--ov-border)]`}
                    style={{ backgroundColor: s.hex }}
                  />
                  {!dense && (
                    <span className="w-12 truncate text-center text-[9px] text-[var(--ov-text-dim)]">{s.slot}</span>
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

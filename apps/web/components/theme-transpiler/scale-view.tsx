"use client";

// The Tailwind 50–950 (or Radix 1–12) ramps for the /create tool — a labeled row of swatches
// per scale. Click a swatch to copy its value. When figmaSvg is provided, a "Figma" copy
// button appears in the header so users can directly copy a full SVG (solids + alphas) for Figma.

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useState } from "react";
import { oklchToHex, toOklch, type Scale } from "@/lib/theme-engine";

interface ScaleViewProps {
  scales: { name: string; scale: Scale }[];
  /** When provided, renders a compact "Figma" button in the header that copies a full
   *  Figma-pasteable SVG (solids + alpha rows) using the live scales for the current mode. */
  figmaSvg?: () => string;
}

export function ScaleView({ scales, figmaSvg }: ScaleViewProps) {
  const [copiedFigma, setCopiedFigma] = useState(false);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  const copyFigma = async () => {
    if (!figmaSvg) return;
    try {
      const svg = figmaSvg();
      await navigator.clipboard.writeText(svg);
      setCopiedFigma(true);
      toast.success("Figma SVG copied");
      setTimeout(() => setCopiedFigma(false), 1500);
    } catch {
      toast.error("Couldn't copy SVG.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ov-text-ghost)]">
          Scale
        </h3>
        {figmaSvg && (
          <button
            type="button"
            onClick={copyFigma}
            className="ov-btn flex items-center gap-1 px-1.5 py-px text-[10px]"
            title="Copy  accent + neutral scales as SVG for Figma (solids + alpha rows)"
          >
            {copiedFigma ? (
              <CheckIcon weight="bold" className="size-3" />
            ) : (
              <CopyIcon weight="bold" className="size-3" />
            )}
            {copiedFigma ? "Copied" : "Figma"}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {scales.map(({ name, scale }) => (
          <div key={name} className="flex items-center gap-2">
            <span className="w-14 shrink-0 truncate text-[11px] text-[var(--ov-text-dim)]">{name}</span>
            <div className="flex flex-1 overflow-hidden rounded-[var(--ov-radius-xs)] border border-[var(--ov-border)]">
              {scale.map(({ stop, value }) => {
                const o = toOklch(value);
                const hex = o ? oklchToHex(o) : value;
                return (
                  <button
                    key={stop}
                    type="button"
                    title={`${name}-${stop} · ${hex}`}
                    onClick={() => copy(value, `${name}-${stop}`)}
                    className="h-6 flex-1"
                    style={{ backgroundColor: hex }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

// The Tailwind 50–950 ramps for the /create tool — a labeled row of 11 swatches
// per scale. Click a swatch to copy its value.

import { toast } from "sonner";
import { oklchToHex, toOklch, type Scale } from "@/lib/theme-engine";

interface ScaleViewProps {
  scales: { name: string; scale: Scale }[];
}

export function ScaleView({ scales }: ScaleViewProps) {
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ov-text-ghost)]">
        Scale
      </h3>
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

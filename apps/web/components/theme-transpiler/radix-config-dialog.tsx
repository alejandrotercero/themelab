"use client";

// Radix mode's color inputs, in a modal: accent, neutral and background tweaked
// separately for light and dark, so each appearance runs through Radix's
// generator with its own inputs. Overlay-skinned.

import type { RadixInputs, RadixModeColors } from "@/lib/theme-engine";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SwatchPopover } from "./swatch-popover";

interface RadixConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: RadixInputs;
  onChange: (next: RadixInputs) => void;
  onGenerate: () => void;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--ov-text-dim)]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-[var(--ov-text-dim)]">{value}</span>
        <SwatchPopover value={value} onChange={onChange} title={`${label}: ${value}`} className="size-6" />
      </div>
    </div>
  );
}

function ModeSection({
  title,
  colors,
  onChange,
}: {
  title: string;
  colors: RadixModeColors;
  onChange: (next: RadixModeColors) => void;
}) {
  const set = (patch: Partial<RadixModeColors>) => onChange({ ...colors, ...patch });
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--ov-border)] pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ov-text-ghost)]">{title}</span>
      <Field label="Accent" value={colors.accent} onChange={(accent) => set({ accent })} />
      <Field label="Neutral" value={colors.gray} onChange={(gray) => set({ gray })} />
      <Field label="Background" value={colors.bg} onChange={(bg) => set({ bg })} />
    </div>
  );
}

export function RadixConfigDialog({ open, onOpenChange, values, onChange, onGenerate }: RadixConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tl-overlay max-w-sm gap-0 p-0" style={{ borderColor: "var(--ov-border)" }}>
        <DialogHeader className="border-b border-[var(--ov-border)] p-4">
          <DialogTitle className="text-sm">Radix colors</DialogTitle>
          <DialogDescription className="text-xs">
            Tweak accent, neutral &amp; background separately per mode.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-4">
          <ModeSection title="Light mode" colors={values.light} onChange={(light) => onChange({ ...values, light })} />
          <ModeSection title="Dark mode" colors={values.dark} onChange={(dark) => onChange({ ...values, dark })} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--ov-border)] p-3">
          <DialogClose className="ov-btn">Cancel</DialogClose>
          <button
            type="button"
            className="ov-btn ov-btn-primary"
            onClick={() => {
              onGenerate();
              onOpenChange(false);
            }}
          >
            Generate
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

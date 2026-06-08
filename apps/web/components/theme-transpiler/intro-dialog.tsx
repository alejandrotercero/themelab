"use client";

// First-load intro: what Hundred Rabbits (100r) themes are, why they're nice,
// and where to get them. Overlay-skinned, controlled by the island.

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Logo } from "@/components/logo";

const THEMES_URL = "https://github.com/hundredrabbits/Themes";

interface IntroDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IntroDialog({ open, onOpenChange }: IntroDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tl-overlay flex max-w-lg flex-col gap-4 p-6" style={{ borderColor: "var(--ov-border)" }}>
        <Logo className="h-4 text-[var(--ov-text)]" />
        <DialogTitle className="text-base font-semibold text-[var(--ov-text)]">
          Hundred Rabbits themes → shadcn
        </DialogTitle>

        <div className="flex flex-col gap-3 text-sm leading-relaxed text-[var(--ov-text-dim)]">
          <p>
            <span className="text-[var(--ov-text)]">Hundred Rabbits (100r)</span> is a two-person studio
            that builds tiny, portable creative tools. Their theme format is dead simple: a single SVG
            that encodes just <span className="text-[var(--ov-text)]">9 colors</span> — a background,
            four foregrounds, and four backgrounds.
          </p>
          <p>
            That makes themes tiny, human-readable, and drag-and-drop portable across their whole
            ecosystem (Orca, Left, Dotgrid…). It&apos;s constraint-driven design — nine colors, no bloat.
          </p>
          <p>
            This tool transpiles those nine colors into a full{" "}
            <span className="text-[var(--ov-text)]">shadcn / Tailwind theme</span> — 31 tokens, light and
            dark — using OKLCH interpolation. Drop an SVG and go.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <a href={THEMES_URL} target="_blank" rel="noreferrer noopener" className="ov-btn">
            <ArrowSquareOutIcon weight="bold" className="size-3.5" />
            Get themes
          </a>
          <button type="button" className="ov-btn ov-btn-primary" onClick={() => onOpenChange(false)}>
            Start building
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

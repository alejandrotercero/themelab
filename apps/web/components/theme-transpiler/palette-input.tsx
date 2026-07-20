"use client"

// Controlled primary + neutral color inputs with a Generate button, for the
// /create tool's boom bar.

import { SwatchPopover } from "./swatch-popover"

interface PaletteInputProps {
  primary: string
  neutral: string
  onPrimary: (hex: string) => void
  onNeutral: (hex: string) => void
  onGenerate: () => void
}

function Swatch({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <SwatchPopover
        value={value}
        onChange={onChange}
        title={`${label}: ${value}`}
        className="size-[18px]"
      />
      <span className="text-[11px] text-[var(--ov-text-dim)]">{label}</span>
    </div>
  )
}

export function PaletteInput({
  primary,
  neutral,
  onPrimary,
  onNeutral,
  onGenerate,
}: PaletteInputProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Swatch label="primary" value={primary} onChange={onPrimary} />
      <Swatch label="neutral" value={neutral} onChange={onNeutral} />
      <button
        type="button"
        className="ov-btn ov-btn-primary"
        onClick={onGenerate}
      >
        Generate
      </button>
    </div>
  )
}

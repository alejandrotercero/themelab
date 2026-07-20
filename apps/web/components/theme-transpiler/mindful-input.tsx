"use client"

// Mindful Palette input for the boom bar: six color swatches grouped as
// 2 light · 2 accent · 2 dark, a preset picker, and a Generate button. Credits
// the #MindfulPalettes format by Alex Cristache.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MindfulColors } from "@/lib/theme-engine"
import { MINDFUL_PRESETS } from "@/lib/theme-engine"

import { SwatchPopover } from "./swatch-popover"

interface MindfulInputProps {
  colors: MindfulColors
  onColor: (key: keyof MindfulColors, hex: string) => void
  onPreset: (id: string) => void
  onGenerate: () => void
}

function Group({
  label,
  fields,
  colors,
  onColor,
}: {
  label: string
  fields: { key: keyof MindfulColors; title: string }[]
  colors: MindfulColors
  onColor: (key: keyof MindfulColors, hex: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold tracking-wide text-[var(--ov-text-ghost)] uppercase">
        {label}
      </span>
      {fields.map((f) => (
        <SwatchPopover
          key={f.key}
          value={colors[f.key]}
          onChange={(hex) => onColor(f.key, hex)}
          title={`${f.title}: ${colors[f.key]}`}
          className="size-[18px]"
        />
      ))}
    </div>
  )
}

export function MindfulInput({
  colors,
  onColor,
  onPreset,
  onGenerate,
}: MindfulInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Group
          label="Light"
          colors={colors}
          onColor={onColor}
          fields={[
            { key: "light1", title: "light 1" },
            { key: "light2", title: "light 2" },
          ]}
        />
        <Group
          label="Accent"
          colors={colors}
          onColor={onColor}
          fields={[
            { key: "accent1", title: "accent 1 (primary)" },
            { key: "accent2", title: "accent 2 (secondary)" },
          ]}
        />
        <Group
          label="Dark"
          colors={colors}
          onColor={onColor}
          fields={[
            { key: "dark1", title: "dark 1" },
            { key: "dark2", title: "dark 2" },
          ]}
        />

        <Select onValueChange={(v) => v && onPreset(String(v))}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder="Preset…" />
          </SelectTrigger>
          <SelectContent
            className="tl-overlay w-auto max-w-[min(90vw,26rem)] min-w-(--anchor-width)"
            alignItemWithTrigger={false}
          >
            {MINDFUL_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          className="ov-btn ov-btn-primary"
          onClick={onGenerate}
        >
          Generate
        </button>
      </div>

      <p className="text-[10px] text-[var(--ov-text-dim)]">
        Palette format:{" "}
        <a
          href="https://x.com/AlexCristache"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-[var(--ov-text)]"
        >
          #MindfulPalettes by Alex Cristache
        </a>
      </p>
    </div>
  )
}

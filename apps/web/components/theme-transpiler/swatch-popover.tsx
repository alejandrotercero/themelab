"use client"

// A color swatch that opens the Kibo color picker in an overlay-skinned popover.
// Emits hex; callers convert to whatever they store. The Kibo picker's controlled
// `value` is unreliable, so we seed `defaultValue` and rely on the popover
// unmounting on close to re-seed from the current value each time it opens.

import { formatHex } from "culori"
import { useState } from "react"

import {
  ColorPicker,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection,
} from "@/components/kibo-ui/color-picker"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface SwatchPopoverProps {
  /** Current color as hex. */
  value: string
  onChange: (hex: string) => void
  title?: string
  className?: string
}

export function SwatchPopover({
  value,
  onChange,
  title,
  className,
}: SwatchPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        type="button"
        title={title}
        style={{ backgroundColor: value }}
        className={cn(
          "shrink-0 cursor-pointer rounded-[var(--ov-radius-xs)] border border-[var(--ov-border)]",
          className
        )}
      />
      <PopoverContent
        align="start"
        className="tl-overlay w-72 gap-3 p-3"
        // Enter is the keyboard commit gesture: the picker applies each keystroke
        // live, so Enter just dismisses. (Escape still closes via base-ui.)
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            setOpen(false)
          }
        }}
      >
        <ColorPicker
          defaultValue={value}
          onChange={(next) => {
            if (!Array.isArray(next)) {
              return
            }
            const [r, g, b] = next as number[]
            const hex = formatHex({
              mode: "rgb",
              r: r / 255,
              g: g / 255,
              b: b / 255,
            })
            // Skip the no-op emit on mount (seed → same color).
            if (hex && hex.toLowerCase() !== value.toLowerCase()) {
              onChange(hex)
            }
          }}
          className="gap-3"
        >
          <ColorPickerSelection className="h-36" />
          <div className="flex items-center gap-2">
            <ColorPickerEyeDropper />
            <ColorPickerHue className="flex-1" />
          </div>
          <div className="flex items-center gap-2">
            <ColorPickerOutput />
            <ColorPickerFormat className="flex-1" />
          </div>
        </ColorPicker>
      </PopoverContent>
    </Popover>
  )
}

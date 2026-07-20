"use client"

// Small controlled dialog to name a theme — reused for the first Save (pre-filled
// with the source label) and for Rename. Confirms on Enter. Portaled content gets
// `tl-overlay` so it keeps the studio skin (Dialog renders at <body>).

import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

interface NameThemeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName: string
  title?: string
  description?: string
  confirmLabel?: string
  onConfirm: (name: string) => void
}

export function NameThemeDialog({
  open,
  onOpenChange,
  initialName,
  title = "Save theme",
  description = "Give this theme a name to keep it in your library.",
  confirmLabel = "Save",
  onConfirm,
}: NameThemeDialogProps) {
  const [name, setName] = useState(initialName)

  // Reset the field whenever the dialog (re)opens with a new starting name.
  // Adjusted during render (React's documented "adjusting state when a prop
  // changes" pattern) instead of an effect, since it only depends on props.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setName(initialName)
    }
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    onConfirm(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tl-overlay sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="My theme"
          aria-label="Theme name"
        />
        <DialogFooter>
          <button
            type="button"
            className="ov-btn"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ov-btn ov-btn-primary"
            onClick={submit}
            disabled={!name.trim()}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

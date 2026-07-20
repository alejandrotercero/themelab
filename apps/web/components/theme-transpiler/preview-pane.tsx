"use client"

// Scopes the active theme onto a wrapper element (inline CSS vars + local `.dark`)
// so the preview re-themes without touching the editor chrome. The wrapper also
// paints `--background`/`--foreground` so it reads as a real page surface.

import { useEffect, useRef } from "react"

import { applyVars } from "./apply-vars"
import { Showcase } from "./showcase"

interface PreviewPaneProps {
  /** The active mode's resolved tokens. */
  vars: Record<string, string>
  mode: "light" | "dark"
  /** Radius CSS value, e.g. "0.625rem". */
  radius: string
}

export function PreviewPane({ vars, mode, radius }: PreviewPaneProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) {
      applyVars(ref.current, vars, { dark: mode === "dark", radius })
    }
  }, [vars, mode, radius])

  return (
    <div
      ref={ref}
      className="min-h-full bg-background p-6 text-foreground"
      style={
        {
          colorScheme: mode,
          // Preview uses Inter (a normal app font), overriding the mono chrome.
          fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
          "--font-sans":
            "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
        } as React.CSSProperties
      }
    >
      <Showcase />
    </div>
  )
}

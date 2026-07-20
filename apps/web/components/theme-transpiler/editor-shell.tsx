"use client"

// The shared overlay-skinned chrome for both tools: toolbar, full-height token
// editor sidebar, live preview with the sun/moon toggle, and a boom bar whose
// left (input) and right (output) are provided by each tool. Driven entirely by
// the useThemeEditor hook so the two tools stay in lockstep.

import { MoonIcon, SunIcon } from "@phosphor-icons/react"
import type { ReactNode } from "react"

import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"

import { PreviewPane } from "./preview-pane"
import { TokenControls } from "./token-controls"
import type { useThemeEditor } from "./use-theme-editor"

interface EditorShellProps {
  editor: ReturnType<typeof useThemeEditor>
  toolbar: ReactNode
  /** Left side of the boom bar (the tool's input). */
  input: ReactNode
  /** Right side of the boom bar (grader, scales…), or null. */
  output: ReactNode
  /** Portals/dialogs/toaster rendered inside the root. */
  children?: ReactNode
}

export function EditorShell({
  editor,
  toolbar,
  input,
  output,
  children,
}: EditorShellProps) {
  // Destructure to avoid the react-hooks/refs false-positive: the linter treats
  // all properties of an object containing a ref as "ref accesses during render".
  // These are plain state values and dispatch functions — not refs.
  const {
    rootRef,
    activeVars,
    edited,
    mode,
    radius,
    swatches,
    setMode,
    setToken,
    setRadius,
    source,
    applyToSite,
    setApplyToSite,
  } = editor

  return (
    <div ref={rootRef} className="tl-overlay flex h-dvh flex-col">
      {toolbar}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Editor — full-height sidebar */}
        <aside className="min-h-0 overflow-hidden border-b border-[var(--ov-border)] lg:w-[340px] lg:shrink-0 lg:border-r lg:border-b-0">
          <ScrollArea className="h-full">
            <TokenControls
              vars={activeVars}
              edited={edited}
              mode={mode}
              radius={radius}
              palette={swatches}
              onMode={setMode}
              onToken={setToken}
              onRadius={setRadius}
            />
          </ScrollArea>
        </aside>

        {/* Preview + boom bar */}
        <div className="flex min-h-0 flex-1 flex-col">
          <main className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className="ov-seg absolute top-3 right-3 z-10 shadow-lg"
              role="tablist"
              aria-label="Preview mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "light"}
                aria-label="Light"
                data-active={mode === "light"}
                className="ov-seg-btn"
                onClick={() => setMode("light")}
              >
                <SunIcon weight="bold" className="size-3.5" />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "dark"}
                aria-label="Dark"
                data-active={mode === "dark"}
                className="ov-seg-btn"
                onClick={() => setMode("dark")}
              >
                <MoonIcon weight="bold" className="size-3.5" />
              </button>
            </div>
            <ScrollArea className="h-full">
              <PreviewPane vars={activeVars} mode={mode} radius={radius} />
            </ScrollArea>
          </main>

          <footer className="border-t border-[var(--ov-border)] p-3">
            <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-[10px] font-semibold tracking-wide text-[var(--ov-text-ghost)] uppercase">
                      Theme:
                    </span>
                    <span className="truncate text-lg font-semibold text-[var(--ov-text)]">
                      {source || "Untitled"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      id="apply-page"
                      checked={applyToSite}
                      onCheckedChange={setApplyToSite}
                    />
                    <Label
                      htmlFor="apply-page"
                      className="text-xs text-[var(--ov-text-dim)]"
                    >
                      Apply to page
                    </Label>
                  </div>
                </div>
                {input}
              </div>
              {output}
            </div>
          </footer>
        </div>
      </div>

      {children}
    </div>
  )
}

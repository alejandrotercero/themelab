"use client";

// The shared overlay-skinned chrome for both tools: toolbar, full-height token
// editor sidebar, live preview with the sun/moon toggle, and a boom bar whose
// left (input) and right (output) are provided by each tool. Driven entirely by
// the useThemeEditor hook so the two tools stay in lockstep.

import type { ReactNode } from "react";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TokenControls } from "./token-controls";
import { PreviewPane } from "./preview-pane";
import type { useThemeEditor } from "./use-theme-editor";

interface EditorShellProps {
  editor: ReturnType<typeof useThemeEditor>;
  toolbar: ReactNode;
  /** Left side of the boom bar (the tool's input). */
  input: ReactNode;
  /** Right side of the boom bar (grader, scales…), or null. */
  output: ReactNode;
  /** Portals/dialogs/toaster rendered inside the root. */
  children?: ReactNode;
}

export function EditorShell({ editor, toolbar, input, output, children }: EditorShellProps) {
  return (
    <div ref={editor.rootRef} className="tl-overlay flex h-dvh flex-col">
      {toolbar}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Editor — full-height sidebar */}
        <aside className="min-h-0 overflow-hidden border-b border-[var(--ov-border)] lg:w-[340px] lg:shrink-0 lg:border-r lg:border-b-0">
          <ScrollArea className="h-full">
            <TokenControls
              vars={editor.activeVars}
              edited={editor.edited}
              mode={editor.mode}
              radius={editor.radius}
              palette={editor.swatches}
              onMode={editor.setMode}
              onToken={editor.setToken}
              onRadius={editor.setRadius}
            />
          </ScrollArea>
        </aside>

        {/* Preview + boom bar */}
        <div className="flex min-h-0 flex-1 flex-col">
          <main className="relative min-h-0 flex-1 overflow-hidden">
            <div className="ov-seg absolute right-3 top-3 z-10 shadow-lg" role="tablist" aria-label="Preview mode">
              <button
                type="button"
                role="tab"
                aria-selected={editor.mode === "light"}
                aria-label="Light"
                data-active={editor.mode === "light"}
                className="ov-seg-btn"
                onClick={() => editor.setMode("light")}
              >
                <SunIcon weight="bold" className="size-3.5" />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editor.mode === "dark"}
                aria-label="Dark"
                data-active={editor.mode === "dark"}
                className="ov-seg-btn"
                onClick={() => editor.setMode("dark")}
              >
                <MoonIcon weight="bold" className="size-3.5" />
              </button>
            </div>
            <ScrollArea className="h-full">
              <PreviewPane vars={editor.activeVars} mode={editor.mode} radius={editor.radius} />
            </ScrollArea>
          </main>

          <footer className="border-t border-[var(--ov-border)] p-3">
            <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--ov-text-ghost)]">
                      Theme:
                    </span>
                    <span className="truncate text-lg font-semibold text-[var(--ov-text)]">
                      {editor.source || "Untitled"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      id="apply-page"
                      checked={editor.applyToSite}
                      onCheckedChange={editor.setApplyToSite}
                    />
                    <Label htmlFor="apply-page" className="text-xs text-[var(--ov-text-dim)]">
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
  );
}

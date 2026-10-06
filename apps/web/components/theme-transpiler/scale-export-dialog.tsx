"use client"

// "Code" export dialog for the /tailwind tool's generated scales: Tailwind v4
// @theme CSS plus a Figma SVG tab. Chrome mirrors export-dialog.tsx.

import { CheckIcon, CodeIcon, CopyIcon, XIcon } from "@phosphor-icons/react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { scaleToCss, scalesToFigmaSvg } from "@/lib/theme-engine"
import type { ColorFormat, Scale } from "@/lib/theme-engine"

type Tab = "tailwind" | "figma"

interface ScaleExportDialogProps {
  /** Generated scales to export. */
  scales: { name: string; scale: Scale }[]
  /** Label for the figma SVG header. */
  title: string
  /** Theme-set display name, for the dialog title only. */
  name: string
  /** Shared color format (selector lives on the /tailwind sidebar). */
  format: ColorFormat
}

export function ScaleExportDialog({
  scales,
  title,
  name,
  format,
}: ScaleExportDialogProps) {
  const [tab, setTab] = useState<Tab>("tailwind")
  const [copied, setCopied] = useState(false)

  const twCss = useMemo(
    () =>
      scales.length > 0
        ? scaleToCss(
            Object.fromEntries(scales.map((s) => [s.name, s.scale])),
            format
          )
        : "",
    [scales, format]
  )
  const figma = useMemo(
    () =>
      scales.length > 0
        ? scalesToFigmaSvg({ families: scales, mode: "light", title })
        : "",
    [scales, title]
  )

  const content = tab === "tailwind" ? twCss : figma
  const code = twCss || "// Add a scale row and press Generate."

  const copy = async () => {
    try {
      if (!content) {
        return
      }
      await navigator.clipboard.writeText(content)
      setCopied(true)
      if (tab === "figma") {
        toast.success("SVG copied — paste into Figma")
      } else {
        toast.success("Copied to clipboard")
      }
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't access the clipboard.")
    }
  }

  const description =
    tab === "figma"
      ? "SVG color scales for Figma — paste directly into your file."
      : "Tailwind v4 — paste into your globals.css."

  return (
    <Dialog>
      <DialogTrigger className="ov-btn ov-btn-primary">
        <CodeIcon weight="bold" className="size-3.5" />
        Code
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="tl-overlay sm:max-w-3xl w-[calc(100%-2rem)] gap-0 overflow-hidden p-0"
        style={{ borderColor: "var(--ov-border)" }}
      >
        <DialogHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-[var(--ov-border)] p-4">
          <div className="text-left">
            <DialogTitle className="text-sm">
              {name ? `${name} — Scale code` : "Scale code"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {description}
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className="text-[11px] tracking-wide text-[var(--ov-text-ghost)] uppercase"
              title="Color format — change it on the sidebar"
            >
              {format}
            </span>
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as Tab)}
              className="max-w-full min-w-0"
            >
              <TabsList className="max-w-full flex-wrap justify-start">
                <TabsTrigger value="tailwind">tailwind</TabsTrigger>
                <TabsTrigger value="figma">figma</TabsTrigger>
              </TabsList>
            </Tabs>
            <button
              type="button"
              className="ov-btn"
              onClick={copy}
              disabled={!content}
            >
              {copied ? (
                <CheckIcon weight="bold" className="size-3.5" />
              ) : (
                <CopyIcon weight="bold" className="size-3.5" />
              )}
              {copied ? "Copied" : tab === "figma" ? "Copy SVG" : "Copy"}
            </button>
            <DialogClose className="ov-btn px-2" aria-label="Close">
              <XIcon weight="bold" className="size-3.5" />
            </DialogClose>
          </div>
        </DialogHeader>
        {tab === "figma" && (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-4 overflow-auto bg-[var(--ov-bg)] p-6">
            <div className="w-full max-w-[980px]">
              <div className="mb-2 max-w-[980px] text-center text-[10px] leading-relaxed text-[var(--ov-text-dim)]">
                White canvas with solid + alpha rows. Layer names are set via
                ids. The alpha row is one mid-tone tint per family at stepped
                opacities (8-digit hex) — paste into Figma, then create color
                styles / variables from the rectangles.
              </div>
              <div className="overflow-auto rounded border border-[var(--ov-border)] bg-white p-3 shadow-inner">
                {/* Render the SVG via data URI so it scales cleanly as an image preview */}
                {figma && (
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(figma)}`}
                    alt="Figma scale preview"
                    className="block h-auto w-full max-w-full"
                  />
                )}
              </div>
            </div>
            <button
              type="button"
              className="ov-btn"
              onClick={copy}
              disabled={!figma}
            >
              {copied ? (
                <CheckIcon weight="bold" className="size-3.5" />
              ) : (
                <CopyIcon weight="bold" className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy SVG for Figma"}
            </button>
          </div>
        )}
        {tab === "tailwind" && (
          <ScrollArea className="h-[60vh]">
            <pre className="p-4 text-xs leading-relaxed text-[var(--ov-text)]">
              <code>{code}</code>
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}

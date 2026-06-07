"use client";

// "Code" export dialog: shows the generated theme CSS in a code block with a
// color-format selector and copy button. When `tailwindCss` is provided (the
// /create tool), a second tab shows the Tailwind 50–950 @theme scales.
//
// Presentational pattern adapted from tweakcn (https://github.com/jnsahaj/tweakcn),
// Apache-2.0 — components/editor/code-panel.tsx (fed by our own generator, no
// zustand/syntax-highlighter deps). See apps/web/NOTICE.

import { useMemo, useState } from "react";
import { CheckIcon, CodeIcon, CopyIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { ThemeStyles } from "@themelab/shared";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COLOR_FORMATS, themeStylesToCss, themeStylesToJson, type ColorFormat } from "@/lib/theme-engine";

type Tab = "shadcn" | "json" | "tailwind" | "figma";

interface ExportDialogProps {
  theme: ThemeStyles;
  /** Radius CSS value, e.g. "0.625rem". */
  radius: string;
  /** Optional Tailwind-scale generator; when set, a third tab is shown. */
  tailwindCss?: (format: ColorFormat) => string;
  /** Optional Figma SVG generator (used by /create). When set, a "figma" tab appears. */
  figmaSvg?: () => string;
}

export function ExportDialog({ theme, radius, tailwindCss, figmaSvg }: ExportDialogProps) {
  const [format, setFormat] = useState<ColorFormat>("oklch");
  const [tab, setTab] = useState<Tab>("shadcn");
  const [copied, setCopied] = useState(false);

  const shadcnCss = useMemo(
    () => themeStylesToCss(theme, { radius, format }),
    [theme, radius, format],
  );
  const json = useMemo(
    () => themeStylesToJson(theme, { radius, format }),
    [theme, radius, format],
  );
  const twCss = useMemo(
    () => (tailwindCss ? tailwindCss(format) : ""),
    [tailwindCss, format],
  );
  const css = tab === "tailwind" ? twCss : tab === "json" ? json : shadcnCss;

  const figma = useMemo(() => (figmaSvg ? figmaSvg() : ""), [figmaSvg]);

  const copy = async () => {
    try {
      const text = tab === "figma" ? figma : css;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (tab === "figma") {
        toast.success("SVG copied — paste into Figma");
      } else {
        toast.success("Copied to clipboard");
      }
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  return (
    <Dialog>
      <DialogTrigger className="ov-btn ov-btn-primary">
        <CodeIcon weight="bold" className="size-3.5" />
        Code
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="tl-overlay w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        style={{ borderColor: "var(--ov-border)" }}
      >
        <DialogHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-[var(--ov-border)] p-4">
          <div className="text-left">
            <DialogTitle className="text-sm">Theme code</DialogTitle>
            <DialogDescription className="text-xs">
              {tab === "figma"
                ? "SVG color scales for Figma — paste directly into your file."
                : "Tailwind v4 — paste into your globals.css."}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList>
                <TabsTrigger value="shadcn">shadcn</TabsTrigger>
                <TabsTrigger value="json">json</TabsTrigger>
                {tailwindCss && <TabsTrigger value="tailwind">tailwind</TabsTrigger>}
                {figmaSvg && <TabsTrigger value="figma">figma</TabsTrigger>}
              </TabsList>
            </Tabs>
            {tab !== "figma" && (
              <Select value={format} onValueChange={(v) => v && setFormat(v as ColorFormat)}>
                <SelectTrigger size="sm" className="w-28 uppercase">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="tl-overlay">
                  {COLOR_FORMATS.map((f) => (
                    <SelectItem key={f} value={f} className="uppercase">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <button type="button" className="ov-btn" onClick={copy}>
              {copied ? <CheckIcon weight="bold" className="size-3.5" /> : <CopyIcon weight="bold" className="size-3.5" />}
              {copied ? "Copied" : tab === "figma" ? "Copy SVG" : "Copy"}
            </button>
            <DialogClose className="ov-btn px-2" aria-label="Close">
              <XIcon weight="bold" className="size-3.5" />
            </DialogClose>
          </div>
        </DialogHeader>
        {tab === "figma" ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-4 overflow-auto bg-[var(--ov-bg)] p-6">
            <div className="w-full max-w-[980px]">
              <div className="mb-2 text-center text-[10px] text-[var(--ov-text-dim)]">
                White canvas with solid + alpha rows. Layer names are set via ids. Paste into Figma, then create color styles / variables from the rectangles.
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
            <button type="button" className="ov-btn" onClick={copy}>
              {copied ? <CheckIcon weight="bold" className="size-3.5" /> : <CopyIcon weight="bold" className="size-3.5" />}
              {copied ? "Copied" : "Copy SVG for Figma"}
            </button>
          </div>
        ) : (
          <ScrollArea className="h-[60vh]">
            <pre className="p-4 text-xs leading-relaxed text-[var(--ov-text)]">
              <code>{css}</code>
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

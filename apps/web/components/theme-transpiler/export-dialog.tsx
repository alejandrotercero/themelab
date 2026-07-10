"use client";

// "Code" export dialog: shows the generated theme CSS in a code block with a
// color-format selector and copy button. When `tailwindCss` is provided (the
// /create tool), a second tab shows the Tailwind 50–950 @theme scales.
//
// Presentational pattern adapted from tweakcn (https://github.com/jnsahaj/tweakcn),
// Apache-2.0 — components/editor/code-panel.tsx (fed by our own generator, no
// zustand/syntax-highlighter deps). See apps/web/NOTICE.

import { useMemo, useState } from "react";
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
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
import {
  COLOR_FORMATS,
  createInstallCommand,
  themeStylesToCss,
  themeStylesToDesignMd,
  themeStylesToJson,
  type ColorFormat,
} from "@/lib/theme-engine";
import { downloadTextFile } from "@/lib/download";

type Tab = "shadcn" | "json" | "tailwind" | "design" | "install" | "figma";

interface ExportDialogProps {
  theme: ThemeStyles;
  /** Current source or saved-theme display name. */
  name: string;
  /** Radius CSS value, e.g. "0.625rem". */
  radius: string;
  /** Optional Tailwind-scale generator; when set, a third tab is shown. */
  tailwindCss?: (format: ColorFormat) => string;
  /** Optional Figma SVG generator (used by /create). When set, a "figma" tab appears. */
  figmaSvg?: () => string;
}

export function ExportDialog({ theme, name, radius, tailwindCss, figmaSvg }: ExportDialogProps) {
  const [format, setFormat] = useState<ColorFormat>("oklch");
  const [tab, setTab] = useState<Tab>("shadcn");
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

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
  const figma = useMemo(() => (figmaSvg ? figmaSvg() : ""), [figmaSvg]);
  const designMd = useMemo(
    () => themeStylesToDesignMd(theme, { name, radius, format }),
    [theme, name, radius, format],
  );
  const install = useMemo(() => {
    if (!origin) return { command: "", error: "" };
    try {
      return {
        command: createInstallCommand({ name, radius, theme }, origin),
        error: "",
      };
    } catch (error) {
      return {
        command: "",
        error: error instanceof Error ? error.message : "This theme cannot be encoded yet.",
      };
    }
  }, [name, origin, radius, theme]);
  const content =
    tab === "figma"
      ? figma
      : tab === "install"
        ? install.command
        : tab === "design"
          ? designMd
          : tab === "tailwind"
            ? twCss
            : tab === "json"
              ? json
              : shadcnCss;
  const supportsFormat = tab !== "figma" && tab !== "install";

  const copy = async () => {
    try {
      if (!content) return;
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (tab === "figma") {
        toast.success("SVG copied — paste into Figma");
      } else if (tab === "install") {
        toast.success("Install command copied");
      } else if (tab === "design") {
        toast.success("DESIGN.md copied");
      } else {
        toast.success("Copied to clipboard");
      }
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  const description =
    tab === "figma"
      ? "SVG color scales for Figma — paste directly into your file."
      : tab === "design"
        ? "A portable, factual design contract using Google's alpha DESIGN.md format."
        : tab === "install"
          ? "Install both CSS modes and the accompanying design contract with shadcn."
          : tab === "json"
            ? "Light and dark theme values as portable JSON."
            : "Tailwind v4 — paste into your globals.css.";

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
            <DialogDescription className="text-xs">{description}</DialogDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as Tab)}
              className="min-w-0 max-w-full"
            >
              <TabsList className="max-w-full justify-start overflow-x-auto">
                <TabsTrigger value="shadcn">shadcn</TabsTrigger>
                <TabsTrigger value="json">json</TabsTrigger>
                {tailwindCss && <TabsTrigger value="tailwind">tailwind</TabsTrigger>}
                <TabsTrigger value="design">DESIGN.md</TabsTrigger>
                <TabsTrigger value="install">install</TabsTrigger>
                {figmaSvg && <TabsTrigger value="figma">figma</TabsTrigger>}
              </TabsList>
            </Tabs>
            {supportsFormat && (
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
            {tab === "design" && (
              <button
                type="button"
                className="ov-btn"
                onClick={() => {
                  downloadTextFile(designMd, "DESIGN.md", "text/markdown");
                  toast.success("DESIGN.md downloaded");
                }}
              >
                <DownloadSimpleIcon weight="bold" className="size-3.5" />
                Download
              </button>
            )}
            <button type="button" className="ov-btn" onClick={copy} disabled={!content}>
              {copied ? <CheckIcon weight="bold" className="size-3.5" /> : <CopyIcon weight="bold" className="size-3.5" />}
              {copied
                ? "Copied"
                : tab === "figma"
                  ? "Copy SVG"
                  : tab === "install"
                    ? "Copy command"
                    : "Copy"}
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
        ) : tab === "install" ? (
          <div className="flex min-h-72 flex-col justify-center gap-5 bg-[var(--ov-bg)] p-6">
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ov-text-ghost)]">
                One-command install
              </p>
              <div className="rounded-[var(--ov-radius-sm)] border border-[var(--ov-border)] bg-[var(--ov-surface-2)] p-4">
                {install.error ? (
                  <p className="text-sm text-[var(--ov-danger)]">{install.error}</p>
                ) : (
                  <code className="break-all text-xs leading-relaxed text-[var(--ov-text)]">
                    {install.command || "Preparing install command…"}
                  </code>
                )}
              </div>
            </div>
            <p className="max-w-2xl text-xs leading-relaxed text-[var(--ov-text-dim)]">
              shadcn writes the complete light and dark CSS variable sets, the base radius, and a root
              <code className="mx-1 text-[var(--ov-text)]">DESIGN.md</code>
              that records the same design contract. If that file already exists, the CLI keeps its normal conflict prompt.
            </p>
            <button type="button" className="ov-btn ov-btn-primary w-fit" onClick={copy} disabled={!install.command}>
              <CopyIcon weight="bold" className="size-3.5" />
              Copy install command
            </button>
          </div>
        ) : (
          <ScrollArea className="h-[60vh]">
            <pre className="p-4 text-xs leading-relaxed text-[var(--ov-text)]">
              <code>{content}</code>
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

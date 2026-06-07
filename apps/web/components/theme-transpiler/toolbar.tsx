"use client";

// Slim top bar: logo + title, and the Code export dialog. (Light/dark + radius
// live in the editor; "apply to page" lives by the input.)

import type { ReactNode } from "react";
import type { ThemeStyles } from "@themelab/shared";
import type { ColorFormat } from "@/lib/theme-engine";
import { ExportDialog } from "./export-dialog";
import { Logo } from "./logo";

interface ToolbarProps {
  theme: ThemeStyles;
  radius: string;
  title?: string;
  /** Tailwind-scale generator — when set, the Code dialog gains a second tab. */
  tailwindCss?: (format: ColorFormat) => string;
  /** Figma SVG generator — when set, a "figma" tab appears in the export dialog (used by /create). */
  figmaSvg?: () => string;
  /** Extra controls rendered before the Code button (e.g. the /edit Import dialog). */
  extra?: ReactNode;
  /** When provided, the logo/title becomes a button (e.g. to reopen the intro). */
  onShowIntro?: () => void;
}

export function Toolbar({ theme, radius, title = "100r → shadcn", tailwindCss, figmaSvg, extra, onShowIntro }: ToolbarProps) {
  const brand = (
    <>
      <Logo className="h-3.5" />
      <span className="text-[var(--ov-text-ghost)]">/</span>
      <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
    </>
  );

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--ov-border)] px-4 py-2.5">
      {onShowIntro ? (
        <button
          type="button"
          onClick={onShowIntro}
          title="About 100r themes"
          className="flex items-center gap-2.5 text-[var(--ov-text)]"
        >
          {brand}
        </button>
      ) : (
        <div className="flex items-center gap-2.5 text-[var(--ov-text)]">{brand}</div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {extra}
        <ExportDialog theme={theme} radius={radius} tailwindCss={tailwindCss} figmaSvg={figmaSvg} />
      </div>
    </header>
  );
}

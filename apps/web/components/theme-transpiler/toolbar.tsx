"use client";

// Slim top bar: logo + title, and the Code export dialog. (Light/dark + radius
// live in the editor; "apply to page" lives by the input.)

import type { ThemeStyles } from "@themelab/shared";
import type { ColorFormat } from "@/lib/theme-engine";
import { ExportDialog } from "./export-dialog";
import { Logo } from "./logo";

interface ToolbarProps {
  theme: ThemeStyles;
  radius: string;
  mode: "light" | "dark";
  title?: string;
  /** Tailwind-scale generator — when set, the Code dialog gains a second tab. */
  tailwindCss?: (format: ColorFormat) => string;
  /** When provided, the logo/title becomes a button (e.g. to reopen the intro). */
  onShowIntro?: () => void;
}

export function Toolbar({ theme, radius, mode, title = "100r → shadcn", tailwindCss, onShowIntro }: ToolbarProps) {
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

      <div className="ml-auto">
        <ExportDialog theme={theme} radius={radius} mode={mode} tailwindCss={tailwindCss} />
      </div>
    </header>
  );
}

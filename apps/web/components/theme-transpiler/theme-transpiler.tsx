"use client";

// /100r — transpile a 9-color Hundred Rabbits SVG into a shadcn theme. Shared
// editor state (overrides, mode, radius, apply-to-page) lives in useThemeEditor;
// this island adds the HR input, the luminance grader, and the intro dialog.

import { useEffect, useState } from "react";
import {
  analyze,
  hrToThemeStyles,
  HR_SLOTS,
  parseHrSvg,
  PRESETS,
  type HrTheme,
  type LuminanceReport,
} from "@/lib/theme-engine";
import { Toaster } from "@/components/ui/sonner";
import { useThemeEditor } from "./use-theme-editor";
import { EditorShell } from "./editor-shell";
import { Toolbar } from "./toolbar";
import { LibraryControls } from "./library-controls";
import { IntroDialog } from "./intro-dialog";
import { HrInput } from "./hr-input";
import { ValidationReadout } from "./validation-readout";

export function ThemeTranspiler() {
  const editor = useThemeEditor();
  const [report, setReport] = useState<LuminanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(false);

  const load = (theme: HrTheme, source: string) => {
    const rep = analyze(theme);
    const swatches = HR_SLOTS.flatMap((slot) => {
      const hex = theme.slots[slot];
      return hex ? [{ slot, hex }] : [];
    });
    editor.loadBase(hrToThemeStyles(theme), { source, swatches, mode: rep.nativeMode });
    setReport(rep);
    setError(null);
  };

  // Seed with a preset so the page is never empty.
  useEffect(() => {
    try {
      const preset = PRESETS[1]; // Ablaze (the tested coral theme)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time seed on mount; load calls editor.loadBase + setReport/setError
      load(parseHrSvg(preset.svg), preset.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preset.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the intro on first visit (remembered so it doesn't nag on every load).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: one-time check of localStorage on mount to show intro dialog
      if (!localStorage.getItem("tl-intro-seen")) setIntroOpen(true);
    } catch {
      setIntroOpen(true);
    }
  }, []);

  const handleIntro = (open: boolean) => {
    setIntroOpen(open);
    if (!open) {
      try {
        localStorage.setItem("tl-intro-seen", "1");
      } catch {
        // ignore — private mode etc.
      }
    }
  };

  return (
    <EditorShell
      editor={editor}
      toolbar={
        <Toolbar
          theme={editor.theme}
          radius={editor.radius}
          onShowIntro={() => setIntroOpen(true)}
          extra={<LibraryControls editor={editor} />}
        />
      }
      input={
        <>
          <HrInput onLoad={load} onError={setError} />
          {error && <p className="text-xs text-[var(--ov-danger)]">{error}</p>}
        </>
      }
      output={report ? <ValidationReadout report={report} /> : null}
    >
      <IntroDialog open={introOpen} onOpenChange={handleIntro} />
      <Toaster />
    </EditorShell>
  );
}

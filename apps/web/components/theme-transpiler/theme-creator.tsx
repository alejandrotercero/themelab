"use client";

// /create — generate a full shadcn theme + matching scales from a palette.
// Two algorithms, toggled by the user:
//   • "ThemeLab" (default) — our OKLCH synthesis from a primary + neutral.
//   • "Radix" — the real generateRadixColors: accent + grey + a background per
//     mode (set in a modal), 12-step scales mapped onto the tokens.
// Each algorithm fills both the theme and the scales, kept in sync.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThemeStyles } from "@themelab/shared";
import {
  oklchToHex,
  paletteToScales,
  paletteToThemeStyles,
  radixScales,
  radixThemeStyles,
  scaleToCss,
  toOklch,
  type ColorFormat,
  type RadixInputs,
  type Scale,
} from "@/lib/theme-engine";
import { Toaster } from "@/components/ui/sonner";
import { useThemeEditor } from "./use-theme-editor";
import { EditorShell } from "./editor-shell";
import { Toolbar } from "./toolbar";
import { PaletteInput } from "./palette-input";
import { ScaleView } from "./scale-view";
import { RadixConfigDialog } from "./radix-config-dialog";

const DEFAULT_PRIMARY = "#3b82f6";
const DEFAULT_NEUTRAL = "#71717a";
const DEFAULT_RADIX: RadixInputs = {
  light: { accent: "#3b82f6", gray: "#8b8d98", bg: "#ffffff" },
  dark: { accent: "#3b82f6", gray: "#8b8d98", bg: "#111111" },
};

type Algo = "themelab" | "radix";

type Gen =
  | { algo: "themelab"; primary: string; neutral: string }
  | ({ algo: "radix" } & RadixInputs);

const toHex = (value: string) => {
  const o = toOklch(value);
  return o ? oklchToHex(o) : value;
};
const scaleSwatches = (name: string, scale: Scale) =>
  scale.map((s) => ({ slot: `${name}-${s.stop}`, hex: toHex(s.value) }));

export function ThemeCreator() {
  const editor = useThemeEditor();
  const [algo, setAlgo] = useState<Algo>("themelab");
  const [primary, setPrimary] = useState(DEFAULT_PRIMARY);
  const [neutral, setNeutral] = useState(DEFAULT_NEUTRAL);
  const [radix, setRadix] = useState<RadixInputs>(DEFAULT_RADIX);
  const [radixOpen, setRadixOpen] = useState(false);
  const [gen, setGen] = useState<Gen>({ algo: "themelab", primary: DEFAULT_PRIMARY, neutral: DEFAULT_NEUTRAL });

  const generateThemeLab = useCallback(
    (p: string, n: string) => {
      const theme: ThemeStyles = paletteToThemeStyles(p, n);
      editor.loadBase(theme, { source: "ThemeLab palette", swatches: [] });
      setGen({ algo: "themelab", primary: p, neutral: n });
    },
    [editor],
  );

  const generateRadix = useCallback(
    (rc: RadixInputs) => {
      const theme = radixThemeStyles(rc);
      editor.loadBase(theme, { source: "Radix palette", swatches: [] });
      setGen({ algo: "radix", ...rc });
    },
    [editor],
  );

  // Generate once on mount (default algorithm = ThemeLab).
  useEffect(() => {
    generateThemeLab(DEFAULT_PRIMARY, DEFAULT_NEUTRAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeAlgo = (a: Algo) => {
    setAlgo(a);
    if (a === "themelab") generateThemeLab(primary, neutral);
    else generateRadix(radix);
  };

  // Scales for the active mode (Radix scales are appearance-specific).
  const scales = useMemo(() => {
    if (gen.algo === "themelab") return paletteToScales(gen.primary, gen.neutral);
    const c = editor.mode === "light" ? gen.light : gen.dark;
    return radixScales({ accent: c.accent, gray: c.gray, background: c.bg, appearance: editor.mode });
  }, [gen, editor.mode]);

  // Keep the token-override palette in sync with the shown scales.
  useEffect(() => {
    editor.setSwatches([...scaleSwatches("primary", scales.primary), ...scaleSwatches("neutral", scales.neutral)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scales]);

  const tailwindCss = useCallback(
    (format: ColorFormat) => scaleToCss({ primary: scales.primary, neutral: scales.neutral }, format),
    [scales],
  );

  return (
    <EditorShell
      editor={editor}
      toolbar={<Toolbar theme={editor.theme} radius={editor.radius} title="create" tailwindCss={tailwindCss} />}
      input={
        <div className="flex flex-col gap-2">
          {algo === "themelab" ? (
            <PaletteInput
              primary={primary}
              neutral={neutral}
              onPrimary={setPrimary}
              onNeutral={setNeutral}
              onGenerate={() => generateThemeLab(primary, neutral)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {([
                ["accent", radix[editor.mode].accent],
                ["neutral", radix[editor.mode].gray],
                [`${editor.mode} bg`, radix[editor.mode].bg],
              ] as const).map(([label, hex]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span
                    className="size-[18px] shrink-0 rounded-[var(--ov-radius-xs)] border border-[var(--ov-border)]"
                    style={{ backgroundColor: hex }}
                    title={`${label}: ${hex}`}
                  />
                  <span className="text-[11px] text-[var(--ov-text-dim)]">{label}</span>
                </div>
              ))}
              <button type="button" className="ov-btn" onClick={() => setRadixOpen(true)}>
                Edit colors
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--ov-text-ghost)]">Algorithm</span>
            <div className="ov-seg" role="tablist" aria-label="Generation algorithm">
              <button
                type="button"
                role="tab"
                aria-selected={algo === "themelab"}
                data-active={algo === "themelab"}
                className="ov-seg-btn"
                title="Our original OKLCH synthesis"
                onClick={() => changeAlgo("themelab")}
              >
                ThemeLab
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={algo === "radix"}
                data-active={algo === "radix"}
                className="ov-seg-btn"
                title="Radix's real generateRadixColors"
                onClick={() => changeAlgo("radix")}
              >
                Radix
              </button>
            </div>
          </div>
        </div>
      }
      output={
        <ScaleView
          scales={[
            { name: "primary", scale: scales.primary },
            { name: "neutral", scale: scales.neutral },
          ]}
        />
      }
    >
      <RadixConfigDialog
        open={radixOpen}
        onOpenChange={setRadixOpen}
        values={radix}
        onChange={setRadix}
        onGenerate={() => generateRadix(radix)}
      />
      <Toaster />
    </EditorShell>
  );
}

// Tailwind-style 50→950 color scales from a single anchor color, in OKLCH.
// A fixed perceptual lightness curve per stop, times a chroma curve that peaks
// mid-scale (500–600), in the anchor's hue. `neutral` clamps chroma so grays
// stay gray (carrying only the input's subtle temperature).

import type { ThemeStyles } from "@themelab/shared";
import { oklchCss, reformat, toOklch, type ColorFormat } from "./oklch";

export const TAILWIND_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

// Lightness per stop (OKLCH L, 0–1) — Tailwind-like curve, light → dark.
export const STOP_LIGHTNESS = [0.971, 0.936, 0.885, 0.808, 0.704, 0.637, 0.577, 0.505, 0.444, 0.396, 0.262];
// Fraction of the anchor's chroma per stop — peaks at 500/600, tapers at ends.
const CHROMA_CURVE = [0.18, 0.32, 0.55, 0.78, 0.92, 1.0, 1.0, 0.94, 0.84, 0.74, 0.55];

export interface ScaleStop {
  stop: number;
  /** `oklch(...)` string. */
  value: string;
}

export type Scale = ScaleStop[];

export function buildScale(anchor: string, opts: { neutral?: boolean } = {}): Scale {
  const o = toOklch(anchor) ?? { mode: "oklch" as const, l: 0.6, c: 0, h: 0 };
  // Neutrals keep a whisper of the input's chroma; chromatics use it in full.
  const peak = opts.neutral ? Math.min(o.c, 0.02) : Math.max(o.c, 0.04);
  const hue = o.h ?? 0;

  return TAILWIND_STOPS.map((stop, i) => ({
    stop,
    value: oklchCss({ mode: "oklch", l: STOP_LIGHTNESS[i], c: peak * CHROMA_CURVE[i], h: hue }),
  }));
}

// Standard shadcn destructive reds (scales carry no red of their own).
const RED_LIGHT = "oklch(0.577 0.245 27.325)";
const RED_DARK = "oklch(0.704 0.191 22.216)";

const at = (scale: Scale, stop: number) => scale.find((s) => s.stop === stop)?.value ?? "oklch(0 0 0)";

/**
 * Map a primary + neutral Tailwind scale onto the 31 shadcn tokens (light + dark)
 * — so the generated theme IS the scale: every token is an exact scale stop.
 */
export function scalesToThemeStyles(primary: Scale, neutral: Scale): ThemeStyles {
  const p = (stop: number) => at(primary, stop);
  const n = (stop: number) => at(neutral, stop);
  return {
    light: {
      background: n(50), foreground: n(950),
      card: n(50), "card-foreground": n(950),
      popover: n(50), "popover-foreground": n(950),
      primary: p(600), "primary-foreground": n(50),
      secondary: n(100), "secondary-foreground": n(900),
      muted: n(100), "muted-foreground": n(500),
      accent: n(100), "accent-foreground": n(900),
      destructive: RED_LIGHT, "destructive-foreground": n(50),
      border: n(200), input: n(200), ring: p(500),
      "chart-1": p(500), "chart-2": p(400), "chart-3": p(600), "chart-4": p(300), "chart-5": p(700),
      sidebar: n(50), "sidebar-foreground": n(950),
      "sidebar-primary": p(600), "sidebar-primary-foreground": n(50),
      "sidebar-accent": n(100), "sidebar-accent-foreground": n(900),
      "sidebar-border": n(200), "sidebar-ring": p(500),
    },
    dark: {
      background: n(950), foreground: n(50),
      card: n(900), "card-foreground": n(50),
      popover: n(900), "popover-foreground": n(50),
      primary: p(500), "primary-foreground": n(950),
      secondary: n(800), "secondary-foreground": n(50),
      muted: n(800), "muted-foreground": n(400),
      accent: n(800), "accent-foreground": n(50),
      destructive: RED_DARK, "destructive-foreground": n(50),
      border: n(800), input: n(800), ring: p(500),
      "chart-1": p(500), "chart-2": p(400), "chart-3": p(600), "chart-4": p(300), "chart-5": p(700),
      sidebar: n(900), "sidebar-foreground": n(50),
      "sidebar-primary": p(500), "sidebar-primary-foreground": n(950),
      "sidebar-accent": n(800), "sidebar-accent-foreground": n(50),
      "sidebar-border": n(800), "sidebar-ring": p(500),
    },
  };
}

/** A Tailwind v4 `@theme` block of `--color-<name>-<stop>` vars for each scale. */
export function scaleToCss(scales: Record<string, Scale>, format: ColorFormat = "oklch"): string {
  const lines: string[] = ["@theme {"];
  for (const [name, scale] of Object.entries(scales)) {
    for (const { stop, value } of scale) {
      lines.push(`  --color-${name}-${stop}: ${reformat(value, format)};`);
    }
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  lines.push("}");
  return lines.join("\n");
}

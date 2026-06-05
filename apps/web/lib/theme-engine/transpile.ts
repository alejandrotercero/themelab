// The transpiler: 9 HR colors → the full shadcn 31-token theme for BOTH modes.
// Neutrals are sampled from a lightness ramp built out of the HR slots; the
// single most-chromatic slot becomes the accent (primary/ring/charts). The
// theme's native mode is mapped from real colors; the other mode is synthesized
// by sampling the same ramp at mirrored lightness targets (per 100r.md).

import type { ThemeStyles } from "@themelab/shared";
import { lerpOklch, oklchCss, rotateHue, sampleRamp, scaleChroma, toOklch, withL } from "./oklch";
import { STOP_LIGHTNESS, TAILWIND_STOPS, type Scale } from "./scale";
import { analyze } from "./validate";
import type { HrTheme } from "./types";
import type { Oklch } from "culori";

/** Neutral ramp anchors (lightness) shared by the synth theme + synth scales. */
const NEUTRAL_ANCHORS = [0.13, 0.32, 0.5, 0.72, 0.92];

/** Canonical token order — mirrors apps/web/app/globals.css. */
export const THEME_TOKENS = [
  "background", "foreground",
  "card", "card-foreground",
  "popover", "popover-foreground",
  "primary", "primary-foreground",
  "secondary", "secondary-foreground",
  "muted", "muted-foreground",
  "accent", "accent-foreground",
  "destructive", "destructive-foreground",
  "border", "input", "ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
  "sidebar", "sidebar-foreground",
  "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground",
  "sidebar-border", "sidebar-ring",
] as const;

// Standard shadcn destructive reds — used when the theme has no warm accent.
const RED_DARK: Oklch = { mode: "oklch", l: 0.704, c: 0.191, h: 22.216 };
const RED_LIGHT: Oklch = { mode: "oklch", l: 0.577, c: 0.245, h: 27.325 };

/**
 * Build a full shadcn theme from just a primary + neutral color (Radix-custom
 * style). We spread the neutral across a lightness ramp and feed it through the
 * same per-mode mapping the HR path uses, with the primary as the accent. Both
 * light and dark are fully synthesized.
 */
export function paletteToThemeStyles(primary: string, neutral: string): ThemeStyles {
  const accent = toOklch(primary) ?? { mode: "oklch", l: 0.6, c: 0.15, h: 250 };
  const n = toOklch(neutral) ?? { mode: "oklch", l: 0.5, c: 0, h: 0 };
  // A few neutral anchors so chroma can taper naturally toward the extremes.
  const ramp = NEUTRAL_ANCHORS.map((l) => withL(n, l));
  return {
    light: buildMode("light", { ramp, accent, bg: null, fHigh: null, isNative: false }),
    dark: buildMode("dark", { ramp, accent, bg: null, fHigh: null, isNative: false }),
  };
}

/**
 * Tailwind-style scales built the SYNTHETIC way — sampling the same neutral ramp
 * and accent the synth theme uses, so the synth theme and its scales stay in
 * sync (neutrals are the very colors the theme reads).
 */
export function paletteToScales(primary: string, neutral: string): { primary: Scale; neutral: Scale } {
  const accent = toOklch(primary) ?? { mode: "oklch", l: 0.6, c: 0.15, h: 250 };
  const n = toOklch(neutral) ?? { mode: "oklch", l: 0.5, c: 0, h: 0 };
  const ramp = NEUTRAL_ANCHORS.map((l) => withL(n, l));
  return {
    primary: TAILWIND_STOPS.map((stop, i) => ({ stop, value: oklchCss(withL(accent, STOP_LIGHTNESS[i])) })),
    neutral: TAILWIND_STOPS.map((stop, i) => ({ stop, value: oklchCss(sampleRamp(ramp, STOP_LIGHTNESS[i])) })),
  };
}

export function hrToThemeStyles(theme: HrTheme): ThemeStyles {
  const { nativeMode } = analyze(theme);
  const colors = collect(theme);
  const accent = pickAccent(colors);
  // Neutral ramp = every low-chroma slot. Filter by chroma (not object identity)
  // so a theme that repeats its accent across slots doesn't tint the neutrals.
  const threshold = Math.max(0.04, accent.c * 0.5);
  const neutral = colors.filter((c) => c.c < threshold);
  const ramp = neutral.length >= 2 ? neutral : colors.filter((c) => c.c < accent.c);

  const bg = theme.slots.background ? toOklch(theme.slots.background) : null;
  const fHigh = theme.slots.f_high ? toOklch(theme.slots.f_high) : null;

  return {
    light: buildMode("light", { ramp, accent, bg, fHigh, isNative: nativeMode === "light" }),
    dark: buildMode("dark", { ramp, accent, bg, fHigh, isNative: nativeMode === "dark" }),
  };
}

interface ModeCtx {
  ramp: Oklch[];
  accent: Oklch;
  bg: Oklch | null;
  fHigh: Oklch | null;
  isNative: boolean;
}

function buildMode(mode: "light" | "dark", ctx: ModeCtx): Record<string, string> {
  const { ramp, accent, bg, fHigh, isNative } = ctx;
  const dark = mode === "dark";

  // Background & foreground: use real HR colors in the native mode, else synth.
  const background = isNative && bg ? bg : sampleRamp(ramp, dark ? 0.16 : 0.99);
  const foreground = isNative && fHigh ? fHigh : sampleRamp(ramp, dark ? 0.96 : 0.18);
  const bgL = background.l;

  // Neutral surfaces, stepped off the background lightness.
  const card = sampleRamp(ramp, dark ? bgL + 0.035 : 1);
  const secondary = sampleRamp(ramp, dark ? bgL + 0.09 : 0.96);
  const border = sampleRamp(ramp, dark ? bgL + 0.13 : 0.9);
  const mutedFg = sampleRamp(ramp, dark ? 0.64 : 0.5);

  // Accent → primary. Keep the hue/chroma; retarget lightness for the mode so it
  // pops on the background, then choose a contrasting foreground.
  const primary = retargetAccent(accent, dark);
  const primaryFg = contrastFg(primary, ramp);
  const destructive = pickDestructive(accent, dark);

  const v = (o: Oklch) => oklchCss(o);

  return {
    background: v(background),
    foreground: v(foreground),
    card: v(card),
    "card-foreground": v(foreground),
    popover: v(card),
    "popover-foreground": v(foreground),
    primary: v(primary),
    "primary-foreground": v(primaryFg),
    secondary: v(secondary),
    "secondary-foreground": v(foreground),
    muted: v(secondary),
    "muted-foreground": v(mutedFg),
    accent: v(secondary),
    "accent-foreground": v(foreground),
    destructive: v(destructive),
    "destructive-foreground": v(contrastFg(destructive, ramp)),
    border: v(border),
    input: v(border),
    ring: v(primary),
    ...chartVars(accent, dark),
    sidebar: v(sampleRamp(ramp, dark ? bgL + 0.015 : 0.985)),
    "sidebar-foreground": v(foreground),
    "sidebar-primary": v(primary),
    "sidebar-primary-foreground": v(primaryFg),
    "sidebar-accent": v(secondary),
    "sidebar-accent-foreground": v(foreground),
    "sidebar-border": v(border),
    "sidebar-ring": v(primary),
  };
}

/** All present slots as OKLCH. */
function collect(theme: HrTheme): Oklch[] {
  return Object.values(theme.slots)
    .map((hex) => (hex ? toOklch(hex) : null))
    .filter((c): c is Oklch => c !== null);
}

/** Accent = the most chromatic slot (the theme's one color, typically b_inv). */
function pickAccent(colors: Oklch[]): Oklch {
  if (colors.length === 0) return { mode: "oklch", l: 0.6, c: 0, h: 0 };
  return colors.reduce((best, c) => (c.c > best.c ? c : best), colors[0]);
}

/** Move the accent to a mode-appropriate lightness so it reads as "primary". */
function retargetAccent(accent: Oklch, dark: boolean): Oklch {
  if (accent.c < 0.04) {
    // Grayscale theme: make primary a strong neutral instead of mid-gray.
    return withL(accent, dark ? 0.9 : 0.25);
  }
  const target = dark ? 0.68 : 0.58;
  // Only nudge toward target — keep the theme's own character if already close.
  return withL(accent, lerp(accent.l, target, 0.6));
}

/** Near-black or near-white (tinted by the ramp) for text on `bg`. */
function contrastFg(bg: Oklch, ramp: Oklch[]): Oklch {
  return bg.l > 0.62 ? sampleRamp(ramp, 0.16) : sampleRamp(ramp, 0.985);
}

/** Use the accent as destructive when it's a warm red/orange; else a real red. */
function pickDestructive(accent: Oklch, dark: boolean): Oklch {
  const h = accent.h ?? 0;
  const warm = accent.c > 0.08 && (h <= 45 || h >= 335);
  if (warm) return withL({ mode: "oklch", l: accent.l, c: Math.max(accent.c, 0.18), h: 25 }, dark ? 0.62 : 0.55);
  return dark ? RED_DARK : RED_LIGHT;
}

/** Five chart colors fanned out from the accent hue. */
function chartVars(accent: Oklch, dark: boolean): Record<string, string> {
  const baseL = dark ? 0.7 : 0.6;
  const c = Math.max(accent.c, 0.12);
  const rotations = [0, 40, 90, -55, 200];
  const out: Record<string, string> = {};
  rotations.forEach((deg, i) => {
    const col = rotateHue({ mode: "oklch", l: baseL - i * 0.03, c, h: accent.h ?? 0 }, deg);
    out[`chart-${i + 1}`] = oklchCss(col);
  });
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Re-export so the css/preview layers can reuse without re-importing culori paths.
export { scaleChroma, lerpOklch };

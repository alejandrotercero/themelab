// The transpiler: 9 HR colors → the full shadcn 31-token theme for BOTH modes.
// Neutrals are sampled from a lightness ramp built out of the HR slots; the
// single most-chromatic slot becomes the accent (primary/ring/charts). The
// theme's native mode is mapped from real colors; the other mode is synthesized
// by sampling the same ramp at mirrored lightness targets (per 100r.md).

import type { ThemeStyles } from "@themelab/shared";
import { contrastRatio, lerpOklch, oklchCss, rotateHue, sampleRamp, scaleChroma, toOklch, withL } from "./oklch";
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

/** A 6-color Mindful Palette: 2 light · 2 accent · 2 dark (all hex). */
export interface MindfulColors {
  /** Lightest soft neutral — the light-mode background. */
  light1: string;
  /** Second light neutral — light surface stepping. */
  light2: string;
  /** Primary brand accent — drives primary/ring/chart-1. */
  accent1: string;
  /** Secondary brand accent — drives accent/chart-2/sidebar-accent. */
  accent2: string;
  /** Darkest anchor — the dark-mode background / light-mode text. */
  dark1: string;
  /** Second dark anchor — dark surface stepping. */
  dark2: string;
}

// Fallbacks for unparseable input, mirroring the guards elsewhere in this file.
const FALLBACK_LIGHT: Oklch = { mode: "oklch", l: 0.95, c: 0, h: 0 };
const FALLBACK_DARK: Oklch = { mode: "oklch", l: 0.2, c: 0, h: 0 };
const FALLBACK_ACCENT: Oklch = { mode: "oklch", l: 0.6, c: 0.15, h: 250 };

// Mindful palettes rarely ship a true near-white or near-black, so a theme built
// from the raw colors reads washed-out (a "dark" navy at L*=35 is a medium tone,
// not a dark-mode background). We MEASURE each light/dark anchor's lightness and
// CORRECT the extremes — pushing the lightest toward near-white and the darkest
// toward a real dark background — while preserving hue + chroma.
const LIGHT_BG_TARGET = 0.985; // the lightest color, used as the light-mode bg
const DARK_BG_TARGET = 0.16; // the darkest color, used as the dark-mode bg
// Bands keeping the *secondary* light/dark from collapsing onto the extremes.
const LIGHT_MID_BAND: [number, number] = [0.9, 0.965];
const DARK_MID_BAND: [number, number] = [0.22, 0.34];
// "Good enough as-is" thresholds, surfaced by analyzeMindful for the readout.
const LIGHT_OK_MIN = 0.86;
const DARK_OK_MAX = 0.3;
const ACCENT_OK_C = 0.05;

const clampN = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface ResolvedMindful {
  lightBg: Oklch;
  darkBg: Oklch;
  lightMid: Oklch;
  darkMid: Oklch;
  accent1: Oklch;
  accent2: Oklch;
  /** Lightness (0–1) of the lightest light / darkest dark before correction. */
  lightestL: number;
  darkestL: number;
}

/** Parse the 6 colors and correct the light/dark extremes to true theme ends. */
function resolveMindful(c: MindfulColors): ResolvedMindful {
  const light1 = toOklch(c.light1) ?? FALLBACK_LIGHT;
  const light2 = toOklch(c.light2) ?? FALLBACK_LIGHT;
  const dark1 = toOklch(c.dark1) ?? FALLBACK_DARK;
  const dark2 = toOklch(c.dark2) ?? FALLBACK_DARK;

  // Order by lightness so we correct the true extremes, not just slot 1.
  const [lightLo, lightHi] = light1.l <= light2.l ? [light1, light2] : [light2, light1];
  const [darkLo, darkHi] = dark1.l <= dark2.l ? [dark1, dark2] : [dark2, dark1];

  return {
    lightBg: withL(lightHi, Math.max(lightHi.l, LIGHT_BG_TARGET)),
    darkBg: withL(darkLo, Math.min(darkLo.l, DARK_BG_TARGET)),
    lightMid: withL(lightLo, clampN(lightLo.l, LIGHT_MID_BAND[0], LIGHT_MID_BAND[1])),
    darkMid: withL(darkHi, clampN(darkHi.l, DARK_MID_BAND[0], DARK_MID_BAND[1])),
    accent1: toOklch(c.accent1) ?? FALLBACK_ACCENT,
    accent2: toOklch(c.accent2) ?? FALLBACK_ACCENT,
    lightestL: lightHi.l,
    darkestL: darkLo.l,
  };
}

/**
 * Build a full shadcn theme from a 6-color Mindful Palette (2 light · 2 accent ·
 * 2 dark) — the #MindfulPalettes format by Alex Cristache. The corrected light +
 * dark anchors supply the real background/foreground and a neutral ramp; accent-1
 * fills the primary roles (primary/ring/chart-1), accent-2 the secondary ones
 * (accent surface/chart-2/sidebar-accent). Reuses the same buildMode pipeline as
 * the HR + palette paths.
 */
export function mindfulToThemeStyles(c: MindfulColors): ThemeStyles {
  const r = resolveMindful(c);
  // Ramp from the 4 corrected surface anchors only — accents are excluded so they
  // never tint the neutrals. sampleRamp sorts internally, so order is moot.
  const ramp = [r.darkBg, r.darkMid, r.lightMid, r.lightBg];

  const build = (mode: "light" | "dark"): Record<string, string> => {
    const dark = mode === "dark";
    const out = buildMode(mode, {
      ramp,
      accent: r.accent1,
      bg: dark ? r.darkBg : r.lightBg,
      fHigh: dark ? r.lightBg : r.darkBg,
      isNative: true,
    });
    // Secondary accent → the accent surface, chart-2, and the sidebar accent.
    const a2 = retargetAccent(r.accent2, dark);
    out.accent = oklchCss(a2);
    out["accent-foreground"] = oklchCss(contrastFg(a2, ramp));
    out["chart-2"] = oklchCss(a2);
    out["sidebar-accent"] = out.accent;
    out["sidebar-accent-foreground"] = out["accent-foreground"];
    return out;
  };

  return { light: build("light"), dark: build("dark") };
}

/** One measured input color in the palette-check readout. */
export interface MindfulMeasure {
  role: string;
  hex: string;
  /** OKLCH lightness, L* × 100 (0–100). */
  lStar: number;
  /** OKLCH chroma. */
  chroma: number;
  /** Whether it meets its role's target without correction. */
  ok: boolean;
  /** Corrected L* (0–100) when an extreme was clamped to a true end, else null. */
  correctedL: number | null;
}

export interface MindfulReport {
  measures: MindfulMeasure[];
  /** WCAG contrast of body text on background, per mode (after correction). */
  contrast: { light: number; dark: number };
}

/**
 * Measure the 6 inputs (are the lights light enough, the darks dark enough, the
 * accents chromatic enough) and report the corrected light/dark extremes plus the
 * resulting text-on-background contrast. Drives the readout in the output pane.
 */
export function analyzeMindful(c: MindfulColors): MindfulReport {
  const r = resolveMindful(c);
  const entries: { role: string; hex: string; kind: "light" | "accent" | "dark" }[] = [
    { role: "light 1", hex: c.light1, kind: "light" },
    { role: "light 2", hex: c.light2, kind: "light" },
    { role: "accent 1", hex: c.accent1, kind: "accent" },
    { role: "accent 2", hex: c.accent2, kind: "accent" },
    { role: "dark 1", hex: c.dark1, kind: "dark" },
    { role: "dark 2", hex: c.dark2, kind: "dark" },
  ];

  const measures: MindfulMeasure[] = entries.map((e) => {
    const o = toOklch(e.hex) ?? FALLBACK_DARK;
    let ok = true;
    let correctedL: number | null = null;
    if (e.kind === "light") {
      ok = o.l >= LIGHT_OK_MIN;
      if (o.l === r.lightestL && o.l < LIGHT_BG_TARGET) correctedL = Math.round(LIGHT_BG_TARGET * 100);
    } else if (e.kind === "dark") {
      ok = o.l <= DARK_OK_MAX;
      if (o.l === r.darkestL && o.l > DARK_BG_TARGET) correctedL = Math.round(DARK_BG_TARGET * 100);
    } else {
      ok = (o.c ?? 0) >= ACCENT_OK_C;
    }
    return {
      role: e.role,
      hex: e.hex,
      lStar: Math.round(o.l * 100),
      chroma: Math.round((o.c ?? 0) * 1000) / 1000,
      ok,
      correctedL,
    };
  });

  const t = mindfulToThemeStyles(c);
  return {
    measures,
    contrast: {
      light: contrastRatio(t.light.foreground, t.light.background),
      dark: contrastRatio(t.dark.foreground, t.dark.background),
    },
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

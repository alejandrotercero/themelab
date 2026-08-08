import { converter, formatHex, parse } from "culori";
import { oklchToHex, toOklch as parseThemeColor } from "@themelab/theme-engine";

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export type ColorKind =
  | "hsl-triple"
  | "rgb-triple"
  | "hex"
  | "hsl"
  | "hsla"
  | "rgb"
  | "rgba"
  | "oklch"
  | "css";

const toRgb = converter("rgb");
const toHsl = converter("hsl");
const toOklch = converter("oklch");

const HSL_TRIPLE_RE =
  /^-?[\d.]+\s+[\d.]+%\s+[\d.]+%(?:\s*\/\s*[\d.]+%?)?$/;
const RGB_TRIPLE_RE = /^[\d.]+\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+%?)?$/;

export function detectColorKind(value: string): ColorKind | null {
  const v = value.trim();
  if (HSL_TRIPLE_RE.test(v)) return "hsl-triple";
  if (RGB_TRIPLE_RE.test(v)) return "rgb-triple";
  const lower = v.toLowerCase();
  if (lower.startsWith("#")) return "hex";
  if (lower.startsWith("hsla(")) return "hsla";
  if (lower.startsWith("hsl(")) return "hsl";
  if (lower.startsWith("rgba(")) return "rgba";
  if (lower.startsWith("rgb(")) return "rgb";
  if (lower.startsWith("oklch(")) return "oklch";
  return parse(v) ? "css" : null;
}

export function toRenderableCss(value: string): string | null {
  const kind = detectColorKind(value);
  if (!kind) return null;
  if (kind === "hsl-triple") return `hsl(${value.trim()})`;
  if (kind === "rgb-triple") return `rgb(${value.trim()})`;
  return value.trim();
}

export function toHex(value: string): string | null {
  const renderable = toRenderableCss(value);
  const color = renderable ? parseThemeColor(renderable) : null;
  return color ? oklchToHex(color) : null;
}

function fmt(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "0";
  return value % 1 === 0 ? String(value) : Number(value.toFixed(4)).toString();
}

export function serializeToKind(hex: string, kind: ColorKind): string {
  const color = parse(hex);
  if (!color) return hex;
  if (kind === "hsl-triple") {
    const c = toHsl(color);
    return `${fmt(c.h)} ${fmt((c.s ?? 0) * 100)}% ${fmt((c.l ?? 0) * 100)}%`;
  }
  if (kind === "rgb-triple") {
    const c = toRgb(color);
    return `${Math.round((c.r ?? 0) * 255)} ${Math.round((c.g ?? 0) * 255)} ${Math.round((c.b ?? 0) * 255)}`;
  }
  if (kind === "hsl" || kind === "hsla") {
    const c = toHsl(color);
    return `hsl(${fmt(c.h)} ${fmt((c.s ?? 0) * 100)}% ${fmt((c.l ?? 0) * 100)}%)`;
  }
  if (kind === "rgb" || kind === "rgba") {
    const c = toRgb(color);
    return `rgb(${Math.round((c.r ?? 0) * 255)} ${Math.round((c.g ?? 0) * 255)} ${Math.round((c.b ?? 0) * 255)})`;
  }
  if (kind === "oklch") {
    const c = toOklch(color);
    return `oklch(${fmt(c.l)} ${fmt(c.c)} ${fmt(c.h)})`;
  }
  return formatHex(color);
}

export function hexToHsv(hex: string): Hsv {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / delta + 2) * 60;
    else h = ((r - g) / delta + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = h / 360;
  const saturation = s / 100;
  const value = v / 100;
  const i = Math.floor(hue * 6);
  const f = hue * 6 - i;
  const p = value * (1 - saturation);
  const q = value * (1 - f * saturation);
  const t = value * (1 - (1 - f) * saturation);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0: r = value; g = t; b = p; break;
    case 1: r = q; g = value; b = p; break;
    case 2: r = p; g = value; b = t; break;
    case 3: r = p; g = q; b = value; break;
    case 4: r = t; g = p; b = value; break;
    case 5: r = value; g = p; b = q; break;
  }
  const byte = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const color = parse(hex);
  const value = color ? toHsl(color) : undefined;
  return { h: value?.h ?? 0, s: (value?.s ?? 0) * 100, l: (value?.l ?? 0) * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const color = parse(`hsl(${h} ${s}% ${l}%)`);
  return color ? formatHex(color) : "#000000";
}

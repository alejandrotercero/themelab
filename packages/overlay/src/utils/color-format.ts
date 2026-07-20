// packages/overlay/src/utils/color-format.ts
// Format-preserving color handling for Theme mode. Uses culori to parse/convert
// any CSS color, and adds the two shadcn channel-triple formats culori can't
// parse on its own (`24 100% 98.04%` consumed via hsl(var(--x)), and the rgb
// equivalent). Editing a token round-trips back into its original format so we
// never rewrite a project's `hsl`-triple theme as hex, etc.

import { parse, converter, formatHex } from "culori";
import type { Color } from "culori";

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

// `H S% L%` (+ optional `/ A`) — shadcn/Tailwind-v3 HSL channel triple.
const HSL_TRIPLE_RE =
  /^-?[\d.]+\s+[\d.]+%\s+[\d.]+%(?<alpha>\s*\/\s*[\d.]+%?)?$/;
// `R G B` (+ optional `/ A`) — three plain numbers, no units.
const RGB_TRIPLE_RE = /^[\d.]+\s+[\d.]+\s+[\d.]+(?<alpha>\s*\/\s*[\d.]+%?)?$/;

function fmt(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) {
    return "0";
  }
  return n % 1 === 0 ? String(n) : Number(n.toFixed(4)).toString();
}

/** Detect the format of a raw token value so edits can be written back in kind. */
export function detectColorKind(value: string): ColorKind | null {
  const v = value.trim();
  if (HSL_TRIPLE_RE.test(v)) {
    return "hsl-triple";
  }
  if (RGB_TRIPLE_RE.test(v)) {
    return "rgb-triple";
  }
  const lower = v.toLowerCase();
  if (lower.startsWith("#")) {
    return "hex";
  }
  if (lower.startsWith("hsla(")) {
    return "hsla";
  }
  if (lower.startsWith("hsl(")) {
    return "hsl";
  }
  if (lower.startsWith("rgba(")) {
    return "rgba";
  }
  if (lower.startsWith("rgb(")) {
    return "rgb";
  }
  if (lower.startsWith("oklch(")) {
    return "oklch";
  }
  // Anything else culori can parse (named, oklab, lab, color(), hwb…)
  return parse(v) ? "css" : null;
}

export function isColor(value: string): boolean {
  return detectColorKind(value) !== null;
}

/** Wrap channel-triples so the value is valid CSS for a swatch background. */
export function toRenderableCss(value: string): string | null {
  const kind = detectColorKind(value);
  if (!kind) {
    return null;
  }
  if (kind === "hsl-triple") {
    return `hsl(${value.trim()})`;
  }
  if (kind === "rgb-triple") {
    return `rgb(${value.trim()})`;
  }
  return value.trim();
}

function parseAny(value: string): Color | undefined {
  const renderable = toRenderableCss(value);
  return renderable ? parse(renderable) : undefined;
}

/** Normalize any token color to a hex string (for seeding the HSV picker). */
export function toHex(value: string): string | null {
  const color = parseAny(value);
  return color ? formatHex(color) : null;
}

function formatHslTriple(color: Color): string {
  const c = toHsl(color);
  return `${fmt(c.h)} ${fmt((c.s ?? 0) * 100)}% ${fmt((c.l ?? 0) * 100)}%`;
}

function formatRgbTriple(color: Color): string {
  const c = toRgb(color);
  return `${Math.round((c.r ?? 0) * 255)} ${Math.round((c.g ?? 0) * 255)} ${Math.round((c.b ?? 0) * 255)}`;
}

function formatHslFunction(color: Color): string {
  const c = toHsl(color);
  return `hsl(${fmt(c.h)} ${fmt((c.s ?? 0) * 100)}% ${fmt((c.l ?? 0) * 100)}%)`;
}

function formatRgbFunction(color: Color): string {
  const c = toRgb(color);
  return `rgb(${Math.round((c.r ?? 0) * 255)} ${Math.round((c.g ?? 0) * 255)} ${Math.round((c.b ?? 0) * 255)})`;
}

function formatOklchFunction(color: Color): string {
  const c = toOklch(color);
  return `oklch(${fmt(c.l)} ${fmt(c.c)} ${fmt(c.h)})`;
}

/** Serialize a hex color (from the picker) back into the token's original kind. */
export function serializeToKind(hex: string, kind: ColorKind): string {
  const color = parse(hex);
  if (!color) {
    return hex;
  }
  switch (kind) {
    case "hsl-triple": {
      return formatHslTriple(color);
    }
    case "rgb-triple": {
      return formatRgbTriple(color);
    }
    case "hsl":
    case "hsla": {
      return formatHslFunction(color);
    }
    case "rgb":
    case "rgba": {
      return formatRgbFunction(color);
    }
    case "oklch": {
      return formatOklchFunction(color);
    }
    default: {
      return formatHex(color);
    }
  }
}

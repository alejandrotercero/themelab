// Parse a pasted shadcn theme export into both modes. One shared parser so the
// overlay (paste-to-batch-update) and the web studio (/edit import) agree on the
// accepted formats — the studio's CSS export (`:root {…}` + `.dark {…}`) and its
// dual-mode JSON export (`{ "root": {…}, "dark": {…} }`).

import type { ThemeStyles } from "./types";

/** Token maps for both modes; keys are token names without the `--` prefix. */
export interface ParsedTheme {
  light: Record<string, string>;
  dark: Record<string, string>;
}

function stripPrefix(key: string): string {
  return key.startsWith("--") ? key.slice(2) : key;
}

/** Coerce an arbitrary object into a `{ token: value }` map of string values. */
function normalizeMap(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string") out[stripPrefix(k.trim())] = v.trim();
  }
  return out;
}

function parseJson(text: string): ParsedTheme | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;

  // Dual-mode shape: { root|light: {…}, dark: {…} } — our canonical export.
  const rootBlock = rec.root ?? rec.light ?? rec[":root"];
  const darkBlock = rec.dark ?? rec[".dark"];
  if (typeof rootBlock === "object" || typeof darkBlock === "object") {
    const light = normalizeMap(rootBlock);
    const dark = normalizeMap(darkBlock);
    if (!Object.keys(light).length && !Object.keys(dark).length) return null;
    return { light, dark };
  }

  // Flat single-mode object (a foreign/legacy export, mode unknown) — apply to
  // light; the consumer keeps the other mode as-is.
  const flat = normalizeMap(rec);
  return Object.keys(flat).length ? { light: flat, dark: {} } : null;
}

// A flat (non-nested) CSS rule: `selector { … }`. Our exports never nest, so a
// brace-free body is the right, simple shape to match.
const BLOCK_RE = /([^{}]+)\{([^{}]*)\}/g;
const VAR_RE = /--([\w-]+)\s*:\s*([^;]+);/g;

function parseCss(text: string): ParsedTheme | null {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};

  BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null = BLOCK_RE.exec(text);
  while (block !== null) {
    const selector = block[1].trim();
    // Skip at-rules (`@theme inline`, `@media`, …).
    if (!selector.includes("@")) {
      const isDark = /\.dark\b|\[data-[^\]]*dark/i.test(selector);
      const target = isDark ? dark : /:root\b/.test(selector) ? light : null;
      if (target) {
        const body = block[2];
        VAR_RE.lastIndex = 0;
        let v: RegExpExecArray | null = VAR_RE.exec(body);
        while (v !== null) {
          target[v[1].trim()] = v[2].trim();
          v = VAR_RE.exec(body);
        }
      }
    }
    block = BLOCK_RE.exec(text);
  }

  if (!Object.keys(light).length && !Object.keys(dark).length) return null;
  return { light, dark };
}

/**
 * Parse a pasted theme into both modes. Accepts the studio CSS export
 * (`:root {…}` + `.dark {…}`) or the dual-mode JSON export
 * (`{ "root": {…}, "dark": {…} }`). Returns null when nothing parseable is
 * found. Note: `ParsedTheme` is shaped exactly like {@link ThemeStyles}.
 */
export function parseThemeInput(input: string): ParsedTheme | null {
  const text = input.trim();
  if (!text) return null;
  return text.startsWith("{") ? parseJson(text) : parseCss(text);
}

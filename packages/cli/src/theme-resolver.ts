// packages/cli/src/theme-resolver.ts
// Reads a project's design-token theme (shadcn/Tailwind CSS variables) from its
// CSS, so the overlay can offer a tweakcn-style Theme editor. Tokens live in the
// theme CSS file's `:root {}` (light) and a dark selector block (`.dark {}` etc.).
//
// v1 supports class-based dark mode (`.dark`, `[data-theme="dark"]`) — shadcn's
// default. Media-query dark (`@media (prefers-color-scheme: dark)`) is not yet
// parsed and would otherwise leak its vars into light; see resolveTheme notes.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ThemeStyles, ThemeSource } from "@react-rewrite/shared";
import { findCssFiles } from "./tailwind-resolver.js";

export interface ResolvedTheme {
  theme: ThemeStyles;
  source: ThemeSource;
}

/** Parse `--name: value;` declarations from a flat CSS block body into name→value (no leading `--`). */
export function parseCssVarBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1].slice(2).trim()] = m[2].trim();
  }
  return out;
}

/**
 * Extract and merge the bodies of every flat `selector { ... }` block. `[^{}]`
 * keeps matching to a single (un-nested) block, so a `:root {}` nested inside
 * `@layer base { ... }` is still captured while the @layer's own braces are not.
 */
function mergeSelectorBlocks(css: string, selectorPattern: string): Record<string, string> {
  const re = new RegExp(`${selectorPattern}\\s*\\{([^{}]*)\\}`, "g");
  const merged: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    Object.assign(merged, parseCssVarBlock(m[1]));
  }
  return merged;
}

/** Candidate dark-mode selectors, in priority order. */
const DARK_SELECTORS: Array<{ selector: string; pattern: string }> = [
  { selector: ".dark", pattern: "\\.dark" },
  { selector: '[data-theme="dark"]', pattern: "\\[data-theme=['\"]?dark['\"]?\\]" },
];

/** Count `:root` custom properties in a CSS string — used to pick the theme file. */
function rootVarCount(css: string): number {
  return Object.keys(mergeSelectorBlocks(css, ":root")).length;
}

/** Prefer conventional theme filenames when scores tie. */
function fileNameRank(filePath: string): number {
  const base = path.basename(filePath).toLowerCase();
  if (base === "globals.css") return 3;
  if (base === "global.css" || base === "index.css" || base === "app.css") return 2;
  if (base.includes("global") || base.includes("theme")) return 1;
  return 0;
}

/**
 * Find the project's theme CSS file and parse its light/dark token blocks.
 * The theme file is the CSS file with the most `:root` custom properties
 * (ties broken by conventional filename). Returns null if no CSS file declares
 * any `:root` custom properties.
 */
export function resolveTheme(projectRoot: string): ResolvedTheme | null {
  const cssFiles = findCssFiles(projectRoot);

  let best: { filePath: string; css: string; count: number; rank: number } | null = null;
  for (const filePath of cssFiles) {
    let css: string;
    try {
      css = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const count = rootVarCount(css);
    if (count === 0) continue;
    const rank = fileNameRank(filePath);
    if (
      !best ||
      count > best.count ||
      (count === best.count && rank > best.rank)
    ) {
      best = { filePath, css, count, rank };
    }
  }

  if (!best) return null;

  const light = mergeSelectorBlocks(best.css, ":root");

  let dark: Record<string, string> = {};
  let darkSelector: string | null = null;
  for (const { selector, pattern } of DARK_SELECTORS) {
    const parsed = mergeSelectorBlocks(best.css, pattern);
    if (Object.keys(parsed).length > 0) {
      dark = parsed;
      darkSelector = selector;
      break;
    }
  }

  return {
    theme: { light, dark },
    source: { filePath: best.filePath, darkSelector },
  };
}

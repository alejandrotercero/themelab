// packages/overlay/src/properties/variant-target.ts
//
// The "active variant target" drives every property edit. Instead of only
// editing whichever breakpoint happens to win at the current browser width
// (pickWinningVariant), the user explicitly picks a breakpoint (Base·sm·md·…)
// and/or a Dark toggle. This module owns that state + the Tailwind metadata
// (breakpoint definitions, dark-mode strategy) that the CLI resolves and sends.
//
// Canonical variant ordering (dark first, then breakpoint) matches the CLI
// transform in packages/cli/src/transform.ts (canonicalVariantPrefix).

import type { TailwindTokenMap } from "@themelab/shared";
import { setProjectScreens, pickWinningVariant } from "../utils/class-matches-prefix.js";

export interface TailwindMeta {
  /** breakpoint name → raw min-width (e.g. "768px" or "48rem"); smallest-first. */
  screens: Array<{ name: string; minWidth: number }>;
  darkMode: { strategy: "class" | "media"; selector: string };
}

/** Guaranteed-available defaults if the CLI payload lacks metadata (older CLI). */
const DEFAULT_SCREENS: Array<{ name: string; minWidth: number }> = [
  { name: "sm", minWidth: 640 },
  { name: "md", minWidth: 768 },
  { name: "lg", minWidth: 1024 },
  { name: "xl", minWidth: 1280 },
  { name: "2xl", minWidth: 1536 },
];
const DEFAULT_DARK: TailwindMeta["darkMode"] = { strategy: "media", selector: ".dark" };

let meta: TailwindMeta = { screens: DEFAULT_SCREENS, darkMode: DEFAULT_DARK };

export interface VariantTarget {
  /** "" = base; otherwise a breakpoint name present in `meta.screens`. */
  breakpoint: string;
  /** When true, edits target the `dark:` variant. */
  dark: boolean;
}

let target: VariantTarget = { breakpoint: "", dark: false };

export type VariantTargetListener = (target: VariantTarget, meta: TailwindMeta) => void;
let listeners: VariantTargetListener[] = [];

function notify(): void {
  for (const fn of listeners) fn(target, meta);
}

// --- Metadata ---------------------------------------------------------------

/** Parse a raw Tailwind screen value ("768px", "48rem", "48em") into a pixel min-width. */
function screenToPx(value: string): number {
  const px = /^(\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (px) return Math.round(parseFloat(px[1]));
  const em = /^(\d+(?:\.\d+)?)r?em$/i.exec(value.trim());
  if (em) return Math.round(parseFloat(em[1]) * 16);
  const bare = /^(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (bare) return Math.round(parseFloat(bare[1]));
  return NaN;
}

/**
 * Accept the CLI's `screens`/`darkMode` from a `tailwindTokens` payload. Either may be
 * absent (older CLI or unresolved config); fall back to defaults per-field so a partial
 * payload never blanks out a working one.
 */
export function setTailwindMeta(tokens: Partial<TailwindTokenMap>): void {
  let screens = DEFAULT_SCREENS;
  if (tokens.screens) {
    const parsed: Array<{ name: string; minWidth: number }> = [];
    // Preserve the project's declared order; screens are naturally smallest-first in
    // Tailwind configs, sort defensively in case they aren't.
    const entries = Object.entries(tokens.screens)
      .map(([name, raw]) => ({ name, minWidth: screenToPx(raw) }))
      .filter((s) => !isNaN(s.minWidth))
      .sort((a, b) => a.minWidth - b.minWidth);
    if (entries.length) screens = entries;
  }
  // Clamp the active breakpoint into the new set if it vanished.
  if (target.breakpoint && !screens.some((s) => s.name === target.breakpoint)) {
    target = { ...target, breakpoint: "" };
  }
  meta = { screens, darkMode: tokens.darkMode ?? meta.darkMode };
  // Keep the shared prefix matcher's breakpoint table in sync so pickWinningVariant
  // honors the project's screens (mirrors the overlay copy of that logic).
  setProjectScreens(screens);
  notify();
}

export function getMeta(): TailwindMeta {
  return meta;
}

export function getScreens(): TailwindMeta["screens"] {
  return meta.screens;
}

export function getDarkMode(): TailwindMeta["darkMode"] {
  return meta.darkMode;
}

// --- Target -----------------------------------------------------------------

export function getVariantTarget(): VariantTarget {
  return target;
}

export function setVariantTarget(next: Partial<VariantTarget>): void {
  const prev = target;
  target = { ...target, ...next };
  if (target.breakpoint !== prev.breakpoint || target.dark !== prev.dark) {
    applyDarkPreview();
    notify();
  }
}

export function onVariantTargetChange(fn: VariantTargetListener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

/**
 * Ordered variant tokens for the active target, e.g. ["dark", "md"]. This is the
 * canonical form joined with ":" to produce the `variant` string the CLI expects
 * (dark first, then breakpoint — matching the transform's canonical order).
 */
export function getVariantTokens(): string[] {
  const tokens: string[] = [];
  if (target.dark) tokens.push("dark");
  if (target.breakpoint) tokens.push(target.breakpoint);
  return tokens;
}

/** Canonical `variant` string ("dark:md") or undefined for the base target. */
export function getVariantString(): string | undefined {
  const tokens = getVariantTokens();
  return tokens.length ? tokens.join(":") : undefined;
}

/**
 * Smart default on element select: start at the viewport-winning breakpoint
 * (preserves the pre-feature behavior) and adopt the page's current dark state.
 */
export function resetVariantTargetOnSelect(
  classes: string[],
  matchesBare: (bare: string) => boolean,
): void {
  const winning = pickWinningVariant(classes, matchesBare, window.innerWidth);
  const pageDark = document.documentElement.matches(meta.darkMode.strategy === "class"
    ? meta.darkMode.selector
    : "(prefers-color-scheme: dark)");
  const next: VariantTarget = { breakpoint: winning, dark: pageDark };
  if (next.breakpoint !== target.breakpoint || next.dark !== target.dark) {
    target = next;
    applyDarkPreview();
    notify();
  }
}

/** Called on deselect / overlay teardown to leave the page as we found it. */
export function resetVariantTargetOnDeselect(): void {
  if (target.breakpoint !== "" || target.dark !== false) {
    target = { breakpoint: "", dark: false };
    applyDarkPreview();
    notify();
  }
}

// --- Dark preview -----------------------------------------------------------

// Tracks whether *we* added the dark class, so we only remove what we added and
// never clobber a class the host app sets itself.
let darkPreviewApplied = false;
let hadDarkClassOriginally: boolean | null = null;

function applyDarkPreview(): void {
  const root = document.documentElement;
  const selector = meta.darkMode.selector.replace(/^\./, "");
  // Only the class strategy can be previewed; media strategy is read-only.
  const canToggle = meta.darkMode.strategy === "class";

  if (target.dark && canToggle) {
    if (hadDarkClassOriginally === null) {
      hadDarkClassOriginally = root.classList.contains(selector);
    }
    if (!root.classList.contains(selector)) {
      root.classList.add(selector);
      darkPreviewApplied = true;
    } else if (darkPreviewApplied) {
      // Already dark — but we didn't add it, so don't claim ownership.
      darkPreviewApplied = false;
    }
  } else if (darkPreviewApplied) {
    root.classList.remove(selector);
    darkPreviewApplied = false;
    hadDarkClassOriginally = null;
  } else {
    hadDarkClassOriginally = null;
  }
}

/** Whether the live dark preview is actually toggling the page. */
export function isDarkPreviewActive(): boolean {
  return darkPreviewApplied;
}

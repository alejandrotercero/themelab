// packages/overlay/src/theme-state.ts
// Overlay-side state for Theme mode: holds the project's design tokens (received
// from the CLI), applies live edits by overriding CSS variables on :root, and
// commits edits back to the source CSS file via the CLI. Editing the *token*
// (e.g. --primary) updates every component and both light/dark at once — the
// root fix for "color edits break when toggling dark mode".

import type { ThemeStyles, ThemeSource } from "@themelab/shared";

import { send } from "./bridge.js";
import {
  isColor,
  detectColorKind,
  toHex,
  serializeToKind,
} from "./utils/color-format.js";
import type { ColorKind } from "./utils/color-format.js";

export type ThemeMode = "light" | "dark";

let theme: ThemeStyles | null = null;
let source: ThemeSource | null = null;
let mode: ThemeMode = "light";

// Pending (uncommitted) edits per mode: var name (no --) → new value.
const pending: Record<ThemeMode, Record<string, string>> = {
  light: {},
  dark: {},
};

type ThemeListener = () => void;
const listeners = new Set<ThemeListener>();

function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}

export function onThemeChange(fn: ThemeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Install the theme received from the CLI. */
export function setTheme(
  next: ThemeStyles,
  nextSource: ThemeSource | null
): void {
  theme = next;
  source = nextSource;
  pending.light = {};
  pending.dark = {};
  // If there's no dark block, dark editing is unavailable; stay in light.
  if (!nextSource?.darkSelector) {
    mode = "light";
  }
  notify();
}

export function hasTheme(): boolean {
  return theme !== null;
}

export function getSource(): ThemeSource | null {
  return source;
}

export function getMode(): ThemeMode {
  return mode;
}

export function canEditDark(): boolean {
  return Boolean(source?.darkSelector);
}

/**
 * Make the inline :root overrides reflect exactly the active mode's pending
 * edits. Inline overrides can only hold one value per variable, so switching
 * modes swaps which mode's staged values are forced onto the page.
 */
function syncInlinePreview(): void {
  const staged = new Set([
    ...Object.keys(pending.light),
    ...Object.keys(pending.dark),
  ]);
  for (const name of staged) {
    document.documentElement.style.removeProperty(`--${name}`);
  }
  for (const [name, value] of Object.entries(pending[mode])) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
}

export function setMode(next: ThemeMode): void {
  if (next === "dark" && !canEditDark()) {
    return;
  }
  mode = next;
  // Re-point the inline preview at the new mode's staged values so toggling
  // light/dark shows each mode's pending edits — both are previewable before commit.
  syncInlinePreview();
  notify();
}

/** All token names for the current mode (committed keys ∪ base light keys), sorted. */
export function getTokenNames(): string[] {
  if (!theme) {
    return [];
  }
  const names = new Set<string>([
    ...Object.keys(theme.light),
    ...Object.keys(theme[mode]),
    ...Object.keys(pending[mode]),
  ]);
  // `.toSorted()` needs ES2023 lib (tsconfig targets ES2022, shared across the
  // package — not this task's to change); `.sort()` here mutates a fresh array
  // just created by the spread above, not any external/shared state, so this is safe.
  // oxlint-disable-next-line unicorn/no-array-sort -- see comment above
  return [...names].sort();
}

/** The effective value for a token in the current mode: pending edit, else committed. */
export function getValue(name: string): string | undefined {
  if (pending[mode][name] !== undefined) {
    return pending[mode][name];
  }
  return theme?.[mode]?.[name] ?? theme?.light?.[name];
}

/** Token names whose value is a color, for the current mode — used by the
 *  element color picker to offer "bind to a theme variable". */
export function getColorTokenNames(): string[] {
  return getTokenNames().filter((name) => {
    const v = getValue(name);
    return v !== null && v !== undefined && isColor(v);
  });
}

/** Whether a token currently has an uncommitted edit in the active mode. */
export function isEdited(name: string): boolean {
  return pending[mode][name] !== undefined;
}

/** The current theme (committed values + staged edits) for both modes — used to
 *  hand the live theme off to the web studio's editor. */
export function getCurrentThemeStyles(): ThemeStyles | null {
  if (!theme) {
    return null;
  }
  return {
    light: { ...theme.light, ...pending.light },
    dark: { ...theme.dark, ...pending.dark },
  };
}

export interface BatchApplyResult {
  applied: number;
  skipped: number;
  /** Which modes were written — "both" for a dual paste, else the single mode. */
  modes: "both" | ThemeMode;
}

/**
 * Convert an incoming pasted value into the project token's existing color
 * format — e.g. an `hsl(…)` paste into an `hsl`-triple token becomes the bare
 * `H S% L%` channels the project consumes via `hsl(var(--x))`. Mirrors the
 * single-token color picker. Non-color or unparseable values pass through.
 */
function coerceToTokenFormat(
  existing: string | undefined,
  incoming: string
): string {
  if (existing === undefined) {
    return incoming;
  }
  const kind = detectColorKind(existing);
  if (!kind) {
    return incoming;
  }
  const hex = toHex(incoming);
  return hex ? serializeToKind(hex, kind) : incoming;
}

/**
 * Stage a full pasted theme across both modes at once. Only tokens the project
 * already defines are applied (so a commit never invents new vars the CSS file
 * doesn't have); unknown tokens are counted as skipped. Values are written
 * verbatim — we don't reformat to the token's original color kind, since a paste
 * is an intentional wholesale replacement. Both modes are staged and previewable
 * (toggle light/dark) before the next commit() writes them.
 */
export function batchApplyTheme(parsed: {
  light?: Record<string, string>;
  dark?: Record<string, string>;
}): BatchApplyResult {
  if (!theme) {
    return { applied: 0, skipped: 0, modes: mode };
  }

  const hasLight = Object.keys(parsed.light ?? {}).length > 0;
  const hasDark = Object.keys(parsed.dark ?? {}).length > 0;

  // A single-mode paste applies to the mode you're currently editing — "paste
  // one theme" updates just the active mode, not always light. A dual paste
  // (CSS :root + .dark, or JSON { root, dark }) writes both.
  const apply: Record<ThemeMode, Record<string, string>> = {
    light: {},
    dark: {},
  };
  let modes: "both" | ThemeMode;
  if (hasLight && hasDark) {
    apply.light = parsed.light ?? {};
    apply.dark = parsed.dark ?? {};
    modes = "both";
  } else {
    apply[mode] = hasLight ? (parsed.light ?? {}) : (parsed.dark ?? {});
    modes = mode;
  }

  let applied = 0;
  let skipped = 0;
  for (const m of ["light", "dark"] as ThemeMode[]) {
    // The project's known tokens for this mode (dark may share light's keys).
    const known = new Set([
      ...Object.keys(theme.light),
      ...Object.keys(theme[m]),
    ]);
    for (const [name, value] of Object.entries(apply[m])) {
      if (!known.has(name)) {
        skipped += 1;
        continue;
      }
      const existing = theme[m]?.[name] ?? theme.light?.[name];
      pending[m][name] = coerceToTokenFormat(existing, value);
      applied += 1;
    }
  }
  syncInlinePreview();
  notify();
  return { applied, skipped, modes };
}

const KIND_LABELS: Record<ColorKind, string> = {
  "hsl-triple": "HSL (triple)",
  "rgb-triple": "RGB (triple)",
  hex: "HEX",
  hsl: "HSL",
  hsla: "HSL",
  rgb: "RGB",
  rgba: "RGB",
  oklch: "OKLCH",
  css: "CSS",
};

export interface ThemeFormatInfo {
  /** The dominant color format across the theme's color tokens. */
  kind: ColorKind | null;
  /** Human-readable label, e.g. "HSL (triple)". */
  label: string;
  /**
   * True when tokens are full color functions (consumed via `var(--x)`), so
   * reformatting to another function format is safe. False for channel-triples
   * (`H S% L%` consumed via `hsl(var(--x))`), where the format is fixed — the
   * component code, not the token, decides the wrapper.
   */
  convertible: boolean;
}

/** Inspect the committed theme and report its dominant color format. */
export function detectThemeFormat(): ThemeFormatInfo {
  const counts = new Map<ColorKind, number>();
  let hasTriple = false;
  if (theme) {
    for (const value of Object.values(theme.light)) {
      const kind = detectColorKind(value);
      if (!kind) {
        continue;
      }
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if (kind === "hsl-triple" || kind === "rgb-triple") {
        hasTriple = true;
      }
    }
  }
  let kind: ColorKind | null = null;
  let max = 0;
  for (const [k, n] of counts) {
    if (n > max) {
      max = n;
      kind = k;
    }
  }
  return {
    kind,
    label: kind ? KIND_LABELS[kind] : "—",
    convertible: kind !== null && !hasTriple,
  };
}

/**
 * Re-serialize every color token (both modes) into `target`, staging the result
 * as pending edits to preview + commit. Only safe for full-function themes — see
 * {@link detectThemeFormat}. Returns how many tokens changed.
 */
export function convertThemeFormat(target: ColorKind): number {
  if (!theme) {
    return 0;
  }
  let changed = 0;
  for (const m of ["light", "dark"] as ThemeMode[]) {
    for (const [name, committed] of Object.entries(theme[m])) {
      const current = pending[m][name] ?? committed;
      if (!isColor(current)) {
        continue;
      }
      const hex = toHex(current);
      if (!hex) {
        continue;
      }
      const next = serializeToKind(hex, target);
      if (next === committed) {
        Reflect.deleteProperty(pending[m], name);
      } else {
        pending[m][name] = next;
        changed += 1;
      }
    }
  }
  syncInlinePreview();
  notify();
  return changed;
}

export function hasPendingEdits(): boolean {
  return (
    Object.keys(pending.light).length > 0 ||
    Object.keys(pending.dark).length > 0
  );
}

/**
 * Stage an edit and live-preview it by overriding the CSS variable on :root.
 * Inline :root overrides win the cascade, so the change shows immediately for
 * whichever mode the app is currently rendering.
 */
export function previewVar(name: string, value: string): void {
  pending[mode][name] = value;
  document.documentElement.style.setProperty(`--${name}`, value);
  notify();
}

/** Drop all staged edits and remove the inline overrides (revert to source). */
export function resetPreview(): void {
  for (const m of ["light", "dark"] as ThemeMode[]) {
    for (const name of Object.keys(pending[m])) {
      document.documentElement.style.removeProperty(`--${name}`);
    }
    pending[m] = {};
  }
  notify();
}

/**
 * Commit staged edits to the source CSS file via the CLI. Builds per-selector
 * edits (:root for light, the project's dark selector for dark). On success the
 * pending edits are folded into the in-memory theme and inline overrides cleared
 * (the real stylesheet now carries them).
 */
export function commit(): boolean {
  if (!source || !hasPendingEdits()) {
    return false;
  }

  const edits: { selector: string; vars: Record<string, string> }[] = [];
  if (Object.keys(pending.light).length > 0) {
    edits.push({ selector: ":root", vars: { ...pending.light } });
  }
  if (Object.keys(pending.dark).length > 0 && source.darkSelector) {
    edits.push({ selector: source.darkSelector, vars: { ...pending.dark } });
  }
  if (edits.length === 0) {
    return false;
  }

  send({ type: "updateTheme", filePath: source.filePath, edits });
  return true;
}

/** Called when the CLI confirms a successful write — fold edits into state. */
export function onCommitSuccess(): void {
  if (!theme) {
    return;
  }
  for (const m of ["light", "dark"] as ThemeMode[]) {
    for (const [name, value] of Object.entries(pending[m])) {
      theme[m][name] = value;
      // The stylesheet now has the value; drop the inline override so the real
      // cascade (incl. dark-mode switching) takes effect.
      document.documentElement.style.removeProperty(`--${name}`);
    }
    pending[m] = {};
  }
  notify();
}

// packages/overlay/src/theme-state.ts
// Overlay-side state for Theme mode: holds the project's design tokens (received
// from the CLI), applies live edits by overriding CSS variables on :root, and
// commits edits back to the source CSS file via the CLI. Editing the *token*
// (e.g. --primary) updates every component and both light/dark at once — the
// root fix for "color edits break when toggling dark mode".

import type { ThemeStyles, ThemeSource } from "@react-rewrite/shared";
import { send } from "./bridge.js";
import { isColor } from "./utils/color-format.js";

export type ThemeMode = "light" | "dark";

let theme: ThemeStyles | null = null;
let source: ThemeSource | null = null;
let mode: ThemeMode = "light";

// Pending (uncommitted) edits per mode: var name (no --) → new value.
const pending: Record<ThemeMode, Record<string, string>> = { light: {}, dark: {} };

type ThemeListener = () => void;
const listeners = new Set<ThemeListener>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function onThemeChange(fn: ThemeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Install the theme received from the CLI. */
export function setTheme(next: ThemeStyles, nextSource: ThemeSource | null): void {
  theme = next;
  source = nextSource;
  pending.light = {};
  pending.dark = {};
  // If there's no dark block, dark editing is unavailable; stay in light.
  if (!nextSource?.darkSelector) mode = "light";
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

export function setMode(next: ThemeMode): void {
  if (next === "dark" && !canEditDark()) return;
  mode = next;
  notify();
}

/** All token names for the current mode (committed keys ∪ base light keys), sorted. */
export function getTokenNames(): string[] {
  if (!theme) return [];
  const names = new Set<string>([
    ...Object.keys(theme.light),
    ...Object.keys(theme[mode]),
    ...Object.keys(pending[mode]),
  ]);
  return [...names].sort();
}

/** Token names whose value is a color, for the current mode — used by the
 *  element color picker to offer "bind to a theme variable". */
export function getColorTokenNames(): string[] {
  return getTokenNames().filter((name) => {
    const v = getValue(name);
    return v != null && isColor(v);
  });
}

/** The effective value for a token in the current mode: pending edit, else committed. */
export function getValue(name: string): string | undefined {
  if (pending[mode][name] !== undefined) return pending[mode][name];
  return theme?.[mode]?.[name] ?? theme?.light?.[name];
}

/** Whether a token currently has an uncommitted edit in the active mode. */
export function isEdited(name: string): boolean {
  return pending[mode][name] !== undefined;
}

export function hasPendingEdits(): boolean {
  return Object.keys(pending.light).length > 0 || Object.keys(pending.dark).length > 0;
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
  if (!source || !hasPendingEdits()) return false;

  const edits: Array<{ selector: string; vars: Record<string, string> }> = [];
  if (Object.keys(pending.light).length > 0) {
    edits.push({ selector: ":root", vars: { ...pending.light } });
  }
  if (Object.keys(pending.dark).length > 0 && source.darkSelector) {
    edits.push({ selector: source.darkSelector, vars: { ...pending.dark } });
  }
  if (edits.length === 0) return false;

  send({ type: "updateTheme", filePath: source.filePath, edits });
  return true;
}

/** Called when the CLI confirms a successful write — fold edits into state. */
export function onCommitSuccess(): void {
  if (!theme) return;
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

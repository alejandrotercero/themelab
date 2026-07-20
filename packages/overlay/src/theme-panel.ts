// packages/overlay/src/theme-panel.ts
// A self-contained, collapsible "Theme" dock for editing the project's design
// tokens (shadcn/Tailwind CSS variables) with live preview + write-back.
// Lives in the overlay's Shadow DOM; pinned bottom-left so it doesn't collide
// with the toolbar (top) or tools panel.

import { encodeTheme, parseThemeInput } from "@themelab/shared";

import { onMessage } from "./bridge.js";
import { openColorPicker } from "./color-picker.js";
import {
  COLORS,
  RADII,
  SHADOWS,
  TRANSITIONS,
  FONT_FAMILY,
} from "./design-tokens.js";
import {
  openTailwindPalette,
  closeTailwindPalette,
  isTailwindPaletteOpen,
  tailwindLogoSvg,
} from "./properties/tailwind-palette.js";
import {
  hasTheme,
  getSource,
  getMode,
  setMode,
  canEditDark,
  getTokenNames,
  getValue,
  isEdited,
  hasPendingEdits,
  previewVar,
  resetPreview,
  commit,
  onThemeChange,
  getCurrentThemeStyles,
  batchApplyTheme,
  detectThemeFormat,
  convertThemeFormat,
  setTheme,
  onCommitSuccess as onThemeCommitSuccess,
} from "./theme-state.js";
import type { ThemeMode } from "./theme-state.js";
import {
  detectColorKind,
  toRenderableCss,
  toHex,
  serializeToKind,
} from "./utils/color-format.js";
import type { ColorKind } from "./utils/color-format.js";

declare global {
  interface Window {
    __THEMELAB_STUDIO_URL__?: string;
  }
}

let root: ShadowRoot | null = null;
let dock: HTMLDivElement | null = null;
let expanded = false;
let lastStructuralKey = "";
let unsubscribe: (() => void) | null = null;
let unsubscribeMessage: (() => void) | null = null;

// Paste-to-batch-update state. Draft survives re-renders (render() rebuilds the
// dock), so typing doesn't trigger render() and the textarea keeps its content.
let pasteOpen = false;
let pasteDraft = "";
let pasteStatus = "";

// Visibility listeners — let the bottom-bar Theme button reflect open/close
// regardless of whether the toggle came from the button or the panel's ✕.
type VisListener = () => void;
const visListeners = new Set<VisListener>();
function notifyVis(): void {
  for (const fn of visListeners) {
    fn();
  }
}

/** A secondary (non-primary) panel button with the shared dock styling. */
function secondaryButton(text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.style.cssText = `
    flex: 1 1 auto; padding: 6px 10px; font: 500 11px/1 ${FONT_FAMILY};
    color: ${COLORS.textSecondary}; background: ${COLORS.bgSecondary};
    border: 1px solid ${COLORS.border}; border-radius: ${RADII.sm};
    cursor: pointer; transition: ${TRANSITIONS.fast}; white-space: nowrap;
  `;
  return b;
}

// Channel-triples (`H S% L%`) wrapped into `hsl(…)`/`rgb(…)` — the studio
// consumes tokens via `var(--x)` directly, so a bare triple wouldn't be a
// valid color there. Pure function of its argument: hoisted to module scope
// (rather than nested in openInEditor) so it isn't recreated on every call.
function webSafe(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = toRenderableCss(v) ?? v;
  }
  return out;
}

/** Open the current theme (committed + staged edits) in the web studio's /edit. */
function openInEditor(): void {
  const theme = getCurrentThemeStyles();
  if (!theme) {
    return;
  }
  const base = (
    window.__THEMELAB_STUDIO_URL__ || "https://themelab.dev"
  ).replace(/\/+$/, "");
  const encoded = encodeTheme({
    light: webSafe(theme.light),
    dark: webSafe(theme.dark),
  });
  window.open(`${base}/edit#theme=${encoded}`, "_blank", "noopener,noreferrer");
}

// The full color-function kinds the studio-style convert offers. Triples are
// excluded: a project on triples consumes them via `hsl(var(--x))`, so the
// format is fixed by the component code, not switchable from here.
const CONVERT_KINDS: ColorKind[] = ["hex", "hsl", "rgb", "oklch"];

function convertOption(kind: ColorKind): ColorKind {
  if (kind === "hsla") {
    return "hsl";
  }
  if (kind === "rgba") {
    return "rgb";
  }
  if (kind === "css") {
    return "hex";
  }
  return kind;
}

let applyBtn: HTMLButtonElement | null = null;
let resetBtn: HTMLButtonElement | null = null;

function updateFooter(): void {
  const pending = hasPendingEdits();
  if (applyBtn) {
    applyBtn.disabled = !pending;
    applyBtn.style.opacity = pending ? "1" : "0.5";
    applyBtn.style.cursor = pending ? "pointer" : "default";
  }
  if (resetBtn) {
    resetBtn.disabled = !pending;
    resetBtn.style.opacity = pending ? "1" : "0.5";
  }
}

function tokenRow(name: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 3px 4px; border-radius: ${RADII.xs};`;

  const checker =
    "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px";
  const renderable = toRenderableCss(value); // null for non-colors (radius, fonts…)

  // Swatch — a button that opens the color picker for color tokens.
  const swatch = document.createElement("button");
  const setSwatch = (v: string) => {
    const r = toRenderableCss(v);
    swatch.style.background = r ?? checker;
  };
  swatch.style.cssText = `
    flex: 0 0 auto; width: 18px; height: 18px; padding: 0; border-radius: ${RADII.xs};
    border: 1px solid ${COLORS.border}; cursor: ${renderable ? "pointer" : "default"};
  `;
  setSwatch(value);
  row.append(swatch);

  const label = document.createElement("span");
  label.textContent = name;
  label.title = name;
  label.style.cssText = `flex: 1 1 auto; font: 500 11px/1.2 ${FONT_FAMILY}; color: ${isEdited(name) ? COLORS.accent : COLORS.textSecondary}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
  row.append(label);

  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.spellcheck = false;
  input.style.cssText = `
    flex: 0 0 168px; width: 168px; padding: 3px 6px; font: 400 11px/1.2 ui-monospace, monospace;
    color: ${COLORS.textPrimary}; background: ${COLORS.bgSecondary};
    border: 1px solid ${COLORS.border}; border-radius: ${RADII.xs}; outline: none;
  `;
  const apply = (v: string) => {
    previewVar(name, v);
    setSwatch(v);
    label.style.color = COLORS.accent;
    updateFooter();
  };
  input.addEventListener("input", () => apply(input.value));
  input.addEventListener("focus", () => {
    input.style.borderColor = COLORS.accent;
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = COLORS.border;
  });
  row.append(input);

  // Color picker: seed from the current value as hex, write back in the token's
  // original format (hsl-triple, oklch, hex, …) so we never reformat the theme.
  if (renderable) {
    swatch.addEventListener("click", () => {
      const current = input.value;
      const kind = detectColorKind(current) ?? "hex";
      const seed = toHex(current) ?? "#000000";
      const rect = swatch.getBoundingClientRect();
      openColorPicker({
        initialColor: seed,
        position: { x: rect.right + 8, y: rect.top },
        showPropertyToggle: false,
        onColorChange: (hex) => {
          const serialized = serializeToKind(hex, kind);
          input.value = serialized;
          apply(serialized);
        },
        onClose: () => {
          /* empty */
        },
      });
    });

    // Tailwind palette: pick a TW color, written back in the token's format.
    const twBtn = document.createElement("button");
    twBtn.title = "Pick a Tailwind color";
    twBtn.innerHTML = tailwindLogoSvg(14);
    twBtn.style.cssText = `
      flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; background: transparent;
      border: 1px solid ${COLORS.border}; border-radius: ${RADII.xs}; cursor: pointer;
    `;
    twBtn.addEventListener("click", () => {
      if (isTailwindPaletteOpen()) {
        closeTailwindPalette();
        return;
      }
      const rowRoot = row.getRootNode();
      const mount = (
        rowRoot instanceof ShadowRoot ? rowRoot : document.body
      ) as ShadowRoot | HTMLElement;
      openTailwindPalette({
        anchorRect: twBtn.getBoundingClientRect(),
        anchorEl: twBtn,
        mount,
        onPick: (_token, css) => {
          const kind = detectColorKind(input.value) ?? "hex";
          const hex = toHex(css) ?? css;
          const serialized = serializeToKind(hex, kind);
          input.value = serialized;
          apply(serialized);
        },
      });
    });
    row.append(twBtn);
  }
  return row;
}

function tokenList(): HTMLElement {
  const list = document.createElement("div");
  list.style.cssText = `flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px;`;

  const source = getSource();
  if (source) {
    const src = document.createElement("div");
    src.textContent = source.filePath.split("/").slice(-2).join("/");
    src.title = source.filePath;
    src.style.cssText = `font: 400 10px/1.4 ${FONT_FAMILY}; color: ${COLORS.textTertiary}; padding: 2px 4px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    list.append(src);
  }

  for (const name of getTokenNames()) {
    const value = getValue(name) ?? "";
    list.append(tokenRow(name, value));
  }
  return list;
}

function render(): void {
  if (!root) {
    return;
  }
  if (!dock) {
    dock = document.createElement("div");
    root.append(dock);
  }
  lastStructuralKey = `${getMode()}|${getTokenNames().join(",")}|${hasTheme()}`;

  // Hidden unless a theme exists AND the panel is toggled open (the bottom-bar
  // Theme button is the trigger). When open it docks as a full-height sidebar
  // on the LEFT edge, mirroring the property sidebar on the right — no more
  // floating dock.
  if (!hasTheme() || !expanded) {
    dock.style.display = "none";
    dock.innerHTML = "";
    return;
  }

  dock.innerHTML = "";
  dock.style.cssText = `
    position: fixed; top: 0; left: 0; bottom: 0; width: 380px; z-index: 2147483646;
    display: flex; flex-direction: column; overflow: hidden;
    background: ${COLORS.bgPrimary}; border-right: 1px solid ${COLORS.border};
    box-shadow: ${SHADOWS.lg}; font-family: ${FONT_FAMILY}; pointer-events: auto;
    animation: rrThemeSlideIn ${TRANSITIONS.settle};
  `;
  // header/actionsBar/footer are declared further down the file — they call
  // back into render() on user interaction (mode toggle, apply, paste, format
  // convert), so render() and those handlers are genuinely mutually recursive
  // and can't all be ordered ahead of their callers. Function declarations
  // hoist, so this is safe at runtime.
  // oxlint-disable-next-line no-use-before-define -- mutual recursion with header(); see comment above
  dock.append(header());
  // oxlint-disable-next-line no-use-before-define -- mutual recursion with actionsBar(); see comment above
  dock.append(actionsBar());
  dock.append(tokenList());
  // oxlint-disable-next-line no-use-before-define -- mutual recursion with footer(); see comment above
  dock.append(footer());
}

function setExpanded(next: boolean): void {
  expanded = next;
  render();
  notifyVis();
}

function header(): HTMLElement {
  const bar = document.createElement("div");
  bar.style.cssText = `
    display: flex; align-items: center; gap: 8px; padding: 10px 12px;
    border-bottom: 1px solid ${COLORS.border}; flex: 0 0 auto;
  `;
  const title = document.createElement("span");
  title.textContent = "Theme";
  title.style.cssText = `font: 600 13px/1 ${FONT_FAMILY}; color: ${COLORS.textPrimary}; flex: 0 0 auto;`;
  bar.append(title);

  // light / dark segmented toggle
  const seg = document.createElement("div");
  seg.style.cssText = `display: flex; gap: 2px; background: ${COLORS.bgTertiary}; border-radius: ${RADII.sm}; padding: 2px; flex: 1 1 auto;`;
  for (const m of ["light", "dark"] as ThemeMode[]) {
    const b = document.createElement("button");
    b.textContent = m;
    const active = getMode() === m;
    const disabled = m === "dark" && !canEditDark();
    b.disabled = disabled;
    b.style.cssText = `
      flex: 1; text-transform: capitalize; padding: 4px 8px; border: none; cursor: ${disabled ? "not-allowed" : "pointer"};
      font: 500 12px/1 ${FONT_FAMILY}; border-radius: ${RADII.xs};
      color: ${active ? COLORS.textPrimary : COLORS.textSecondary};
      background: ${active ? COLORS.bgPrimary : "transparent"};
      box-shadow: ${active ? SHADOWS.sm : "none"}; opacity: ${disabled ? 0.4 : 1};
    `;
    b.addEventListener("click", () => {
      setMode(m);
      render();
    });
    seg.append(b);
  }
  bar.append(seg);

  const close = document.createElement("button");
  close.textContent = "✕";
  close.title = "Collapse";
  close.style.cssText = `border: none; background: transparent; cursor: pointer; color: ${COLORS.textTertiary}; font-size: 13px; padding: 2px 4px;`;
  close.addEventListener("click", () => setExpanded(false));
  bar.append(close);
  return bar;
}

/** Shows the theme's detected color format, with a convert dropdown when the
 *  tokens are full color functions (safe to re-serialize). */
function formatRow(): HTMLElement {
  const bar = document.createElement("div");
  bar.style.cssText = `display: flex; align-items: center; gap: 6px;`;

  const info = detectThemeFormat();

  const label = document.createElement("span");
  label.textContent = `Format: ${info.label}`;
  label.style.cssText = `font: 500 10px/1.4 ${FONT_FAMILY}; color: ${COLORS.textTertiary}; flex: 0 0 auto;`;
  bar.append(label);

  if (info.convertible) {
    const sel = document.createElement("select");
    sel.title = "Convert every color token to this format";
    sel.style.cssText = `
      margin-left: auto; padding: 2px 6px; font: 500 10px/1.4 ${FONT_FAMILY};
      color: ${COLORS.textSecondary}; background: ${COLORS.bgSecondary};
      border: 1px solid ${COLORS.border}; border-radius: ${RADII.xs}; cursor: pointer;
    `;
    const current = info.kind ? convertOption(info.kind) : "oklch";
    for (const k of CONVERT_KINDS) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k.toUpperCase();
      if (k === current) {
        opt.selected = true;
      }
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      const changed = convertThemeFormat(sel.value as ColorKind);
      pasteStatus = changed
        ? `Converted ${changed} token${changed === 1 ? "" : "s"} to ${sel.value.toUpperCase()}. Hit Apply to save.`
        : "";
      render();
    });
    bar.append(sel);
  } else if (info.kind) {
    const note = document.createElement("span");
    note.textContent = "fixed — consumed via hsl(var())";
    note.title =
      "Channel-triple themes are wrapped by your components, so the format can't be switched here.";
    note.style.cssText = `margin-left: auto; font: 400 10px/1.4 ${FONT_FAMILY}; color: ${COLORS.textTertiary}; opacity: 0.7;`;
    bar.append(note);
  }

  return bar;
}

function pasteBox(): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;

  const ta = document.createElement("textarea");
  ta.value = pasteDraft;
  ta.placeholder =
    "Paste the studio export — shadcn CSS (:root + .dark) or JSON ({ root, dark })";
  ta.spellcheck = false;
  ta.rows = 5;
  ta.style.cssText = `
    width: 100%; box-sizing: border-box; resize: vertical; padding: 6px 8px;
    font: 400 11px/1.4 ui-monospace, monospace; color: ${COLORS.textPrimary};
    background: ${COLORS.bgSecondary}; border: 1px solid ${COLORS.border};
    border-radius: ${RADII.xs}; outline: none;
  `;
  ta.addEventListener("input", () => {
    pasteDraft = ta.value;
  });
  ta.addEventListener("focus", () => {
    ta.style.borderColor = COLORS.accent;
  });
  ta.addEventListener("blur", () => {
    ta.style.borderColor = COLORS.border;
  });
  box.append(ta);

  const applyPasted = secondaryButton("Apply pasted");
  applyPasted.addEventListener("click", () => {
    const parsed = parseThemeInput(pasteDraft);
    if (!parsed) {
      pasteStatus = "Couldn't parse — paste the CSS or JSON export.";
      render();
      return;
    }
    const { applied, skipped, modes } = batchApplyTheme(parsed);
    if (applied > 0) {
      const skip = skipped ? `, skipped ${skipped} unknown` : "";
      const where =
        modes === "both"
          ? "toggle light/dark to preview both"
          : `applied to ${modes}`;
      pasteStatus = `Applied ${applied} token${applied === 1 ? "" : "s"}${skip} — ${where}. Hit Apply to save.`;
      pasteDraft = "";
    } else {
      pasteStatus = "No matching tokens found in this project's theme.";
    }
    render();
  });
  box.append(applyPasted);
  return box;
}

/** Actions row under the header: open-in-editor + the paste-to-batch-update box. */
function actionsBar(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    display: flex; flex-direction: column; gap: 8px; padding: 8px 12px;
    border-bottom: 1px solid ${COLORS.border}; flex: 0 0 auto;
  `;

  const row = document.createElement("div");
  row.style.cssText = `display: flex; gap: 8px;`;

  const openBtn = secondaryButton("↗ Open in editor");
  openBtn.title = "Open this theme in the ThemeLab studio";
  openBtn.addEventListener("click", openInEditor);
  row.append(openBtn);

  const pasteBtn = secondaryButton(pasteOpen ? "Close paste" : "Paste theme");
  pasteBtn.title = "Paste a studio export to batch-update every token";
  pasteBtn.addEventListener("click", () => {
    pasteOpen = !pasteOpen;
    pasteStatus = "";
    render();
  });
  row.append(pasteBtn);

  wrap.append(row);
  wrap.append(formatRow());
  if (pasteOpen) {
    wrap.append(pasteBox());
  }

  if (pasteStatus) {
    const status = document.createElement("div");
    status.textContent = pasteStatus;
    status.style.cssText = `font: 400 10px/1.4 ${FONT_FAMILY}; color: ${COLORS.textTertiary};`;
    wrap.append(status);
  }
  return wrap;
}

function footer(): HTMLElement {
  const bar = document.createElement("div");
  bar.style.cssText = `display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid ${COLORS.border}; flex: 0 0 auto;`;

  resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = `
    flex: 0 0 auto; padding: 6px 12px; font: 500 12px/1 ${FONT_FAMILY};
    color: ${COLORS.textSecondary}; background: ${COLORS.bgSecondary};
    border: 1px solid ${COLORS.border}; border-radius: ${RADII.sm}; cursor: pointer;
  `;
  resetBtn.addEventListener("click", () => {
    resetPreview();
    render();
  });
  bar.append(resetBtn);

  applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.style.cssText = `
    flex: 1 1 auto; padding: 6px 12px; font: 600 12px/1 ${FONT_FAMILY};
    color: ${COLORS.textOnAccent}; background: ${COLORS.accent};
    border: none; border-radius: ${RADII.sm}; cursor: pointer; transition: ${TRANSITIONS.fast};
  `;
  applyBtn.addEventListener("click", () => {
    commit();
  });
  bar.append(applyBtn);
  updateFooter();
  return bar;
}

export function initThemePanel(shadowRoot: ShadowRoot): void {
  root = shadowRoot;
  const style = document.createElement("style");
  style.textContent = `@keyframes rrThemeSlideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }`;
  shadowRoot.append(style);
  unsubscribe = onThemeChange(() => {
    // Only rebuild on structural changes (theme arrival, mode switch), not on
    // every keystroke preview — otherwise the focused input would be recreated.
    const key = `${getMode()}|${getTokenNames().join(",")}|${hasTheme()}`;
    if (key === lastStructuralKey) {
      updateFooter();
    } else {
      render();
    }
  });
  // Theme mode: receive the project's design tokens, and confirm writes.
  // Owned here (rather than bridge.js) so bridge stays a dependency-free leaf.
  unsubscribeMessage = onMessage((msg) => {
    if (msg.type === "themeStyles") {
      setTheme(msg.theme, msg.source);
    }
    if (msg.type === "updateThemeComplete" && msg.success) {
      onThemeCommitSuccess();
    }
  });
  render();
}

export function destroyThemePanel(): void {
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeMessage?.();
  unsubscribeMessage = null;
  dock?.remove();
  dock = null;
  root = null;
  expanded = false;
}

export function onThemePanelToggle(fn: VisListener): () => void {
  visListeners.add(fn);
  return () => visListeners.delete(fn);
}

export function toggleThemePanel(): void {
  if (!hasTheme()) {
    return;
  }
  setExpanded(!expanded);
}

/** True when the theme sidebar is currently open — lets the bottom-bar toggle
 *  reflect state. */
export function isThemePanelOpen(): boolean {
  return expanded && hasTheme();
}

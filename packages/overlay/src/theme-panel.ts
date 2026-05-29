// packages/overlay/src/theme-panel.ts
// A self-contained, collapsible "Theme" dock for editing the project's design
// tokens (shadcn/Tailwind CSS variables) with live preview + write-back.
// Lives in the overlay's Shadow DOM; pinned bottom-left so it doesn't collide
// with the toolbar (top) or tools panel.

import { COLORS, RADII, SHADOWS, TRANSITIONS, FONT_FAMILY } from "./design-tokens.js";
import { openColorPicker } from "./color-picker.js";
import { detectColorKind, toRenderableCss, toHex, serializeToKind } from "./utils/color-format.js";
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
  type ThemeMode,
} from "./theme-state.js";

let root: ShadowRoot | null = null;
let dock: HTMLDivElement | null = null;
let expanded = false;
let lastStructuralKey = "";
let unsubscribe: (() => void) | null = null;


export function initThemePanel(shadowRoot: ShadowRoot): void {
  root = shadowRoot;
  unsubscribe = onThemeChange(() => {
    // Only rebuild on structural changes (theme arrival, mode switch), not on
    // every keystroke preview — otherwise the focused input would be recreated.
    const key = `${getMode()}|${getTokenNames().join(",")}|${hasTheme()}`;
    if (key !== lastStructuralKey) render();
    else updateFooter();
  });
  render();
}

export function destroyThemePanel(): void {
  unsubscribe?.();
  unsubscribe = null;
  dock?.remove();
  dock = null;
  root = null;
  expanded = false;
}

export function toggleThemePanel(): void {
  if (!hasTheme()) return;
  expanded = !expanded;
  render();
}

function render(): void {
  if (!root) return;
  if (!dock) {
    dock = document.createElement("div");
    root.appendChild(dock);
  }
  lastStructuralKey = `${getMode()}|${getTokenNames().join(",")}|${hasTheme()}`;

  // No theme detected → hide entirely.
  if (!hasTheme()) {
    dock.style.display = "none";
    return;
  }
  dock.style.display = "block";
  // Top-left, aligned with the bottom toolbar's former left edge. Clears the
  // left tools strip, the (now-centered) bottom toolbar, and the right sidebar.
  dock.style.cssText = `
    position: fixed; top: 16px; left: 76px; z-index: 2147483646;
    font-family: ${FONT_FAMILY}; pointer-events: auto;
  `;

  if (!expanded) {
    dock.innerHTML = "";
    dock.appendChild(pillButton());
    return;
  }

  dock.innerHTML = "";
  const panel = document.createElement("div");
  panel.style.cssText = `
    width: 280px; max-height: 70vh; display: flex; flex-direction: column;
    background: ${COLORS.bgPrimary}; border: 1px solid ${COLORS.border};
    border-radius: ${RADII.lg}; box-shadow: ${SHADOWS.lg}; overflow: hidden;
  `;
  panel.appendChild(header());
  panel.appendChild(tokenList());
  panel.appendChild(footer());
  dock.appendChild(panel);
}

function pillButton(): HTMLElement {
  const btn = document.createElement("button");
  btn.textContent = "🎨 Theme";
  btn.style.cssText = `
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; font: 600 13px/1 ${FONT_FAMILY};
    color: ${COLORS.textPrimary}; background: ${COLORS.bgPrimary};
    border: 1px solid ${COLORS.border}; border-radius: 999px;
    box-shadow: ${SHADOWS.md}; cursor: pointer; transition: ${TRANSITIONS.fast};
  `;
  if (hasPendingEdits()) {
    btn.style.borderColor = COLORS.accent;
    btn.textContent = "🎨 Theme •";
  }
  btn.addEventListener("click", () => { expanded = true; render(); });
  return btn;
}

function header(): HTMLElement {
  const bar = document.createElement("div");
  bar.style.cssText = `
    display: flex; align-items: center; gap: 8px; padding: 10px 12px;
    border-bottom: 1px solid ${COLORS.border};
  `;
  const title = document.createElement("span");
  title.textContent = "Theme";
  title.style.cssText = `font: 600 13px/1 ${FONT_FAMILY}; color: ${COLORS.textPrimary}; flex: 0 0 auto;`;
  bar.appendChild(title);

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
    b.addEventListener("click", () => { setMode(m); render(); });
    seg.appendChild(b);
  }
  bar.appendChild(seg);

  const close = document.createElement("button");
  close.textContent = "✕";
  close.title = "Collapse";
  close.style.cssText = `border: none; background: transparent; cursor: pointer; color: ${COLORS.textTertiary}; font-size: 13px; padding: 2px 4px;`;
  close.addEventListener("click", () => { expanded = false; render(); });
  bar.appendChild(close);
  return bar;
}

function tokenList(): HTMLElement {
  const list = document.createElement("div");
  list.style.cssText = `overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px;`;

  const source = getSource();
  if (source) {
    const src = document.createElement("div");
    src.textContent = source.filePath.split("/").slice(-2).join("/");
    src.title = source.filePath;
    src.style.cssText = `font: 400 10px/1.4 ${FONT_FAMILY}; color: ${COLORS.textTertiary}; padding: 2px 4px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    list.appendChild(src);
  }

  for (const name of getTokenNames()) {
    const value = getValue(name) ?? "";
    list.appendChild(tokenRow(name, value));
  }
  return list;
}

function tokenRow(name: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 3px 4px; border-radius: ${RADII.xs};`;

  const checker = "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px";
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
  row.appendChild(swatch);

  const label = document.createElement("span");
  label.textContent = name;
  label.title = name;
  label.style.cssText = `flex: 1 1 auto; font: 500 11px/1.2 ${FONT_FAMILY}; color: ${isEdited(name) ? COLORS.accent : COLORS.textSecondary}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
  row.appendChild(label);

  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.spellcheck = false;
  input.style.cssText = `
    flex: 0 0 96px; width: 96px; padding: 3px 6px; font: 400 11px/1.2 ui-monospace, monospace;
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
  input.addEventListener("focus", () => { input.style.borderColor = COLORS.accent; });
  input.addEventListener("blur", () => { input.style.borderColor = COLORS.border; });
  row.appendChild(input);

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
        onClose: () => {},
      });
    });
  }
  return row;
}

let applyBtn: HTMLButtonElement | null = null;
let resetBtn: HTMLButtonElement | null = null;

function footer(): HTMLElement {
  const bar = document.createElement("div");
  bar.style.cssText = `display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid ${COLORS.border};`;

  resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = `
    flex: 0 0 auto; padding: 6px 12px; font: 500 12px/1 ${FONT_FAMILY};
    color: ${COLORS.textSecondary}; background: ${COLORS.bgSecondary};
    border: 1px solid ${COLORS.border}; border-radius: ${RADII.sm}; cursor: pointer;
  `;
  resetBtn.addEventListener("click", () => { resetPreview(); render(); });
  bar.appendChild(resetBtn);

  applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.style.cssText = `
    flex: 1 1 auto; padding: 6px 12px; font: 600 12px/1 ${FONT_FAMILY};
    color: ${COLORS.textOnAccent}; background: ${COLORS.accent};
    border: none; border-radius: ${RADII.sm}; cursor: pointer; transition: ${TRANSITIONS.fast};
  `;
  applyBtn.addEventListener("click", () => { commit(); });
  bar.appendChild(applyBtn);
  updateFooter();
  return bar;
}

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

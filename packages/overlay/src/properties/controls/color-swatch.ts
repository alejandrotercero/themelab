import type { PropertyDescriptor } from "@themelab/shared";

import { openColorPicker, closeColorPicker } from "../../color-picker.js";
import { PANEL, FONT_MONO, RADII, SHADOWS } from "../../design-tokens.js";
import {
  hasTheme,
  getColorTokenNames,
  getValue as getThemeValue,
} from "../../theme-state.js";
import { toRenderableCss } from "../../utils/color-format.js";
import {
  openTailwindPalette,
  closeTailwindPalette,
  isTailwindPaletteOpen,
  tailwindLogoSvg,
} from "../tailwind-palette.js";
import { getTokenMap, resolveTokenForValue } from "../tailwind-resolver.js";
import type {
  PropertyControl,
  OnPreview,
  OnCommit,
  ControlContext,
} from "./types.js";

let _colorCtx: CanvasRenderingContext2D | null = null;
function getColorCtx(): CanvasRenderingContext2D {
  if (!_colorCtx) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable");
    }
    _colorCtx = ctx;
  }
  return _colorCtx;
}

export function createColorSwatch(
  descriptors: PropertyDescriptor[],
  values: Map<string, string>,
  onPreview: OnPreview,
  onCommit: OnCommit,
  ctx?: ControlContext
): PropertyControl {
  const [descriptor] = descriptors;
  const prefix = descriptor.tailwindPrefix ?? "bg";

  const container = document.createElement("div");
  container.style.cssText = `display:flex; align-items:center; gap:6px; position:relative;`;

  const swatch = document.createElement("div");
  swatch.style.cssText = `
    width:20px;
    height:20px;
    border-radius:${RADII.xs};
    border:1px solid ${PANEL.border};
    cursor:pointer;
    flex-shrink:0;
  `
    .trim()
    .replaceAll(/\n\s*/g, " ");

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "#rrggbb";
  input.className = "prop-input";
  input.style.cssText = `flex:1; min-width:0;`;

  const tokenLabel = document.createElement("span");
  tokenLabel.style.cssText = `font-size:11px; color:${PANEL.accent}; font-family:${FONT_MONO}; white-space:nowrap;`;

  // "Bind to theme variable" trigger — only shown when a theme is loaded and the
  // controller gave us a bind callback.
  const varsBtn = document.createElement("button");
  varsBtn.textContent = "var";
  varsBtn.title = "Bind to a theme variable";
  varsBtn.style.cssText = `
    flex-shrink:0; padding:3px 7px; font:400 11px/1 ${FONT_MONO};
    color:${PANEL.accent}; background:transparent;
    border:1px solid ${PANEL.border}; border-radius:${RADII.xs}; cursor:pointer;
  `
    .trim()
    .replaceAll(/\n\s*/g, " ");
  const canBind = hasTheme() && !!ctx?.onBindToken;
  if (!canBind) {
    varsBtn.style.display = "none";
  }

  // Tailwind palette trigger (swoosh logo) — opens the full TW v4 picker.
  const twBtn = document.createElement("button");
  twBtn.title = "Pick a Tailwind color";
  twBtn.innerHTML = tailwindLogoSvg(14);
  twBtn.style.cssText = `
    flex-shrink:0; display:flex; align-items:center; justify-content:center;
    width:24px; height:22px; background:transparent;
    border:1px solid ${PANEL.border}; border-radius:${RADII.xs}; cursor:pointer;
  `
    .trim()
    .replaceAll(/\n\s*/g, " ");
  const canPickTw = !!ctx?.onPickTailwind;
  if (!canPickTw) {
    twBtn.style.display = "none";
  }

  container.append(swatch);
  container.append(input);
  container.append(tokenLabel);
  container.append(varsBtn);
  container.append(twBtn);

  let currentValue = values.get(descriptor.key) ?? descriptor.defaultValue;
  let currentScaleToken: string | null = null; // resolved Tailwind token (e.g. "red-500")
  let pickerOpen = false;
  let varMenu: HTMLDivElement | null = null;

  /** Find which theme token (if any) the selected element's class binds this
   *  property to — e.g. `bg-primary` → "primary". */
  function detectBoundToken(className?: string): string | null {
    if (!className || !hasTheme()) {
      return null;
    }
    const tokens = new Set(getColorTokenNames());
    for (const cls of className.split(/\s+/)) {
      const bare = cls.includes(":")
        ? cls.slice(cls.lastIndexOf(":") + 1)
        : cls;
      const [core] = bare.split("/"); // strip opacity modifier (bg-primary/50)
      if (core.startsWith(`${prefix}-`)) {
        const token = core.slice(prefix.length + 1);
        if (tokens.has(token)) {
          return token;
        }
      }
    }
    return null;
  }

  let boundToken: string | null = detectBoundToken(ctx?.selectedClassName);

  function cssColorToHex(cssValue: string): string {
    const v = cssValue.trim().toLowerCase();
    if (v === "transparent") {
      return "transparent";
    }
    if (v === "inherit" || v === "currentcolor" || v === "unset") {
      return "#000000";
    }
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) {
      return v;
    }
    // Canvas normalization — handles rgb(), hsl(), named colors, space syntax
    const ctxc = getColorCtx();
    ctxc.fillStyle = "#000000";
    ctxc.fillStyle = v;
    const result = ctxc.fillStyle;
    if (result.startsWith("#")) {
      return result;
    }
    const m = result.match(/rgba?\((?<r>\d+),\s*(?<g>\d+),\s*(?<b>\d+)/);
    if (m?.groups) {
      const r = Math.trunc(Number(m.groups.r));
      const g = Math.trunc(Number(m.groups.g));
      const b = Math.trunc(Number(m.groups.b));
      // oxlint-disable-next-line no-bitwise -- intentional RGB byte packing into a hex string
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
    return "#000000";
  }

  function updateDisplay(cssValue: string): void {
    currentValue = cssValue;

    // Bound to a theme variable → surface the token, not the raw rgba.
    if (boundToken) {
      const themeVal = getThemeValue(boundToken);
      const renderable = themeVal ? toRenderableCss(themeVal) : null;
      swatch.style.background = renderable ?? cssValue;
      input.value = `var(--${boundToken})`;
      tokenLabel.textContent = `🔗 ${boundToken}`;
      tokenLabel.style.color = PANEL.accent;
      return;
    }

    input.value = cssValue;
    tokenLabel.style.color = PANEL.accent;
    swatch.style.background =
      cssValue === "transparent"
        ? `repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 10px 10px`
        : cssValue;

    // Resolve Tailwind color token (scale tokens like red-500)
    try {
      const tokenMap = getTokenMap();
      const token = resolveTokenForValue(cssValue, tokenMap.colorsReverse);
      currentScaleToken = token ?? null;
      tokenLabel.textContent = token ? `${prefix}-${token}` : "";
    } catch {
      currentScaleToken = null;
      tokenLabel.textContent = "";
    }
  }

  /** Detach from any theme binding (user picked a raw color). */
  function detach(): void {
    boundToken = null;
  }

  function commitValue(): void {
    if (pickerOpen) {
      return;
    } // Don't commit on blur if picker is open
    const raw = input.value.trim();
    if (!raw || raw.startsWith("var(")) {
      updateDisplay(currentValue);
      return;
    }
    detach();
    const normalized = cssColorToHex(raw);
    updateDisplay(normalized);
    onPreview(descriptor.key, normalized);
    onCommit();
  }

  // closeVarMenu and onDocMouseDown call each other (mutual recursion via the
  // document listener lifecycle), so one forward reference is unavoidable —
  // both are function declarations and hoist within this scope, so this is
  // safe at runtime.
  function closeVarMenu(): void {
    varMenu?.remove();
    varMenu = null;
    // oxlint-disable-next-line no-use-before-define -- mutual reference with onDocMouseDown; both are hoisted function declarations
    document.removeEventListener("mousedown", onDocMouseDown, true);
  }

  function onDocMouseDown(e: MouseEvent): void {
    if (!varMenu) {
      return;
    }
    // The menu lives in the Shadow DOM, so a document-level listener sees a
    // retargeted e.target (the shadow host) — varMenu.contains() would always be
    // false and close the menu before a row click registers. composedPath()
    // pierces the shadow boundary and contains the real clicked node.
    const path = e.composedPath();
    if (!path.includes(varMenu) && !path.includes(varsBtn)) {
      closeVarMenu();
    }
  }

  function makeVarRow(name: string): HTMLButtonElement {
    const row = document.createElement("button");
    const val = getThemeValue(name);
    const renderable = val ? toRenderableCss(val) : null;
    row.style.cssText = `
        display:flex; align-items:center; gap:8px; width:100%; padding:5px 6px;
        border:none; background:${name === boundToken ? PANEL.surface : "transparent"};
        border-radius:${RADII.xs}; cursor:pointer; text-align:left;
        font:400 11px/1.2 ${FONT_MONO}; color:${PANEL.text};
      `
      .trim()
      .replaceAll(/\n\s*/g, " ");
    const sw = document.createElement("span");
    sw.style.cssText = `flex:0 0 auto; width:14px; height:14px; border-radius:3px; border:1px solid ${PANEL.border}; background:${renderable ?? "transparent"};`;
    const label = document.createElement("span");
    label.textContent = name;
    label.style.cssText = `flex:1 1 auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
    row.append(sw);
    row.append(label);
    row.addEventListener("mouseenter", () => {
      row.style.background = PANEL.surface;
    });
    row.addEventListener("mouseleave", () => {
      row.style.background =
        name === boundToken ? PANEL.surface : "transparent";
    });
    row.addEventListener("click", () => {
      boundToken = name;
      updateDisplay(currentValue);
      ctx?.onBindToken?.(descriptor.key, name);
      closeVarMenu();
    });
    return row;
  }

  function openVarMenu(): void {
    if (varMenu) {
      closeVarMenu();
      return;
    }
    const names = getColorTokenNames();
    if (names.length === 0) {
      return;
    }

    varMenu = document.createElement("div");
    varMenu.style.cssText = `
      position:absolute; top:26px; right:0; z-index:2147483647;
      width:200px; max-height:260px; overflow-y:auto;
      background:${PANEL.bg}; border:1px solid ${PANEL.border};
      border-radius:${RADII.xs}; box-shadow:${SHADOWS.lg}; padding:4px;
    `
      .trim()
      .replaceAll(/\n\s*/g, " ");

    for (const name of names) {
      varMenu.append(makeVarRow(name));
    }

    container.append(varMenu);
    document.addEventListener("mousedown", onDocMouseDown, true);
  }

  varsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openVarMenu();
  });

  // Tailwind palette: open the picker; on pick, write the token class.
  twBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isTailwindPaletteOpen()) {
      closeTailwindPalette();
      return;
    }
    const root = container.getRootNode();
    const mount = (root instanceof ShadowRoot ? root : document.body) as
      | ShadowRoot
      | HTMLElement;
    openTailwindPalette({
      anchorRect: twBtn.getBoundingClientRect(),
      anchorEl: twBtn,
      mount,
      currentToken: currentScaleToken,
      onPick: (token, css) => {
        // Detach any theme binding — this is a raw scale color now.
        boundToken = null;
        currentValue = css;
        currentScaleToken = token;
        swatch.style.background = css;
        input.value = css;
        tokenLabel.textContent = `${prefix}-${token}`;
        tokenLabel.style.color = PANEL.accent;
        ctx?.onPickTailwind?.(descriptor.key, token, css);
      },
    });
  });

  function resolveInitialColor(): string {
    if (!boundToken) {
      return currentValue;
    }
    const themeVal = getThemeValue(boundToken);
    if (!themeVal) {
      return currentValue;
    }
    return toRenderableCss(themeVal) ?? currentValue;
  }

  // Swatch click — open color picker (this detaches from any theme binding)
  swatch.addEventListener("click", () => {
    if (pickerOpen) {
      closeColorPicker();
      pickerOpen = false;
      return;
    }

    const rect = swatch.getBoundingClientRect();
    pickerOpen = true;

    openColorPicker({
      initialColor: cssColorToHex(resolveInitialColor()),
      position: { x: rect.left - 210, y: rect.top },
      showPropertyToggle: false,
      onColorChange: (hex: string) => {
        detach();
        updateDisplay(hex);
        onPreview(descriptor.key, hex);
      },
      onClose: () => {
        pickerOpen = false;
        onCommit();
      },
    });
  });

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      commitValue();
      input.blur();
    } else if (e.key === "Escape") {
      updateDisplay(currentValue);
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    commitValue();
  });

  input.addEventListener("input", () => {
    // Live preview while typing if the value looks like a valid color
    const raw = input.value.trim();
    if (raw.startsWith("var(")) {
      return;
    }
    const normalized = cssColorToHex(raw);
    swatch.style.background = normalized;
  });

  updateDisplay(currentValue);

  return {
    element: container,
    setValue(key: string, cssValue: string): void {
      if (key !== descriptor.key) {
        return;
      }
      updateDisplay(cssValue);
    },
    destroy(): void {
      closeVarMenu();
      closeTailwindPalette();
      if (pickerOpen) {
        closeColorPicker();
        pickerOpen = false;
      }
    },
  };
}

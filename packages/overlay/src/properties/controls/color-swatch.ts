import type { PropertyDescriptor } from "@react-rewrite/shared";
import type { PropertyControl, OnPreview, OnCommit, ControlContext } from "./types.js";
import { COLORS, FONT_FAMILY, RADII, SHADOWS } from "../../design-tokens.js";
import { openColorPicker, closeColorPicker } from "../../color-picker.js";
import { getTokenMap, resolveTokenForValue } from "../tailwind-resolver.js";
import { hasTheme, getColorTokenNames, getValue as getThemeValue } from "../../theme-state.js";
import { toRenderableCss } from "../../utils/color-format.js";

let _colorCtx: CanvasRenderingContext2D | null = null;
function getColorCtx(): CanvasRenderingContext2D {
  if (!_colorCtx) {
    _colorCtx = document.createElement("canvas").getContext("2d")!;
  }
  return _colorCtx;
}

export function createColorSwatch(
  descriptors: PropertyDescriptor[],
  values: Map<string, string>,
  onPreview: OnPreview,
  onCommit: OnCommit,
  ctx?: ControlContext,
): PropertyControl {
  const descriptor = descriptors[0];
  const prefix = descriptor.tailwindPrefix ?? "bg";

  const container = document.createElement("div");
  container.style.cssText = `display:flex; align-items:center; gap:6px; position:relative;`;

  const swatch = document.createElement("div");
  swatch.style.cssText = `
    width:20px;
    height:20px;
    border-radius:${RADII.sm};
    border:1px solid ${COLORS.borderStrong};
    cursor:pointer;
    flex-shrink:0;
  `.trim().replace(/\n\s*/g, " ");

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "#rrggbb";
  input.className = "prop-input";
  input.style.cssText = `flex:1; min-width:0;`;

  const tokenLabel = document.createElement("span");
  tokenLabel.style.cssText = `font-size:10px; color:${COLORS.textSecondary}; font-family:${FONT_FAMILY}; white-space:nowrap;`;

  // "Bind to theme variable" trigger — only shown when a theme is loaded and the
  // controller gave us a bind callback.
  const varsBtn = document.createElement("button");
  varsBtn.textContent = "var";
  varsBtn.title = "Bind to a theme variable";
  varsBtn.style.cssText = `
    flex-shrink:0; padding:2px 6px; font:600 10px/1 ${FONT_FAMILY};
    color:${COLORS.textSecondary}; background:${COLORS.bgSecondary};
    border:1px solid ${COLORS.border}; border-radius:${RADII.xs}; cursor:pointer;
  `.trim().replace(/\n\s*/g, " ");
  const canBind = hasTheme() && !!ctx?.onBindToken;
  if (!canBind) varsBtn.style.display = "none";

  container.appendChild(swatch);
  container.appendChild(input);
  container.appendChild(tokenLabel);
  container.appendChild(varsBtn);

  let currentValue = values.get(descriptor.key) ?? descriptor.defaultValue;
  let pickerOpen = false;
  let varMenu: HTMLDivElement | null = null;

  /** Find which theme token (if any) the selected element's class binds this
   *  property to — e.g. `bg-primary` → "primary". */
  function detectBoundToken(className?: string): string | null {
    if (!className || !hasTheme()) return null;
    const tokens = new Set(getColorTokenNames());
    for (const cls of className.split(/\s+/)) {
      const bare = cls.includes(":") ? cls.slice(cls.lastIndexOf(":") + 1) : cls;
      const core = bare.split("/")[0]; // strip opacity modifier (bg-primary/50)
      if (core.startsWith(prefix + "-")) {
        const token = core.slice(prefix.length + 1);
        if (tokens.has(token)) return token;
      }
    }
    return null;
  }

  let boundToken: string | null = detectBoundToken(ctx?.selectedClassName);

  function cssColorToHex(cssValue: string): string {
    const v = cssValue.trim().toLowerCase();
    if (v === "transparent") return "transparent";
    if (v === "inherit" || v === "currentcolor" || v === "unset") return "#000000";
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
    // Canvas normalization — handles rgb(), hsl(), named colors, space syntax
    const ctxc = getColorCtx();
    ctxc.fillStyle = "#000000";
    ctxc.fillStyle = v;
    const result = ctxc.fillStyle;
    if (result.startsWith("#")) return result;
    const m = result.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1], 10);
      const g = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
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
      tokenLabel.style.color = COLORS.accent;
      return;
    }

    input.value = cssValue;
    tokenLabel.style.color = COLORS.textSecondary;
    if (cssValue === "transparent") {
      swatch.style.background = `repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 10px 10px`;
    } else {
      swatch.style.background = cssValue;
    }

    // Resolve Tailwind color token (scale tokens like red-500)
    try {
      const tokenMap = getTokenMap();
      const token = resolveTokenForValue(cssValue, tokenMap.colorsReverse);
      tokenLabel.textContent = token ? `${prefix}-${token}` : "";
    } catch {
      tokenLabel.textContent = "";
    }
  }

  /** Detach from any theme binding (user picked a raw color). */
  function detach(): void {
    boundToken = null;
  }

  function commitValue(): void {
    if (pickerOpen) return; // Don't commit on blur if picker is open
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

  function closeVarMenu(): void {
    varMenu?.remove();
    varMenu = null;
    document.removeEventListener("mousedown", onDocMouseDown, true);
  }

  function onDocMouseDown(e: MouseEvent): void {
    if (!varMenu) return;
    // The menu lives in the Shadow DOM, so a document-level listener sees a
    // retargeted e.target (the shadow host) — varMenu.contains() would always be
    // false and close the menu before a row click registers. composedPath()
    // pierces the shadow boundary and contains the real clicked node.
    const path = e.composedPath();
    if (!path.includes(varMenu) && !path.includes(varsBtn)) {
      closeVarMenu();
    }
  }

  function openVarMenu(): void {
    if (varMenu) { closeVarMenu(); return; }
    const names = getColorTokenNames();
    if (names.length === 0) return;

    varMenu = document.createElement("div");
    varMenu.style.cssText = `
      position:absolute; top:26px; right:0; z-index:2147483647;
      width:200px; max-height:260px; overflow-y:auto;
      background:${COLORS.bgPrimary}; border:1px solid ${COLORS.border};
      border-radius:${RADII.sm}; box-shadow:${SHADOWS.lg}; padding:4px;
    `.trim().replace(/\n\s*/g, " ");

    for (const name of names) {
      const row = document.createElement("button");
      const val = getThemeValue(name);
      const renderable = val ? toRenderableCss(val) : null;
      row.style.cssText = `
        display:flex; align-items:center; gap:8px; width:100%; padding:5px 6px;
        border:none; background:${name === boundToken ? COLORS.bgTertiary : "transparent"};
        border-radius:${RADII.xs}; cursor:pointer; text-align:left;
        font:500 11px/1.2 ${FONT_FAMILY}; color:${COLORS.textPrimary};
      `.trim().replace(/\n\s*/g, " ");
      const sw = document.createElement("span");
      sw.style.cssText = `flex:0 0 auto; width:14px; height:14px; border-radius:3px; border:1px solid ${COLORS.border}; background:${renderable ?? "transparent"};`;
      const label = document.createElement("span");
      label.textContent = name;
      label.style.cssText = `flex:1 1 auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
      row.appendChild(sw);
      row.appendChild(label);
      row.addEventListener("mouseenter", () => { row.style.background = COLORS.bgTertiary; });
      row.addEventListener("mouseleave", () => { row.style.background = name === boundToken ? COLORS.bgTertiary : "transparent"; });
      row.addEventListener("click", () => {
        boundToken = name;
        updateDisplay(currentValue);
        ctx?.onBindToken?.(descriptor.key, name);
        closeVarMenu();
      });
      varMenu.appendChild(row);
    }

    container.appendChild(varMenu);
    document.addEventListener("mousedown", onDocMouseDown, true);
  }

  varsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openVarMenu();
  });

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
      initialColor: cssColorToHex(boundToken ? (getThemeValue(boundToken) ? toRenderableCss(getThemeValue(boundToken)!) ?? currentValue : currentValue) : currentValue),
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
    if (raw.startsWith("var(")) return;
    const normalized = cssColorToHex(raw);
    swatch.style.background = normalized;
  });

  updateDisplay(currentValue);

  return {
    element: container,
    setValue(key: string, cssValue: string): void {
      if (key !== descriptor.key) return;
      updateDisplay(cssValue);
    },
    destroy(): void {
      closeVarMenu();
      if (pickerOpen) {
        closeColorPicker();
        pickerOpen = false;
      }
    },
  };
}

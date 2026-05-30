import type { PropertyDescriptor } from "@react-rewrite/shared";
import type { PropertyControl, OnPreview, OnCommit } from "./types.js";
import { PANEL, FONT_MONO, RADII, TRANSITIONS } from "../../design-tokens.js";
import { alignIcon } from "./align-icons.js";

// DevTools-style alignment picker: a "css-property: value" header above a
// full-width row of icon buttons. Used for justify-content / align-items /
// align-content (each option carries an alignment-diagram icon).
export function createAlignSegmented(
  descriptors: PropertyDescriptor[],
  values: Map<string, string>,
  onPreview: OnPreview,
  onCommit: OnCommit,
): PropertyControl {
  const descriptor = descriptors[0];
  const enumValues = descriptor.enumValues ?? [];
  // Orient the icons to the container's flex-direction (row vs column).
  const flexDirection = values.get("flexDirection") ?? "row";

  const root = document.createElement("div");
  root.style.cssText = `display:flex; flex-direction:column; gap:6px;`;

  // Header: "justify-content: center"
  const header = document.createElement("div");
  header.style.cssText = `display:flex; align-items:baseline; gap:6px; font-family:${FONT_MONO}; font-size:11px; line-height:1;`;
  const propEl = document.createElement("span");
  propEl.textContent = `${descriptor.cssProperty}:`;
  propEl.style.cssText = `color:${PANEL.textDim};`;
  const valEl = document.createElement("span");
  valEl.style.cssText = `color:${PANEL.text};`;
  header.appendChild(propEl);
  header.appendChild(valEl);

  // Icon row
  const rowEl = document.createElement("div");
  rowEl.style.cssText = `display:flex; gap:2px; background:${PANEL.surface}; border:1px solid ${PANEL.border}; border-radius:${RADII.xs}; padding:2px;`;

  let activeValue = values.get(descriptor.key) ?? descriptor.defaultValue;
  const buttons: Array<{ btn: HTMLButtonElement; value: string }> = [];

  function setActive(cssValue: string): void {
    activeValue = cssValue;
    const opt = enumValues.find((o) => o.value === cssValue);
    valEl.textContent = opt ? opt.value : cssValue;
    for (const { btn, value } of buttons) {
      const on = value === cssValue;
      btn.style.background = on ? PANEL.btnBg : "transparent";
      btn.style.color = on ? "#ffffff" : PANEL.textDim;
    }
  }

  for (const opt of enumValues) {
    const btn = document.createElement("button");
    btn.innerHTML = alignIcon(descriptor.cssProperty, opt.value, flexDirection);
    btn.title = `${opt.label} (${opt.value})`;
    btn.style.cssText = `
      flex:1 1 0; min-width:0; height:24px; display:flex; align-items:center;
      justify-content:center; padding:0; border:none; border-radius:${RADII.xs};
      background:transparent; color:${PANEL.textDim}; cursor:pointer;
      transition:background ${TRANSITIONS.fast}, color ${TRANSITIONS.fast};
    `.trim().replace(/\n\s*/g, " ");
    btn.addEventListener("click", () => {
      setActive(opt.value);
      onPreview(descriptor.key, opt.value);
      onCommit();
    });
    buttons.push({ btn, value: opt.value });
    rowEl.appendChild(btn);
  }

  setActive(activeValue);

  root.appendChild(header);
  root.appendChild(rowEl);

  return {
    element: root,
    setValue(key: string, cssValue: string): void {
      if (key !== descriptor.key) return;
      setActive(cssValue);
    },
    destroy(): void {
      // No document-level listeners.
    },
  };
}

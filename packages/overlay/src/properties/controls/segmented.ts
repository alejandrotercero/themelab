import type { PropertyDescriptor } from "@react-rewrite/shared";
import type { PropertyControl, OnPreview, OnCommit } from "./types.js";
import { PANEL, FONT_MONO, RADII } from "../../design-tokens.js";

export function createSegmented(
  descriptors: PropertyDescriptor[],
  values: Map<string, string>,
  onPreview: OnPreview,
  onCommit: OnCommit,
): PropertyControl {
  const descriptor = descriptors[0];
  const enumValues = descriptor.enumValues ?? [];

  const container = document.createElement("div");
  container.style.cssText = `
    display:flex;
    align-items:center;
    gap:2px;
    background:${PANEL.surface};
    border:1px solid ${PANEL.border};
    border-radius:${RADII.xs};
    padding:2px;
    flex-wrap:wrap;
  `.trim().replace(/\n\s*/g, " ");

  let activeValue = values.get(descriptor.key) ?? descriptor.defaultValue;

  const buttons: Array<{ btn: HTMLButtonElement; value: string; opt: typeof enumValues[number] }> = [];

  function setActiveButton(cssValue: string): void {
    activeValue = cssValue;
    for (const { btn, value, opt } of buttons) {
      const isActive = value === cssValue;
      btn.style.background = isActive ? PANEL.btnBg : "transparent";
      btn.style.color = isActive ? "#ffffff" : PANEL.textDim;
      // Show Tailwind class as tooltip on the active segment
      btn.title = isActive && opt.tailwindValue
        ? `${opt.label} (${opt.tailwindValue})`
        : opt.label;
    }
  }

  for (const opt of enumValues) {
    const btn = document.createElement("button");
    btn.style.cssText = `
      display:flex;
      align-items:center;
      justify-content:center;
      padding:3px 8px;
      border:none;
      border-radius:${RADII.xs};
      font-family:${FONT_MONO};
      font-size:12px;
      cursor:pointer;
      background:transparent;
      color:${PANEL.textDim};
      min-width:20px;
      transition:background 100ms ease, color 100ms ease;
      white-space:nowrap;
    `.trim().replace(/\n\s*/g, " ");

    btn.textContent = opt.icon ?? opt.label;
    btn.title = opt.label;

    btn.addEventListener("click", () => {
      setActiveButton(opt.value);
      onPreview(descriptor.key, opt.value);
      onCommit();
    });

    buttons.push({ btn, value: opt.value, opt });
    container.appendChild(btn);
  }

  setActiveButton(activeValue);

  return {
    element: container,
    setValue(key: string, cssValue: string): void {
      if (key !== descriptor.key) return;
      setActiveButton(cssValue);
    },
    destroy(): void {
      // No document-level listeners to clean up
    },
  };
}

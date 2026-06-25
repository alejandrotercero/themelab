// packages/overlay/src/properties/controls/scale-shortcut.ts
//
// A one-click popover that lists a Tailwind scale (e.g. the typography scale
// text-xs … text-9xl) as token rows, each with its resolved px. Clicking a row
// applies that token through the same onPreview/onCommit path the number-scrub
// uses — so the active variant target (Base / md: / dark:) is honored
// automatically by the commit pipeline in property-controller.
//
// Modeled on the Tailwind color palette picker (tailwind-palette.ts). Built to be
// generic over any `tailwindScale` but wired up for font size today.

import type { PropertyDescriptor } from "@themelab/shared";
import type { OnPreview, OnCommit } from "./types.js";
import { getSnapPoints, type SnapPoint } from "../tailwind-resolver.js";
import { getTokenMap } from "../tailwind-resolver.js";
import { PANEL, FONT_MONO, RADII, SHADOWS } from "../../design-tokens.js";

export function createScaleShortcutButton(
  descriptor: PropertyDescriptor,
  onPreview: OnPreview,
  onCommit: OnCommit,
): { button: HTMLButtonElement; destroy: () => void } {
  const scaleName = descriptor.tailwindScale as Parameters<typeof getSnapPoints>[0];

  const button = document.createElement("button");
  button.type = "button";
  button.className = "prop-scale-shortcut-btn";
  button.title = `Pick from the ${descriptor.tailwindPrefix} scale`;
  button.setAttribute("aria-label", `Pick from the ${descriptor.tailwindPrefix} scale`);
  button.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="3,5 6,2 9,5"/><polyline points="3,7 6,10 9,7"/></svg>`;
  Object.assign(button.style, {
    flexShrink: "0",
    width: "20px",
    height: "20px",
    border: `1px solid ${PANEL.border}`,
    borderRadius: RADII.xs,
    background: PANEL.surface,
    color: PANEL.textDim,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
  } as Partial<CSSStyleDeclaration>);

  let popover: HTMLDivElement | null = null;
  let outsideClick: ((e: MouseEvent) => void) | null = null;

  function closePopover(): void {
    if (popover) {
      popover.remove();
      popover = null;
    }
    if (outsideClick) {
      document.removeEventListener("mousedown", outsideClick, true);
      outsideClick = null;
    }
  }

  function openPopover(): void {
    closePopover();

    popover = document.createElement("div");
    Object.assign(popover.style, {
      position: "fixed",
      zIndex: "2147483646",
      background: PANEL.bg,
      border: `1px solid ${PANEL.border}`,
      borderRadius: RADII.sm,
      boxShadow: SHADOWS.lg,
      fontFamily: FONT_MONO,
      fontSize: "11px",
      color: PANEL.text,
      padding: "4px",
      maxHeight: "260px",
      overflowY: "auto",
      minWidth: "150px",
    } as Partial<CSSStyleDeclaration>);

    // Build rows from the scale's snap points (token → cssValue, sorted).
    const points = getSnapPoints(scaleName, "0", getTokenMap());
    for (const point of points) {
      if (!point.token) continue; // arbitrary current value — no token to offer
      const row = document.createElement("button");
      row.type = "button";
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        width: "100%",
        border: "none",
        background: "transparent",
        color: PANEL.text,
        fontFamily: FONT_MONO,
        fontSize: "11px",
        padding: "4px 6px",
        borderRadius: RADII.xs,
        cursor: "pointer",
        whiteSpace: "nowrap",
      } as Partial<CSSStyleDeclaration>);

      const label = document.createElement("span");
      label.textContent = `${descriptor.tailwindPrefix}-${point.token}`;
      const px = document.createElement("span");
      px.style.color = PANEL.textDim;
      px.textContent = point.cssValue;
      row.appendChild(label);
      row.appendChild(px);

      row.addEventListener("mouseenter", () => {
        row.style.background = PANEL.surface;
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        onPreview(descriptor.key, point.cssValue);
        onCommit();
        closePopover();
      });

      popover.appendChild(row);
    }

    // Mount INSIDE the overlay's shadow root (not document.body), so selection.ts's
    // document-level mousedown handler sees `#themelab-root` in the event's
    // composedPath and ignores the click — otherwise clicking a row reads as a
    // page click and deselects the element / closes the sidebar.
    const root = button.getRootNode();
    const mount = (root instanceof ShadowRoot ? root : document.body) as ShadowRoot | HTMLElement;
    mount.appendChild(popover);
    const rect = button.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.right - popover.offsetWidth;
    // Flip up if it would overflow the bottom of the viewport.
    if (top + popover.offsetHeight > window.innerHeight) {
      top = Math.max(4, rect.top - popover.offsetHeight - 4);
    }
    if (left < 4) left = 4;
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    outsideClick = (e: MouseEvent) => {
      // composedPath() pierces the shadow boundary — a document-level listener
      // otherwise sees a retargeted target (the shadow host) and would always
      // think the click was "outside", closing before a row click registers.
      const path = e.composedPath();
      if (popover && !path.includes(popover) && !path.includes(button)) {
        closePopover();
      }
    };
    // Defer so the opening click doesn't immediately close it. Capture phase so we
    // see the click even if a row stops propagation.
    setTimeout(() => {
      if (outsideClick) document.addEventListener("mousedown", outsideClick, true);
    }, 0);
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popover) closePopover();
    else openPopover();
  });

  return {
    button,
    destroy: closePopover,
  };
}

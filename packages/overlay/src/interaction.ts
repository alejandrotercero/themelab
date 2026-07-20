// packages/overlay/src/interaction.ts

import { getActiveTool } from "./canvas-state.js";
import { handleWheelZoom, panCanvas } from "./canvas-transform.js";
import { isEditableFocused } from "./utils/active-element.js";
import { isOverlayLikeElement } from "./utils/component-filter.js";
import {
  getCachedElement,
  setCachedElement,
  clearElementCache,
} from "./utils/element-cache.js";

export interface ToolEventHandler {
  onMouseDown?: (e: MouseEvent) => void | Promise<void>;
  onMouseMove?: (e: MouseEvent) => void;
  onMouseUp?: (e: MouseEvent) => void | Promise<void>;
}

let interactionEl: HTMLDivElement | null = null;
let activeHandler: ToolEventHandler | null = null;
const toolHandlers = new Map<string, ToolEventHandler>();

let isPanning = false;
let panLastX = 0;
let panLastY = 0;
let prePanCursor = "";

// inline-text-edit.js owns the "is a text edit in progress" flag but imports
// this module (for pointer-event control + hit-testing), so it registers its
// getter here instead of this module importing inline-text-edit.js — avoids
// an import cycle.
let isTextEditing: () => boolean = () => false;
export function registerIsTextEditing(fn: () => boolean): void {
  isTextEditing = fn;
}
/** Re-exported so other modules can query text-edit state without importing
 *  inline-text-edit.js directly (see registerIsTextEditing above). */
export function isTextEditingActive(): boolean {
  return isTextEditing();
}

export function registerToolHandler(
  tool: string,
  handler: ToolEventHandler
): void {
  toolHandlers.set(tool, handler);
}

function onWheel(e: WheelEvent): void {
  if (!interactionEl) {
    return;
  }
  // Only zoom on Ctrl/Cmd+scroll (standard pinch-to-zoom). Regular scroll passes through.
  if (!e.ctrlKey && !e.metaKey) {
    return;
  }
  const target = e.target as HTMLElement;
  if (target?.closest?.("#themelab-root")) {
    return;
  }
  handleWheelZoom(e);
}

function onSpaceDown(e: KeyboardEvent): void {
  if (e.key !== " ") {
    return;
  }
  // Don't intercept spacebar during text editing or when typing in inputs
  // (resolves focus through the overlay's shadow DOM).
  if (isTextEditing()) {
    return;
  }
  if (isEditableFocused()) {
    return;
  }

  e.preventDefault();
  if (!isPanning && interactionEl) {
    prePanCursor = interactionEl.style.cursor;
    interactionEl.style.cursor = "grab";
    interactionEl.style.pointerEvents = "auto";
    isPanning = true;
  }
}

function onSpaceUp(e: KeyboardEvent): void {
  if (e.key !== " ") {
    return;
  }
  if (!isPanning) {
    return;
  }
  e.preventDefault();
  isPanning = false;
  panLastX = 0;
  panLastY = 0;
  if (interactionEl) {
    interactionEl.style.cursor = prePanCursor;
    // Restore pointer-events based on current tool
    const tool = getActiveTool();
    interactionEl.style.pointerEvents = tool === "select" ? "none" : "auto";
  }
}

export function initInteraction(): void {
  interactionEl = document.createElement("div");
  interactionEl.dataset.themelabInteraction = "true";
  interactionEl.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2147483646;
    pointer-events: none;
  `;

  document.body.append(interactionEl);

  document.addEventListener("scroll", clearElementCache, true);

  interactionEl.addEventListener("mousedown", (e) => {
    if (isPanning) {
      panLastX = e.clientX;
      panLastY = e.clientY;
      if (interactionEl) {
        interactionEl.style.cursor = "grabbing";
      }
      e.preventDefault();
      return;
    }
    activeHandler?.onMouseDown?.(e);
  });
  interactionEl.addEventListener("mousemove", (e) => {
    if (isPanning && panLastX !== 0) {
      panCanvas(e.clientX - panLastX, e.clientY - panLastY);
      panLastX = e.clientX;
      panLastY = e.clientY;
      return;
    }
    activeHandler?.onMouseMove?.(e);
  });
  interactionEl.addEventListener("mouseup", (e) => {
    if (isPanning) {
      if (interactionEl) {
        interactionEl.style.cursor = "grab";
      }
      panLastX = 0;
      panLastY = 0;
      return;
    }
    activeHandler?.onMouseUp?.(e);
  });

  // Wheel zoom for infinite canvas (works on any tool)
  document.addEventListener("wheel", onWheel, { passive: false });

  document.addEventListener("keydown", onSpaceDown);
  document.addEventListener("keyup", onSpaceUp);
}

export function isPanningActive(): boolean {
  return isPanning;
}

function updateCursor(tool: string): void {
  if (!interactionEl) {
    return;
  }
  switch (tool) {
    case "select": {
      interactionEl.style.cursor = "default";
      break;
    }
    case "text": {
      interactionEl.style.cursor = "text";
      break;
    }
    default: {
      interactionEl.style.cursor = "default";
    }
  }
}

export function activateInteraction(tool: string): void {
  activeHandler = toolHandlers.get(tool) || null;
  if (interactionEl) {
    interactionEl.style.pointerEvents = tool === "select" ? "none" : "auto";
  }
  updateCursor(tool);
}

export function setInteractionCursor(cursor: string): void {
  if (interactionEl) {
    interactionEl.style.cursor = cursor;
  }
}

/** Temporarily disable/enable the interaction layer's pointer events.
 *  Used by color picker to prevent the interaction layer from stealing clicks. */
export function setInteractionPointerEvents(enabled: boolean): void {
  if (interactionEl) {
    interactionEl.style.pointerEvents = enabled ? "auto" : "none";
  }
}

/**
 * Find the actual page element at a viewport point, looking through all ThemeLab layers.
 * Uses elementsFromPoint to skip the interaction layer, shadow DOM host, and placeholder elements.
 */
export function getPageElementAtPoint(
  clientX: number,
  clientY: number
): HTMLElement | null {
  // Check cache first — avoids expensive elementsFromPoint on small mouse movements
  const cached = getCachedElement(clientX, clientY);
  if (cached !== undefined) {
    return cached;
  }

  const elements = document.elementsFromPoint(clientX, clientY);
  let result: HTMLElement | null = null;

  for (const el of elements) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    if (el.closest("#themelab-root")) {
      continue;
    }
    if (Object.hasOwn(el.dataset, "themelabInteraction")) {
      continue;
    }
    if (Object.hasOwn(el.dataset, "themelabPlaceholder")) {
      continue;
    }
    if (el === document.body || el === document.documentElement) {
      continue;
    }
    if (isOverlayLikeElement(el)) {
      continue;
    }
    result = el;
    break;
  }

  setCachedElement(clientX, clientY, result);
  return result;
}

export function destroyInteraction(): void {
  document.removeEventListener("scroll", clearElementCache, true);
  document.removeEventListener("wheel", onWheel);
  document.removeEventListener("keydown", onSpaceDown);
  document.removeEventListener("keyup", onSpaceUp);
  isPanning = false;
  interactionEl?.remove();
  interactionEl = null;
  activeHandler = null;
  toolHandlers.clear();
}

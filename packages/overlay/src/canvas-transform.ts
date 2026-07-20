// packages/overlay/src/canvas-transform.ts
// Manages the infinite canvas: wraps page content in a transform container,
// renders a dotted grid background, and handles zoom/pan updates.

import {
  getCanvasTransform,
  setCanvasTransform,
  onCanvasTransformChange,
} from "./canvas-state.js";
import { COLORS } from "./design-tokens.js";

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_SENSITIVITY = 0.002;
const DOT_SPACING = 24;
const DOT_RADIUS = 1;
const DOT_COLOR = "rgba(0,0,0,0.15)";

let wrapper: HTMLDivElement | null = null;
let dotBg: HTMLDivElement | null = null;
let unsubTransform: (() => void) | null = null;

// Track original body children so we can unwrap on destroy
let originalBodyChildren: Node[] = [];

// Wrapper change listeners — notified when wrapper is created or destroyed
type WrapperChangeListener = (wrapper: HTMLDivElement | null) => void;
let wrapperChangeListeners: WrapperChangeListener[] = [];

export function getCanvasWrapper(): HTMLDivElement | null {
  return wrapper;
}

export function onCanvasWrapperChange(fn: WrapperChangeListener): () => void {
  wrapperChangeListeners.push(fn);
  return () => {
    wrapperChangeListeners = wrapperChangeListeners.filter((f) => f !== fn);
  };
}

// Saved original backgrounds to restore on destroy
let savedBodyBg = "";
let savedHtmlBg = "";

function applyTransform(): void {
  if (!wrapper || !dotBg) {
    return;
  }
  const { scale, offsetX, offsetY } = getCanvasTransform();

  // Apply CSS transform to wrapper
  wrapper.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;

  // Update dotted background to match transform
  const dotSpacing = DOT_SPACING * scale;
  const bgX = offsetX % dotSpacing;
  const bgY = offsetY % dotSpacing;

  dotBg.style.backgroundImage = `radial-gradient(circle, ${DOT_COLOR} ${DOT_RADIUS}px, transparent ${DOT_RADIUS}px)`;
  dotBg.style.backgroundSize = `${dotSpacing}px ${dotSpacing}px`;
  dotBg.style.backgroundPosition = `${bgX}px ${bgY}px`;
}

/**
 * Initialize the infinite canvas.
 * - Wraps existing page content in a transform container
 * - Adds a dotted background layer
 * - Subscribes to canvas transform state changes
 */
export function initCanvasTransform(): void {
  // Save and clear body/html backgrounds so the dotted bg shows through
  savedBodyBg =
    document.body.style.background || document.body.style.backgroundColor || "";
  savedHtmlBg =
    document.documentElement.style.background ||
    document.documentElement.style.backgroundColor ||
    "";
  const computedBodyBg = getComputedStyle(document.body).backgroundColor;
  const computedHtmlBg = getComputedStyle(
    document.documentElement
  ).backgroundColor;
  // Use the page's original bg for the wrapper (default to white)
  let pageBg = "#ffffff";
  if (computedBodyBg && computedBodyBg !== "rgba(0, 0, 0, 0)") {
    pageBg = computedBodyBg;
  } else if (computedHtmlBg && computedHtmlBg !== "rgba(0, 0, 0, 0)") {
    pageBg = computedHtmlBg;
  }

  document.body.style.background = "transparent";
  document.documentElement.style.background = "transparent";

  // Create the wrapper that will hold page content
  wrapper = document.createElement("div");
  wrapper.dataset.themelabCanvasWrapper = "true";
  wrapper.style.cssText = `
    transform-origin: 0 0;
    min-width: 100vw;
    min-height: 100vh;
    position: relative;
    background: ${pageBg};
  `
    .trim()
    .replaceAll(/\n\s*/g, " ");

  // Create dotted background (sits behind wrapper, covers viewport)
  dotBg = document.createElement("div");
  dotBg.dataset.themelabDotBg = "true";
  dotBg.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 0;
    pointer-events: none;
    background-color: ${COLORS.bgSecondary};
  `
    .trim()
    .replaceAll(/\n\s*/g, " ");

  // Move all non-ThemeLab body children into the wrapper
  const bodyChildren = [...document.body.childNodes];
  for (const child of bodyChildren) {
    // Skip ThemeLab elements
    if (
      child instanceof HTMLElement &&
      (child.id === "themelab-root" ||
        Object.hasOwn(child.dataset, "themelabInteraction") ||
        Object.hasOwn(child.dataset, "themelabPlaceholder") ||
        Object.hasOwn(child.dataset, "themelabAnnotation") ||
        Object.hasOwn(child.dataset, "themelabDotBg") ||
        Object.hasOwn(child.dataset, "themelabCanvasWrapper"))
    ) {
      continue;
    }
    originalBodyChildren.push(child);
    wrapper.append(child);
  }

  // Wrapper needs to sit above the dot background
  wrapper.style.position = "relative";
  wrapper.style.zIndex = "1";

  // Insert bg and wrapper into body (before ThemeLab elements)
  document.body.insertBefore(dotBg, document.body.firstChild);
  document.body.insertBefore(wrapper, dotBg.nextSibling);

  // Subscribe to transform changes
  unsubTransform = onCanvasTransformChange(applyTransform);
  applyTransform();

  // Notify listeners that wrapper is now available
  for (const fn of wrapperChangeListeners) {
    fn(wrapper);
  }
}

/**
 * Zoom toward a specific viewport point (mouse cursor).
 * Adjusts offset so the point under the cursor stays fixed.
 */
export function zoomAtPoint(
  viewportX: number,
  viewportY: number,
  deltaScale: number
): void {
  const { scale, offsetX, offsetY } = getCanvasTransform();

  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + deltaScale));
  if (newScale === scale) {
    return;
  }

  // The page point under the cursor: pageX = (viewportX - offsetX) / scale
  // After zoom, we want the same page point at the same viewport position:
  //   viewportX = pageX * newScale + newOffsetX
  //   newOffsetX = viewportX - pageX * newScale
  const pageX = (viewportX - offsetX) / scale;
  const pageY = (viewportY - offsetY) / scale;

  const newOffsetX = viewportX - pageX * newScale;
  const newOffsetY = viewportY - pageY * newScale;

  setCanvasTransform(newScale, newOffsetX, newOffsetY);
}

/** Handle wheel events for zoom. Call from the interaction layer. */
export function handleWheelZoom(e: WheelEvent): void {
  // Pinch-to-zoom on trackpads sends wheel events with ctrlKey=true
  // Regular scroll wheel: use deltaY for zoom
  e.preventDefault();

  const delta = -e.deltaY * ZOOM_SENSITIVITY;
  const { scale } = getCanvasTransform();
  const scaledDelta = delta * scale; // Make zoom proportional to current scale

  zoomAtPoint(e.clientX, e.clientY, scaledDelta);
}

/**
 * Pan the canvas by a delta in viewport pixels.
 */
export function panCanvas(dx: number, dy: number): void {
  const { scale, offsetX, offsetY } = getCanvasTransform();
  setCanvasTransform(scale, offsetX + dx, offsetY + dy);
}

/**
 * Reset zoom/pan to default (1x, centered).
 */
export function resetCanvasTransform(): void {
  setCanvasTransform(1, 0, 0);
}

export function isCanvasActive(): boolean {
  return wrapper !== null;
}

// --- Persistence across the reload an applied edit triggers ---------------
// Applying changes does a full window.location.reload() to reflect the source
// write, which tears down the in-memory canvas. We snapshot the view to
// sessionStorage on unload and restore it on init so the canvas doesn't "close"
// every time you confirm an edit. sessionStorage = per-tab, clears on tab close.
const PERSIST_KEY = "__themelab_canvas_view__";

export function saveCanvasState(): void {
  try {
    if (!isCanvasActive()) {
      sessionStorage.removeItem(PERSIST_KEY);
      return;
    }
    const { scale, offsetX, offsetY } = getCanvasTransform();
    sessionStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ active: true, scale, offsetX, offsetY })
    );
  } catch {
    // sessionStorage unavailable (privacy mode, etc.) — non-fatal
  }
}

export function clearSavedCanvasState(): void {
  try {
    sessionStorage.removeItem(PERSIST_KEY);
  } catch {
    /* ignore */
  }
}

/** Re-enter canvas mode + restore zoom/pan after a reload. Returns true if a
 *  saved active view was restored. */
export function restoreCanvasState(): boolean {
  let saved: {
    active?: boolean;
    scale?: number;
    offsetX?: number;
    offsetY?: number;
  } | null = null;
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (raw) {
      saved = JSON.parse(raw);
    }
  } catch {
    return false;
  }
  if (!saved?.active) {
    return false;
  }
  if (!isCanvasActive()) {
    initCanvasTransform();
  }
  setCanvasTransform(saved.scale ?? 1, saved.offsetX ?? 0, saved.offsetY ?? 0);
  return true;
}

/**
 * Destroy the infinite canvas: unwrap page content back to body.
 */
export function destroyCanvasTransform(): void {
  // Notify listeners before wrapper is removed (so they can move elements out)
  for (const fn of wrapperChangeListeners) {
    fn(null);
  }

  unsubTransform?.();
  unsubTransform = null;

  // Move children back out of wrapper
  if (wrapper) {
    while (wrapper.firstChild) {
      document.body.insertBefore(wrapper.firstChild, wrapper);
    }
    wrapper.remove();
    wrapper = null;
  }

  dotBg?.remove();
  dotBg = null;
  originalBodyChildren = [];

  // Restore original backgrounds
  document.body.style.background = savedBodyBg;
  document.documentElement.style.background = savedHtmlBg;
  savedBodyBg = "";
  savedHtmlBg = "";
}

export function toggleCanvasTransform(): void {
  if (wrapper) {
    destroyCanvasTransform();
  } else {
    initCanvasTransform();
  }
}

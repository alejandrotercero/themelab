import type { ComponentInfo, JSXStructuralPath } from "@themelab/shared";
// packages/overlay/src/selection.ts
//
// Coordinate space note (infinite canvas):
// When the canvas transform is active (zoom/pan via CSS transform on a wrapper div),
// all coordinate APIs used here remain correct without explicit mapping:
//   - getBoundingClientRect() returns viewport coordinates that already account for
//     CSS transforms, so highlight rects and label positioning are correct.
//   - elementFromPoint() / elementsFromPoint() accept viewport coordinates and the
//     browser resolves hit-testing through CSS transforms automatically.
//   - The highlight canvas (highlight-canvas.ts) is position:fixed and draws in
//     viewport space, matching getBoundingClientRect() output.
//   - The selection label and marquee box are position:fixed, so using clientX/clientY
//     and rect.left/rect.top (all viewport coords) is correct.
//   - The area selection (area-selection.ts) compares marquee bounds (viewport coords
//     from clientX/clientY) against getBoundingClientRect() (viewport coords). Consistent.
// Therefore, no viewportToPage/pageToViewport mapping is needed in this module.
//
import {
  getFiberFromHostInstance,
  getDisplayName,
  isCompositeFiber,
  isInstrumentationActive,
  instrument,
} from "bippy";
import type { Fiber } from "bippy";
import { getSource } from "bippy/source";

import {
  requestFileDiscovery,
  requestFileStat,
  send,
  onMessage,
} from "./bridge.js";
import {
  getMoveContainingElement,
  hasMoveForElement,
  addClone,
  removeCloneEntry,
  addDelete,
} from "./canvas-state.js";
import { addChangeEntry, registerSelectElement } from "./changelog.js";
import {
  copyElement,
  hasClipboard,
  pasteElement,
  isInsideMapTemplate,
  resolveFromCloneAncestry,
  getCloneForElement,
} from "./clone-state.js";
import type { CloneEntry } from "./clone-state.js";
import { deleteElement } from "./delete-state.js";
import {
  COLORS,
  SHADOWS,
  RADII,
  TRANSITIONS,
  FONT_FAMILY,
} from "./design-tokens.js";
import {
  getCachedFilePath,
  setCachedFilePath,
} from "./file-discovery-cache.js";
import {
  setHoverTarget,
  setSelectionTarget,
  setMultiSelectionTargets,
  clearMultiSelection,
  getHandleAtPoint,
  getSelectionGeometry,
} from "./highlight-canvas.js";
import type { CornerHandle } from "./highlight-canvas.js";
import {
  getPageElementAtPoint,
  isPanningActive,
  isTextEditingActive as isTextEditing,
} from "./interaction.js";
import { recordSelection } from "./selection-history.js";
import { getShadowRoot, updateComponentDetail, showToast } from "./toolbar.js";
import {
  tryStartMove,
  updateMovePosition,
  endMove,
  registerSelectionAccessor,
} from "./tools/move.js";
import { isEditableFocused } from "./utils/active-element.js";
import { getElementsInArea } from "./utils/area-selection.js";
import { classifySourcePath } from "./utils/classify-source-path.js";
import type { SourceOrigin } from "./utils/classify-source-path.js";
import {
  isInternalName,
  isMdxFilePath,
  isValidElement,
} from "./utils/component-filter.js";
import { formatComponentTrace } from "./utils/component-trace.js";
import { freezeAnimations } from "./utils/freeze-animations.js";
import { freezeUpdates } from "./utils/freeze-updates.js";
import { buildJSXPath } from "./utils/jsx-path.js";
import { getResolvedOwnerStack } from "./utils/server-symbolication.js";
import {
  runQueuedSourceFetch,
  createSourceFetch,
} from "./utils/source-fetch-queue.js";
import { resolveFrameFilePath } from "./utils/source-resolve.js";

// Ensure bippy instrumentation is active so we can read fiber info
if (!isInstrumentationActive()) {
  instrument({
    onCommitFiberRoot() {
      // no-op — we just need the hook installed
    },
  });
}

// properties/property-controller.js is a UI panel driven by selection changes
// (inspect/deselect/preview/commit as the user selects, resizes, and moves
// elements) but it also imports this module (navigate, moveSelectedSibling for
// its nav buttons). It registers its implementation here via
// registerPropertyPanelBridge() at init instead of this module importing
// property-controller.js — avoids an import cycle.
interface PropertyPanelBridge {
  inspect: (element: HTMLElement, info: ComponentInfo) => void;
  deselect: () => void;
  commitAndDeselect: () => void;
  cancel: () => void;
  hasActiveOverrides: () => boolean;
  preview: (key: string, cssValue: string) => void;
  scheduledCommit: () => void;
}
let propertyPanel: PropertyPanelBridge = {
  inspect: () => {
    /* no-op until property-controller.js registers itself */
  },
  deselect: () => {
    /* no-op */
  },
  commitAndDeselect: () => {
    /* no-op */
  },
  cancel: () => {
    /* no-op */
  },
  hasActiveOverrides: () => false,
  preview: () => {
    /* no-op */
  },
  scheduledCommit: () => {
    /* no-op */
  },
};
export function registerPropertyPanelBridge(bridge: PropertyPanelBridge): void {
  propertyPanel = bridge;
}

interface StackEntry {
  componentName: string;
  filePath: string;
  lineNumber: number;
  columnNumber: number;
  // Optional to match the shared ComponentInfo.stack shape (clone-ancestry
  // entries predate classification); the resolve paths always populate them.
  origin?: SourceOrigin;
  packageName?: string | null;
}

interface ResolvedComponent {
  tagName: string;
  componentName: string;
  filePath: string;
  lineNumber: number;
  columnNumber: number;
  stack: StackEntry[];
  trace?: string;
  jsxPath?: JSXStructuralPath;
}

// --- Module state ----------------------------------------------------------

let currentSelection: ComponentInfo | null = null;
let selectedElement: HTMLElement | null = null;
let isActive = false;
let listenersAttached = false;

// Phase B2 — pause React state updates for the whole page while an element is
// selected, so the target can't re-render/unmount out from under an edit.
// OFF by default: freezeUpdates() patches React's internal dispatcher globally
// (see freeze-updates.ts) and must be validated across React 18/19, Next.js
// (Webpack + Turbopack) and Vite before enabling. Flip to true (or gate on a
// runtime flag) once verified.
const SELECTION_UPDATE_FREEZE_ENABLED = false;

// Animation freeze for the selected subtree (see freeze-animations.ts). While an
// element is selected we pause its animations/transitions so it can't move out
// from under the highlight or a subsequent edit. Held here so a new selection or
// a deselect releases the prior freeze. When B2 is enabled, a second release for
// the global update freeze is tracked alongside it.
let releaseSelectionFreeze: (() => void) | null = null;
let releaseUpdateFreeze: (() => void) | null = null;

function freezeSelected(el: HTMLElement): void {
  releaseSelectionFreeze?.();
  releaseSelectionFreeze = freezeAnimations([el]);
  if (SELECTION_UPDATE_FREEZE_ENABLED) {
    releaseUpdateFreeze?.();
    releaseUpdateFreeze = freezeUpdates();
  }
}

function unfreezeSelected(): void {
  releaseSelectionFreeze?.();
  releaseSelectionFreeze = null;
  releaseUpdateFreeze?.();
  releaseUpdateFreeze = null;
}

// Mirror the current selection to the CLI (for MCP). Deduped by component
// identity so re-renders/HMR don't spam the socket. Call after any change to
// `currentSelection`; null reports a deselect.
let lastReportedSelectionKey = "";
function reportSelectionToCli(): void {
  const sel = currentSelection;
  const key = sel
    ? `${sel.componentName}|${sel.filePath}|${sel.lineNumber}|${sel.columnNumber}`
    : "";
  if (key === lastReportedSelectionKey) {
    return;
  }
  lastReportedSelectionKey = key;
  send({ type: "setSelection", selection: sel });
}

// Multi-selection state
interface MultiSelectEntry {
  element: HTMLElement;
  info: ComponentInfo;
}
const multiSelected = new Map<HTMLElement, MultiSelectEntry>();

// Overlay elements
let selectionLabel: HTMLDivElement | null = null;
let marqueeBox: HTMLDivElement | null = null;

// Interaction state machine
type InteractionMode =
  | "idle"
  | "pending"
  | "marquee"
  | "pending-move"
  | "move-drag"
  | "resize-drag";
let mode: InteractionMode = "idle";
let mouseDownPos: { x: number; y: number } | null = null;
let mouseDownElement: HTMLElement | null = null;

// Resize drag state
let resizeDragCorner: CornerHandle | null = null;
let resizeInitialRect: { x: number; y: number; w: number; h: number } | null =
  null;
let resizeInitialWidth = 0;
let resizeInitialHeight = 0;
let multiResizeInitials: {
  element: HTMLElement;
  width: number;
  height: number;
}[] = [];

// Shift+click tracking
let isMultiSelectClick = false;

// Drag callbacks — set by drag.ts via setDragCallbacks. Stored for API
// compatibility; the legacy drag path no longer reads them (underscore-prefixed
// to mark them write-only).
let _onDragStartCallback:
  | ((e: MouseEvent, el: HTMLElement, selection: ComponentInfo) => void)
  | null = null;
let _onDragMoveCallback: ((e: MouseEvent) => void) | null = null;
let _onDragEndCallback: ((e: MouseEvent) => void) | null = null;

export function setDragCallbacks(callbacks: {
  onStart: (e: MouseEvent, el: HTMLElement, selection: ComponentInfo) => void;
  onMove: (e: MouseEvent) => void;
  onEnd: (e: MouseEvent) => void;
}): void {
  _onDragStartCallback = callbacks.onStart;
  _onDragMoveCallback = callbacks.onMove;
  _onDragEndCallback = callbacks.onEnd;
}

// "Interact mode" is a toggle flipped by the backtick (`) key, not a mouse
// modifier. Every browser click-modifier hijacks links (⌘=new tab, ⇧=new window,
// ⌥=download), and hold-to-interact was unreliable (keyup gets swallowed on focus
// changes / link nav), so it's a sticky press-to-switch toggle instead.
let interactMode = false;
let lastMouseX = 0;
let lastMouseY = 0;

/** True while interact mode is on — clicks/hover reach the app instead of selecting. */
export function isInteractActive(): boolean {
  return interactMode;
}

const OVERLAY_STYLES = `
  .selection-label {
    position: fixed;
    pointer-events: none;
    background: ${COLORS.bgPrimary};
    border: 1px solid ${COLORS.border};
    box-shadow: ${SHADOWS.sm};
    border-radius: ${RADII.sm};
    padding: 4px 8px;
    z-index: 2147483646;
    font-family: ${FONT_FAMILY};
    white-space: nowrap;
    display: none;
    opacity: 0;
    transition: opacity ${TRANSITIONS.medium};
  }
  .selection-label.visible {
    opacity: 1;
  }
  .selection-label .comp-name {
    color: ${COLORS.textPrimary};
    font-size: 12px;
    font-weight: 600;
  }
  .selection-label .comp-path {
    color: ${COLORS.textSecondary};
    font-size: 11px;
    margin-left: 8px;
  }
  .selection-label .loading-dots {
    color: ${COLORS.textTertiary};
    font-size: 12px;
  }
  @keyframes dotPulse {
    0%, 80%, 100% { opacity: 0.2; }
    40% { opacity: 1; }
  }
  .selection-label .loading-dots span {
    animation: dotPulse 1.4s infinite;
  }
  .selection-label .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .selection-label .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
  .marquee-box {
    position: fixed;
    border: 1px solid ${COLORS.accent};
    background: ${COLORS.accentSoft};
    border-radius: 2px;
    z-index: 2147483646;
    display: none;
    pointer-events: none;
  }
`;

// --- Component resolution --------------------------------------------------

/** A composite component name worth surfacing: PascalCase and not a framework
 *  internal (MDX synthetic names are accepted since the file carries the signal). */
function isAcceptableComponentName(
  name: string | undefined | null,
  filePath: string
): boolean {
  if (!name || name[0] !== name[0].toUpperCase()) {
    return false;
  }
  if (filePath && isMdxFilePath(filePath)) {
    return true;
  }
  return !isInternalName(name);
}

/** Build a classified stack entry from a raw (still bundler-wrapped) fileName.
 *  Classification runs on the raw name so a dependency frame is distinguished
 *  from one that merely failed to resolve to an on-disk path. */
function makeStackEntry(
  name: string,
  rawFileName: string | undefined | null,
  lineNumber: number,
  columnNumber: number
): StackEntry {
  const classification = classifySourcePath(rawFileName);
  return {
    componentName: name,
    filePath: resolveFrameFilePath(rawFileName),
    lineNumber,
    columnNumber,
    origin: classification.origin,
    packageName: classification.packageName,
  };
}

/**
 * Pick the primary frame by source origin, mirroring react-grab's
 * selectResolvedSource: prefer the nearest app-owned frame with a resolved path,
 * then any app-owned frame, then any frame with a path, then the first frame.
 * A dependency (node_modules / Vite-dep / CDN) path never wins over the user's
 * own component.
 */
function pickPrimaryFrame(frames: StackEntry[]): StackEntry | undefined {
  return (
    frames.find((f) => f.origin === "app" && f.filePath) ||
    frames.find((f) => f.origin === "app") ||
    frames.find((f) => f.filePath) ||
    frames[0]
  );
}

/** Assemble the final ResolvedComponent: primary location, the (structural)
 *  owner-chain stack, a fresh JSX path, and a signal-aware trace string. */
function buildResolved(
  el: HTMLElement,
  primary: StackEntry,
  stack: StackEntry[]
): ResolvedComponent {
  return {
    tagName: el.tagName.toLowerCase(),
    componentName: primary.componentName,
    filePath: primary.filePath,
    lineNumber: primary.lineNumber,
    columnNumber: primary.columnNumber,
    stack,
    trace: formatComponentTrace(stack) || undefined,
    jsxPath:
      buildJSXPath(el, primary.filePath, primary.componentName) ?? undefined,
  };
}

interface AsyncSource {
  frames: StackEntry[];
  fiberSource: StackEntry | null;
}

// Per-element cache for the expensive async resolution (owner-stack + source-map
// fetches). Keyed by the host element so an HMR DOM swap naturally evicts (new
// node = new key, old GC'd); a successful edit triggers a full reload which
// drops this module state entirely. Failed (null) resolutions are evicted so a
// later selection can retry once the fiber's source data is attached. Held
// values feed buildResolved, which rebuilds the JSX path from the live DOM, so a
// cache hit never returns a stale structural anchor.
let asyncSourceCache = new WeakMap<Element, Promise<AsyncSource | null>>();

export function clearResolutionCache(): void {
  // WeakMap has no clear(); reassign to drop all entries. Called from the same
  // invalidation points as the other caches (reconnect / HMR-ish transitions).
  asyncSourceCache = new WeakMap<Element, Promise<AsyncSource | null>>();
}

/** React's own dev source for the fiber (works without owner stacks — the
 *  React 18 / no-owner-stack path). Routed through the fetch queue's signal. */
async function resolveFiberSource(
  fiber: Fiber,
  fetchFn: (url: string) => Promise<Response>
): Promise<StackEntry | null> {
  const source = await getSource(fiber, true, fetchFn);
  if (!source?.fileName) {
    return null;
  }
  const filePath = resolveFrameFilePath(source.fileName);
  let name: string | null = null;
  if (
    source.functionName &&
    isAcceptableComponentName(source.functionName, filePath)
  ) {
    name = source.functionName;
  } else if (isCompositeFiber(fiber)) {
    name = getDisplayName(fiber.type);
  }
  if (!isAcceptableComponentName(name, filePath)) {
    return null;
  }
  return makeStackEntry(
    name as string,
    source.fileName,
    source.lineNumber ?? 0,
    source.columnNumber ?? 0
  );
}

/** Run the owner-stack + fiber-source resolution under the concurrency cap with
 *  an abort-on-timeout, so a saturated connection pool can't hang selection. */
function fetchAsyncSource(fiber: Fiber): Promise<AsyncSource | null> {
  return runQueuedSourceFetch(async (signal) => {
    const fetchFn = createSourceFetch(signal);
    const [ownerFrames, fiberSource] = await Promise.all([
      getResolvedOwnerStack(fiber, fetchFn).catch(
        () => [] as Awaited<ReturnType<typeof getResolvedOwnerStack>>
      ),
      resolveFiberSource(fiber, fetchFn).catch(() => null),
    ]);

    const frames: StackEntry[] = [];
    for (const frame of ownerFrames ?? []) {
      const filePath = resolveFrameFilePath(frame.fileName);
      if (!isAcceptableComponentName(frame.functionName, filePath)) {
        continue;
      }
      frames.push(
        makeStackEntry(
          frame.functionName as string,
          frame.fileName,
          frame.lineNumber ?? 0,
          frame.columnNumber ?? 0
        )
      );
    }

    if (frames.length === 0 && !fiberSource) {
      return null;
    }
    return { frames, fiberSource };
  }, null);
}

function resolveAsyncSource(
  el: HTMLElement,
  fiber: Fiber
): Promise<AsyncSource | null> {
  const cache = asyncSourceCache;
  const cached = cache.get(el);
  if (cached) {
    return cached;
  }
  const pending = (async () => {
    const result = await fetchAsyncSource(fiber);
    if (result === null) {
      // evict failures so a retry is possible
      cache.delete(el);
    }
    return result;
  })();
  cache.set(el, pending);
  return pending;
}

/** Synchronous fallback — walks fiber.return chain for component names */
function resolveComponentFromFiberWalk(
  el: HTMLElement,
  fiber: Fiber
): ResolvedComponent | null {
  const frames: StackEntry[] = [];
  let current: Fiber | null = fiber;

  while (current) {
    if (isCompositeFiber(current)) {
      const name = getDisplayName(current.type);
      const debugSource =
        current._debugSource || current._debugOwner?._debugSource;
      // resolveFrameFilePath strips bundler URL wrappers and rejects chunk names
      // (e.g. Turbopack's src_*._.js); makeStackEntry classifies on the raw name.
      const filePath = debugSource
        ? resolveFrameFilePath(debugSource.fileName)
        : "";

      if (name && isAcceptableComponentName(name, filePath)) {
        frames.push(
          debugSource
            ? makeStackEntry(
                name,
                debugSource.fileName,
                debugSource.lineNumber || 0,
                debugSource.columnNumber || 0
              )
            : {
                componentName: name,
                filePath: "",
                lineNumber: 0,
                columnNumber: 0,
                origin: "unknown",
                packageName: null,
              }
        );
      }
    }
    current = current.return;
  }

  if (frames.length === 0) {
    return null;
  }

  // Prefer the nearest app-owned frame, same as the async path.
  const primary = pickPrimaryFrame(frames) ?? frames[0];
  return buildResolved(el, primary, frames);
}

/**
 * Resolve component info from a DOM element. Runs React 19 owner stacks (with
 * source-map symbolication + Next.js RSC resolution) and React's own fiber
 * source in parallel, then prefers the nearest app-owned location. Falls back to
 * a synchronous fiber walk when the async path yields nothing.
 */
async function resolveComponentFromElement(
  el: HTMLElement
): Promise<ResolvedComponent | null> {
  const fiber = getFiberFromHostInstance(el);
  if (!fiber) {
    const cloneResolution = resolveFromCloneAncestry(el);
    if (cloneResolution) {
      const { sourceInfo } = cloneResolution;
      return {
        tagName: el.tagName.toLowerCase(),
        componentName: sourceInfo.componentName,
        filePath: sourceInfo.filePath,
        lineNumber: sourceInfo.lineNumber,
        columnNumber: sourceInfo.columnNumber,
        stack: sourceInfo.stack,
        jsxPath: sourceInfo.jsxPath,
      };
    }
    return null;
  }

  try {
    const asyncSource = await resolveAsyncSource(el, fiber);
    if (asyncSource) {
      const { frames, fiberSource } = asyncSource;
      // Dual-signal preference (react-grab's resolveSource): trust React's own
      // app-owned fiber source first, otherwise the nearest app-owned owner frame.
      const primary =
        (fiberSource && fiberSource.origin === "app" && fiberSource.filePath
          ? fiberSource
          : undefined) ??
        pickPrimaryFrame(frames) ??
        fiberSource ??
        frames[0];
      if (primary) {
        // Keep the owner chain as the reported stack (drag/re-find depend on its
        // order); if only the fiber source resolved, surface it as the lone frame.
        let stack: StackEntry[] = [];
        if (frames.length > 0) {
          stack = frames;
        } else if (fiberSource) {
          stack = [fiberSource];
        }
        return buildResolved(el, primary, stack);
      }
    }
  } catch (error) {
    console.warn(
      "[ThemeLab] async source resolution failed, falling back to fiber walk:",
      error
    );
  }

  // Fallback: synchronous fiber walk (works when owner stacks aren't available)
  return resolveComponentFromFiberWalk(el, fiber);
}

/** Synchronous-only resolve for hover labels and marquee (fast path) */
function resolveComponentSync(el: HTMLElement): ResolvedComponent | null {
  const fiber = getFiberFromHostInstance(el);
  if (!fiber) {
    const cloneResolution = resolveFromCloneAncestry(el);
    if (cloneResolution) {
      const { sourceInfo } = cloneResolution;
      return {
        tagName: el.tagName.toLowerCase(),
        componentName: sourceInfo.componentName,
        filePath: sourceInfo.filePath,
        lineNumber: sourceInfo.lineNumber,
        columnNumber: sourceInfo.columnNumber,
        stack: sourceInfo.stack,
        jsxPath: sourceInfo.jsxPath,
      };
    }
    return null;
  }
  return resolveComponentFromFiberWalk(el, fiber);
}

function buildFallbackSelection(el: HTMLElement): ResolvedComponent {
  const tagName = el.tagName.toLowerCase();
  const dataName = el.dataset.componentName?.trim();
  const ariaLabel = el.getAttribute("aria-label")?.trim();
  const textLabel = el.textContent?.trim();
  const componentName =
    dataName ||
    ariaLabel ||
    (textLabel ? textLabel.slice(0, 24) : "") ||
    `<${tagName}>`;

  return {
    tagName,
    componentName,
    filePath: "",
    lineNumber: 0,
    columnNumber: 0,
    stack: [],
  };
}

function getCanonicalSelectableElement(
  clientX: number,
  clientY: number
): HTMLElement | null {
  const pageEl = getPageElementAtPoint(clientX, clientY);
  if (!pageEl) {
    return null;
  }
  const moveEntry = getMoveContainingElement(pageEl);
  return moveEntry?.element ?? pageEl;
}

// --- Selection display & core operations -----------------------------------

/** Clear multi-select state and highlight canvas */
function clearMultiSelectState(): void {
  multiSelected.clear();
  clearMultiSelection();
}

/** Refresh highlight-canvas multi-selection targets from current multiSelected state */
function updateMultiSelectionHighlights(): void {
  if (multiSelected.size === 0) {
    clearMultiSelection();
    return;
  }
  const targets: { rect: DOMRect; borderRadius: number }[] = [];
  for (const [element] of multiSelected) {
    const rect = element.getBoundingClientRect();
    const br = Number(getComputedStyle(element).borderRadius) || 4;
    targets.push({ rect, borderRadius: br + 2 });
  }
  setMultiSelectionTargets(targets);
}

function hideSelectionLabel(): void {
  if (selectionLabel) {
    selectionLabel.classList.remove("visible");
    selectionLabel.style.display = "none";
  }
}

function showSelectionOverlay(
  rect: DOMRect,
  _info: ComponentInfo | null
): void {
  if (selectedElement) {
    const br = Number(getComputedStyle(selectedElement).borderRadius) || 4;
    setSelectionTarget(rect, br + 2);
  }

  if (selectionLabel) {
    const labelHeight = 28;
    const gap = 8;
    let top = rect.top - labelHeight - gap;
    const { left } = rect;

    if (top < 0) {
      top = rect.bottom + gap;
    }

    selectionLabel.style.left = `${left}px`;
    selectionLabel.style.top = `${top}px`;
    selectionLabel.style.display = "block";
    selectionLabel.style.right = "auto";

    selectionLabel.innerHTML = `<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>`;
    requestAnimationFrame(() => selectionLabel?.classList.add("visible"));

    requestAnimationFrame(() => {
      if (!selectionLabel) {
        return;
      }
      const labelRect = selectionLabel.getBoundingClientRect();
      if (labelRect.right > window.innerWidth - 8) {
        selectionLabel.style.left = "auto";
        selectionLabel.style.right = "8px";
      }
    });
  }
}

/** Update selection highlight + label to track the selected element on scroll/resize */
function updateSelectionPosition(): void {
  // Handle multi-select position update
  if (multiSelected.size > 0) {
    updateMultiSelectionHighlights();
    return;
  }

  if (!selectedElement || !currentSelection) {
    return;
  }
  const rect = selectedElement.getBoundingClientRect();
  const br = Number(getComputedStyle(selectedElement).borderRadius) || 4;
  setSelectionTarget(rect, br + 2);

  // Reposition label
  if (selectionLabel && selectionLabel.style.display !== "none") {
    const labelHeight = 28;
    const gap = 8;
    let top = rect.top - labelHeight - gap;
    if (top < 0) {
      top = rect.bottom + gap;
    }
    selectionLabel.style.left = `${rect.left}px`;
    selectionLabel.style.top = `${top}px`;
    selectionLabel.style.right = "auto";

    const labelRect = selectionLabel.getBoundingClientRect();
    if (labelRect.right > window.innerWidth - 8) {
      selectionLabel.style.left = "auto";
      selectionLabel.style.right = "8px";
    }
  }
}

function hideHoverOverlay(): void {
  setHoverTarget(null);
}

export function clearSelection(): void {
  propertyPanel.deselect();
  unfreezeSelected();
  currentSelection = null;
  reportSelectionToCli();
  selectedElement = null;
  resizeDragCorner = null;
  resizeInitialRect = null;
  multiResizeInitials = [];
  clearMultiSelectState();
  document.body.style.cursor = "";
  setSelectionTarget(null);
  hideSelectionLabel();
  updateComponentDetail(null);
}

export function getSelection(): ComponentInfo | null {
  return currentSelection;
}

export function getSelectedElement(): HTMLElement | null {
  return selectedElement ?? null;
}

/** Backfill the discovered file path onto matching stack frames. */
function fillStackFilePaths(
  resolved: ResolvedComponent,
  filePath: string
): void {
  if (!resolved.stack) {
    return;
  }
  for (const frame of resolved.stack) {
    if (frame.componentName === resolved.componentName && !frame.filePath) {
      frame.filePath = filePath;
    }
  }
}

/** Layer 2: grep-based discovery when filePath is empty. Results are cached per
 *  component name; an unknown name asks the CLI once. */
async function applyDiscoveredFilePath(
  resolved: ResolvedComponent
): Promise<void> {
  const cached = getCachedFilePath(resolved.componentName);
  if (cached === undefined) {
    // Not looked up yet — ask CLI
    const discovered = await requestFileDiscovery(resolved.componentName);
    setCachedFilePath(resolved.componentName, discovered);
    if (discovered) {
      resolved.filePath = discovered;
      fillStackFilePaths(resolved, discovered);
    }
  } else if (cached) {
    resolved.filePath = cached;
    fillStackFilePaths(resolved, cached);
  }
}

// Capture the staleness baseline (file mtime/size at selection time) so edits
// can be rejected if the file changed underneath. Best-effort + async; guarded
// against the selection moving on before the stat resolves.
async function captureFileStatBaseline(
  filePath: string,
  selRef: ComponentInfo
): Promise<void> {
  try {
    const { mtime, size } = await requestFileStat(filePath);
    if (mtime > 0 && currentSelection === selRef) {
      selRef.fileMtime = mtime;
      selRef.fileSize = size;
    }
  } catch {
    /* empty */
  }
}

export async function selectElement(
  el: HTMLElement,
  options?: { skipSidebar?: boolean }
): Promise<void> {
  try {
    const displayRect = el.getBoundingClientRect();

    // Show selection overlay with loading dots immediately, before async resolve
    selectedElement = el;
    freezeSelected(el);
    showSelectionOverlay(displayRect, null);
    hideHoverOverlay();

    const resolved =
      (await resolveComponentFromElement(el)) ?? buildFallbackSelection(el);

    // Layer 2: grep-based discovery when filePath is empty
    if (!resolved.filePath && resolved.componentName) {
      await applyDiscoveredFilePath(resolved);
    }

    console.log(
      "[ThemeLab] selectElement:",
      el.tagName,
      "→",
      resolved.componentName,
      resolved.filePath,
      "stack:",
      resolved.stack?.map((s) => s.componentName)
    );

    const selection: ComponentInfo = {
      tagName: resolved.tagName,
      componentName: resolved.componentName,
      filePath: resolved.filePath,
      lineNumber: resolved.lineNumber,
      columnNumber: resolved.columnNumber,
      stack: resolved.stack,
      boundingRect: {
        top: displayRect.top,
        left: displayRect.left,
        width: displayRect.width,
        height: displayRect.height,
      },
      trace: resolved.trace,
      jsxPath: resolved.jsxPath,
    };
    currentSelection = selection;

    reportSelectionToCli();
    recordSelection(el, selection);

    if (resolved.filePath) {
      void captureFileStatBaseline(resolved.filePath, selection);
    }

    if (selectionLabel) {
      const pathText = resolved.filePath
        ? `${resolved.filePath}:${resolved.lineNumber}`
        : "";
      selectionLabel.innerHTML = `<span class="comp-name">${resolved.componentName}</span>${pathText ? `<span class="comp-path">${pathText}</span>` : ""}`;
    }

    // Notify property controller of new selection (opens sidebar) — skip in move tool mode
    if (!options?.skipSidebar) {
      propertyPanel.inspect(el, selection);
    }

    // Update action bar component detail
    updateComponentDetail({
      tagName: resolved.tagName,
      componentName: resolved.componentName,
      filePath: resolved.filePath,
      lineNumber: resolved.lineNumber,
    });
  } catch (error) {
    console.error("[ThemeLab] selectElement error:", error);
  }
}

/** Select an element with highlight but without opening property sidebar (for move tool) */
export async function selectElementForMove(el: HTMLElement): Promise<void> {
  await selectElement(el, { skipSidebar: true });
}

function performMarqueeSelect(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  const elements = getElementsInArea({
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  });

  if (elements.length === 0) {
    return;
  }

  // Clear single selection when marquee selects
  propertyPanel.deselect();
  currentSelection = null;
  selectedElement = null;
  setSelectionTarget(null);
  hideSelectionLabel();

  // Resolve each element and add to multi-select
  multiSelected.clear();
  for (const el of elements.slice(0, 50)) {
    const resolved = resolveComponentSync(el);
    if (!resolved) {
      continue;
    }

    const rect = el.getBoundingClientRect();
    const info: ComponentInfo = {
      tagName: resolved.tagName,
      componentName: resolved.componentName,
      filePath: resolved.filePath,
      lineNumber: resolved.lineNumber,
      columnNumber: resolved.columnNumber,
      stack: resolved.stack,
      boundingRect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    };
    multiSelected.set(el, { element: el, info });
  }

  if (multiSelected.size === 0) {
    return;
  }

  // If only one element selected by marquee, convert to single select
  if (multiSelected.size === 1) {
    const [[el, entry]] = multiSelected.entries();
    multiSelected.clear();
    selectedElement = el;
    currentSelection = entry.info;
    const rect = el.getBoundingClientRect();
    showSelectionOverlay(rect, currentSelection);
    if (selectionLabel) {
      const pathText = entry.info.filePath
        ? `${entry.info.filePath}:${entry.info.lineNumber}`
        : "";
      selectionLabel.innerHTML = `<span class="comp-name">${entry.info.componentName}</span>${pathText ? `<span class="comp-path">${pathText}</span>` : ""}`;
    }
    propertyPanel.inspect(el, currentSelection);
    updateComponentDetail({
      tagName: entry.info.tagName,
      componentName: entry.info.componentName,
      filePath: entry.info.filePath,
      lineNumber: entry.info.lineNumber,
    });
    return;
  }

  // Multiple elements → update highlights + show count label
  updateMultiSelectionHighlights();
  updateComponentDetail(null); // No single-element detail for multi-select
  if (selectionLabel) {
    selectionLabel.innerHTML = `<span class="comp-name">${multiSelected.size} elements selected</span>`;
    selectionLabel.style.display = "block";
    selectionLabel.style.left = `${x1}px`;
    selectionLabel.style.top = `${Math.max(0, y1 - 36)}px`;
    selectionLabel.style.right = "auto";
    requestAnimationFrame(() => selectionLabel?.classList.add("visible"));
  }
}

/** ⌘/Ctrl+click: toggle an element in/out of multi-select */
function toggleMultiSelect(el: HTMLElement): void {
  if (multiSelected.has(el)) {
    // Remove from multi-select
    multiSelected.delete(el);
    if (multiSelected.size === 1) {
      // Collapse back to single select
      const [[remainEl, entry]] = multiSelected.entries();
      multiSelected.clear();
      clearMultiSelection();
      selectedElement = remainEl;
      currentSelection = entry.info;
      const rect = remainEl.getBoundingClientRect();
      showSelectionOverlay(rect, currentSelection);
      propertyPanel.inspect(remainEl, currentSelection);
      if (selectionLabel) {
        const pathText = entry.info.filePath
          ? `${entry.info.filePath}:${entry.info.lineNumber}`
          : "";
        selectionLabel.innerHTML = `<span class="comp-name">${entry.info.componentName}</span>${pathText ? `<span class="comp-path">${pathText}</span>` : ""}`;
      }
      updateComponentDetail({
        tagName: entry.info.tagName,
        componentName: entry.info.componentName,
        filePath: entry.info.filePath,
        lineNumber: entry.info.lineNumber,
      });
    } else if (multiSelected.size === 0) {
      clearMultiSelection();
      clearSelection();
    } else {
      updateMultiSelectionHighlights();
      if (selectionLabel) {
        selectionLabel.innerHTML = `<span class="comp-name">${multiSelected.size} elements selected</span>`;
      }
    }
    return;
  }

  // Add to multi-select
  const resolved = resolveComponentSync(el);
  if (!resolved) {
    return;
  }

  // If there's a current single selection, promote it to multi-select first
  if (currentSelection && selectedElement && multiSelected.size === 0) {
    multiSelected.set(selectedElement, {
      element: selectedElement,
      info: currentSelection,
    });
    propertyPanel.deselect();
    currentSelection = null;
    selectedElement = null;
    setSelectionTarget(null);
  }

  const rect = el.getBoundingClientRect();
  const info: ComponentInfo = {
    tagName: resolved.tagName,
    componentName: resolved.componentName,
    filePath: resolved.filePath,
    lineNumber: resolved.lineNumber,
    columnNumber: resolved.columnNumber,
    stack: resolved.stack,
    boundingRect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
  };
  multiSelected.set(el, { element: el, info });

  updateMultiSelectionHighlights();
  updateComponentDetail(null);
  if (selectionLabel) {
    selectionLabel.innerHTML = `<span class="comp-name">${multiSelected.size} elements selected</span>`;
    selectionLabel.style.display = "block";
    requestAnimationFrame(() => selectionLabel?.classList.add("visible"));
  }
}

// --- Hierarchy navigation (issue #6) -------------------------------------
// Walk the live DOM tree from the selected element, skipping wrapper nodes the
// overlay considers non-selectable (overlay UI, full-page shells, hidden nodes)
// so arrow keys hop between meaningful elements rather than every <div>.

function isNavigable(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    !el.closest("#themelab-root") &&
    isValidElement(el)
  );
}

/** Nearest selectable ancestor (↑). */
function findValidAncestor(el: HTMLElement): HTMLElement | null {
  let cur: Element | null = el.parentElement;
  while (cur) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "body" || tag === "html") {
      return null;
    }
    if (isNavigable(cur)) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/** Nearest selectable descendant in DOM order (↓) — prefers direct children,
 *  then descends through wrapper nodes that aren't selectable themselves. */
function findValidDescendant(el: HTMLElement): HTMLElement | null {
  const children = [...el.children].filter(
    (c): c is HTMLElement =>
      c instanceof HTMLElement && !c.closest("#themelab-root")
  );
  for (const child of children) {
    if (isValidElement(child)) {
      return child;
    }
  }
  for (const child of children) {
    const found = findValidDescendant(child);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Next/previous selectable sibling at the same level (→ / ←). When no sibling
 *  is selectable at this level, climbs to the nearest selectable ancestor and
 *  continues from there, so navigation never dead-ends inside wrapper nodes. */
function findValidSibling(el: HTMLElement, dir: 1 | -1): HTMLElement | null {
  let anchor: HTMLElement | null = el;
  while (anchor) {
    let cur: Element | null =
      dir === 1 ? anchor.nextElementSibling : anchor.previousElementSibling;
    while (cur) {
      if (isNavigable(cur)) {
        return cur;
      }
      // Wrapper sibling — look inside it for a selectable node.
      if (cur instanceof HTMLElement && !cur.closest("#themelab-root")) {
        const inner = findValidDescendant(cur);
        if (inner) {
          return inner;
        }
      }
      cur = dir === 1 ? cur.nextElementSibling : cur.previousElementSibling;
    }
    // No selectable sibling here — climb one level and retry from the ancestor.
    anchor = findValidAncestor(anchor);
  }
  return null;
}

export type NavDirection = "up" | "down" | "left" | "right";

const NAV_EMPTY_MSG: Record<NavDirection, string> = {
  up: "Top of tree",
  down: "No child elements",
  left: "No previous sibling",
  right: "No next sibling",
};

function findNavTarget(el: HTMLElement, dir: NavDirection): HTMLElement | null {
  switch (dir) {
    case "up": {
      return findValidAncestor(el);
    }
    case "down": {
      return findValidDescendant(el);
    }
    case "left": {
      return findValidSibling(el, -1);
    }
    case "right": {
      return findValidSibling(el, 1);
    }
    default: {
      return null;
    }
  }
}

/** Navigate the DOM hierarchy from the current selection (↑ parent, ↓ child,
 *  ←/→ siblings). Shared by the arrow keys and the sidebar nav buttons. */
export function navigate(dir: NavDirection): void {
  if (!selectedElement || !currentSelection || multiSelected.size > 0) {
    return;
  }
  const target = findNavTarget(selectedElement, dir);
  if (target) {
    clearMultiSelectState();
    selectElement(target);
  } else {
    showToast(NAV_EMPTY_MSG[dir]);
  }
}

/** Which directions have a selectable target for the current selection — used
 *  to enable/disable the sidebar nav buttons. */
export function getNavAvailability(): Record<NavDirection, boolean> {
  if (!selectedElement || !currentSelection || multiSelected.size > 0) {
    return { up: false, down: false, left: false, right: false };
  }
  return {
    up: !!findValidAncestor(selectedElement),
    down: !!findValidDescendant(selectedElement),
    left: !!findValidSibling(selectedElement, -1),
    right: !!findValidSibling(selectedElement, 1),
  };
}

const ARROW_TO_DIR: Record<string, NavDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Arrow-key hierarchy navigation. Returns true if it consumed the key. */
function navigateHierarchy(key: string): boolean {
  if (!selectedElement || !currentSelection || multiSelected.size > 0) {
    return false;
  }
  const dir = ARROW_TO_DIR[key];
  if (!dir) {
    return false;
  }
  navigate(dir);
  return true;
}

// --- Z-stack navigation ---------------------------------------------------
// Walk the document.elementsFromPoint() stack at the selected element's center,
// reaching elements stacked at the same screen position that hit-testing alone
// can't surface (scrims, absolutely-positioned layers). `z` drills deeper
// below the selection, `x` surfaces back up. Read-only — unlike [ / ] sibling
// reorder, this never writes to source.

function getZStackAt(clientX: number, clientY: number): HTMLElement[] {
  const stack: HTMLElement[] = [];
  for (const el of document.elementsFromPoint(clientX, clientY)) {
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
    if (!isValidElement(el)) {
      continue;
    }
    stack.push(el);
  }
  return stack;
}

function navigateZStack(dir: 1 | -1): void {
  if (!selectedElement || !currentSelection || multiSelected.size > 0) {
    return;
  }
  const rect = selectedElement.getBoundingClientRect();
  const stack = getZStackAt(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2
  );
  if (stack.length === 0) {
    return;
  }

  const index = stack.indexOf(selectedElement);
  // Selection absent from its own center stack (scrolled away or fully
  // covered): restart from the topmost element rather than doing nothing.
  const targetIndex = index === -1 ? 0 : index + dir;
  if (targetIndex < 0) {
    showToast("Top of stack");
    return;
  }
  if (targetIndex >= stack.length) {
    showToast("Bottom of stack");
    return;
  }
  const target = stack[targetIndex];
  if (target === selectedElement) {
    return;
  }
  clearMultiSelectState();
  selectElement(target);
}

// --- Move element among siblings (issue #5) ------------------------------
// Writes a real source reorder via the CLI's moveSibling transform (all AST
// sibling reasoning happens server-side from the element's file:line, so there
// is no fragile DOM-to-source matching like the old drag path).
export type MoveDirection = "up" | "down";
let lastMoveDir: MoveDirection | null = null;

/** Nearby static text (ancestor labels) to anchor the AI locator if the moved
 *  element's own text is computed/empty — mirrors the property panel. */
function moveContextText(el: HTMLElement): string | undefined {
  const own = (el.textContent || "").trim();
  let cur: HTMLElement | null = el.parentElement;
  let best = "";
  for (let i = 0; i < 4 && cur; i += 1, cur = cur.parentElement) {
    const t = (cur.textContent || "").replaceAll(/\s+/g, " ").trim();
    if (t.length > best.length) {
      best = t;
    }
    if (best.length > own.length + 12) {
      break;
    }
  }
  return best.length > own.length + 2 ? best.slice(0, 160) : undefined;
}

/** Move the selected element one step earlier/later among its source siblings. */
export function moveSelectedSibling(dir: MoveDirection): void {
  if (!selectedElement || !currentSelection || multiSelected.size > 0) {
    return;
  }
  if (!currentSelection.filePath) {
    showToast("Can't move — no source file resolved");
    return;
  }
  if (isInsideMapTemplate(currentSelection)) {
    showToast("Can't reorder elements inside .map()");
    return;
  }

  // Gather the same DOM resolution hints delete/duplicate use, so the CLI's
  // batch resolver (jsxPath → line:col → fuzzy className/nth) lands on the right
  // node — a raw line match is too brittle (stale line:col on React 18/Turbopack).
  const el = selectedElement;
  const parent = el.parentElement;
  let nthOfType = 0;
  if (parent) {
    for (const child of parent.children) {
      if (child === el) {
        break;
      }
      if (child.tagName === el.tagName) {
        nthOfType += 1;
      }
    }
  }
  const lastSeg = currentSelection.jsxPath?.segments.at(-1);
  const jsxKey =
    lastSeg?.discriminator.type === "key"
      ? (lastSeg.discriminator as { type: "key"; value: string }).value
      : undefined;

  lastMoveDir = dir;
  send({
    type: "moveSibling",
    filePath: currentSelection.filePath,
    lineNumber: currentSelection.lineNumber,
    columnNumber: currentSelection.columnNumber,
    direction: dir,
    componentName: currentSelection.componentName,
    tagName: currentSelection.tagName,
    className: el.className || undefined,
    parentTagName: parent?.tagName.toLowerCase(),
    parentClassName: parent?.className || undefined,
    nthOfType,
    elementId: el.id || undefined,
    jsxKey,
    text:
      (el.textContent || "").replaceAll(/\s+/g, " ").trim().slice(0, 80) ||
      undefined,
    contextText: moveContextText(el),
    jsxPath: currentSelection.jsxPath,
  });
}

let moveResultListenerAttached = false;
function attachMoveResultListener(): void {
  if (moveResultListenerAttached) {
    return;
  }
  moveResultListenerAttached = true;
  onMessage((msg) => {
    if (msg.type !== "moveSiblingComplete") {
      return;
    }
    if (msg.pending) {
      lastMoveDir = null;
      return;
    } // a confirm proposal is coming
    if (msg.success) {
      showToast(lastMoveDir === "down" ? "Moved down" : "Moved up");
      // The source changed; HMR will re-render. Drop the now-stale selection
      // so the highlight doesn't linger on a detached/reused node.
      clearSelection();
    } else {
      showToast(msg.error || "Couldn't move element");
    }
    lastMoveDir = null;
  });
}

// --- Mouse & keyboard handlers ---------------------------------------------

/** Recompute the hover outline at the last cursor position (e.g. after the
 *  interact key is released, so the outline returns without needing a move). */
function refreshIdleHover(): void {
  if (mode !== "idle") {
    return;
  }
  if (isInteractActive()) {
    setHoverTarget(null);
    return;
  }
  const el = getCanonicalSelectableElement(lastMouseX, lastMouseY);
  if (!el || !isValidElement(el)) {
    setHoverTarget(null);
    return;
  }
  const rect = el.getBoundingClientRect();
  const br = Number(getComputedStyle(el).borderRadius) || 4;
  setHoverTarget(rect, br + 2);
}

/** Check for a resize corner handle under the cursor and enter resize-drag if
 *  found (works for both single and multi-select). Returns true if consumed. */
function beginResizeDrag(e: MouseEvent): boolean {
  const hasSelection = currentSelection || multiSelected.size > 0;
  if (!hasSelection) {
    return false;
  }
  const handle = getHandleAtPoint(e.clientX, e.clientY);
  if (!handle) {
    return false;
  }
  e.preventDefault();
  e.stopPropagation();
  const geo = getSelectionGeometry();
  resizeDragCorner = handle;
  resizeInitialRect = geo ? { ...geo } : null;

  if (multiSelected.size > 0) {
    // Multi-select resize: store initial sizes for all selected elements
    multiResizeInitials = [];
    for (const [element] of multiSelected) {
      const computed = getComputedStyle(element);
      multiResizeInitials.push({
        element,
        width: Number(computed.width) || element.offsetWidth,
        height: Number(computed.height) || element.offsetHeight,
      });
    }
    resizeInitialWidth = 0;
    resizeInitialHeight = 0;
  } else if (selectedElement) {
    const computed = getComputedStyle(selectedElement);
    resizeInitialWidth = Number(computed.width) || selectedElement.offsetWidth;
    resizeInitialHeight =
      Number(computed.height) || selectedElement.offsetHeight;
    multiResizeInitials = [];
  }

  mouseDownPos = { x: e.clientX, y: e.clientY };
  mode = "resize-drag";
  return true;
}

/** Clicking on empty/invalid area → save changes and deselect everything. */
function deselectOnEmptyClick(): void {
  if (!(currentSelection || multiSelected.size > 0)) {
    return;
  }
  propertyPanel.commitAndDeselect();
  currentSelection = null;
  selectedElement = null;
  clearMultiSelectState();
  setSelectionTarget(null);
  hideSelectionLabel();
  updateComponentDetail(null);
}

function handleMouseDown(e: MouseEvent): void {
  if (!isActive) {
    return;
  }
  if (isTextEditing()) {
    return;
  }
  if (isPanningActive()) {
    return;
  }

  // Interact key (`) held → let the click reach the app instead of selecting
  // (follow links, press buttons, open menus, etc.).
  if (isInteractActive()) {
    return;
  }

  // Ignore clicks on the overlay's own UI (sidebar, toolbar, etc.)
  // composedPath() pierces Shadow DOM boundaries
  const path = e.composedPath();
  if (
    path.some((el) => el instanceof HTMLElement && el.id === "themelab-root")
  ) {
    return;
  }

  const el = getCanonicalSelectableElement(e.clientX, e.clientY);

  // Check if clicking on a resize corner handle (works for both single and multi-select)
  if (beginResizeDrag(e)) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  if (!el || !isValidElement(el)) {
    deselectOnEmptyClick();
    return;
  }

  mouseDownPos = { x: e.clientX, y: e.clientY };
  mouseDownElement = el;
  // ⌘/Ctrl+click toggles multi-select (Shift is now the interact modifier).
  isMultiSelectClick = e.metaKey || e.ctrlKey;

  // If clicking on an element that already has a move entry → start re-drag immediately
  if (hasMoveForElement(el) && tryStartMove(e.clientX, e.clientY, el)) {
    mode = "move-drag";
    return;
  }

  // If clicking on the currently selected element (not shift-click) → prepare for possible move-drag
  if (!isMultiSelectClick && selectedElement && el === selectedElement) {
    mode = "pending-move";
    return;
  }

  // Clicking unselected element → pending (may become marquee or click-to-select)
  mode = "pending";
}

/** Resize drag — compute new width/height from mouse delta. */
function handleResizeDragMove(e: MouseEvent): void {
  if (!resizeDragCorner || !mouseDownPos || !resizeInitialRect) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  const dx = e.clientX - mouseDownPos.x;
  const dy = e.clientY - mouseDownPos.y;
  const growsRight = resizeDragCorner === "tr" || resizeDragCorner === "br";
  const growsDown = resizeDragCorner === "bl" || resizeDragCorner === "br";

  if (multiResizeInitials.length > 0) {
    // Multi-select resize: apply same delta to all elements
    for (const entry of multiResizeInitials) {
      const newW = growsRight
        ? Math.max(10, entry.width + dx)
        : Math.max(10, entry.width - dx);
      const newH = growsDown
        ? Math.max(10, entry.height + dy)
        : Math.max(10, entry.height - dy);
      entry.element.style.width = `${Math.round(newW)}px`;
      entry.element.style.height = `${Math.round(newH)}px`;
    }
    updateMultiSelectionHighlights();
  } else {
    // Single-select resize
    const newWidth = Math.round(
      growsRight
        ? Math.max(10, resizeInitialWidth + dx)
        : Math.max(10, resizeInitialWidth - dx)
    );
    const newHeight = Math.round(
      growsDown
        ? Math.max(10, resizeInitialHeight + dy)
        : Math.max(10, resizeInitialHeight - dy)
    );

    propertyPanel.preview("width", `${newWidth}px`);
    propertyPanel.preview("height", `${newHeight}px`);
    updateSelectionPosition();
  }
}

/** Pending-move → move-drag (drag threshold for selected element). */
function handlePendingMoveDrag(e: MouseEvent): void {
  if (!mouseDownPos) {
    return;
  }
  const dx = Math.abs(e.clientX - mouseDownPos.x);
  const dy = Math.abs(e.clientY - mouseDownPos.y);
  if (dx > 4 || dy > 4) {
    // Exceeded drag threshold — start move
    if (
      mouseDownElement &&
      tryStartMove(mouseDownPos.x, mouseDownPos.y, mouseDownElement)
    ) {
      mode = "move-drag";
      // Immediately update to current mouse position
      updateMovePosition(e.clientX, e.clientY);
    } else {
      // Couldn't start move — fall back to marquee
      mode = "marquee";
    }
  }
}

function updateMarqueeBox(e: MouseEvent): void {
  if (!mouseDownPos || !marqueeBox) {
    return;
  }
  const x = Math.min(e.clientX, mouseDownPos.x);
  const y = Math.min(e.clientY, mouseDownPos.y);
  const w = Math.abs(e.clientX - mouseDownPos.x);
  const h = Math.abs(e.clientY - mouseDownPos.y);
  marqueeBox.style.display = "block";
  marqueeBox.style.left = `${x}px`;
  marqueeBox.style.top = `${y}px`;
  marqueeBox.style.width = `${w}px`;
  marqueeBox.style.height = `${h}px`;
}

/** Hover highlight (only when idle — no mouse button down). */
function handleIdleHover(e: MouseEvent): void {
  // Cursor is over the overlay's own UI (sidebar, toolbar, panels) — don't
  // pierce through to highlight the page element behind it. The selection
  // highlights/labels are pointer-events:none, so they never trigger this;
  // only the interactive chrome does. Mirrors the click guard above.
  const path = e.composedPath();
  if (
    path.some((el) => el instanceof HTMLElement && el.id === "themelab-root")
  ) {
    setHoverTarget(null);
    document.body.style.cursor = "";
    return;
  }

  // Interact key (`) held: drop the selection highlight so the pointer reads as
  // "interacting with the app". The vanishing outline is the signal that the
  // next click will hit the app, not select an element.
  if (isInteractActive()) {
    setHoverTarget(null);
    document.body.style.cursor = "";
    return;
  }

  // Show resize cursor when hovering over a corner handle (single or multi-select)
  const hasAnySelection =
    (currentSelection && selectedElement) || multiSelected.size > 0;
  if (hasAnySelection) {
    const handle = getHandleAtPoint(e.clientX, e.clientY);
    if (handle) {
      document.body.style.cursor =
        handle === "tl" || handle === "br" ? "nwse-resize" : "nesw-resize";
      return;
    }
    document.body.style.cursor = "";
  }

  const el = getCanonicalSelectableElement(e.clientX, e.clientY);
  if (!el || !isValidElement(el)) {
    setHoverTarget(null);
    return;
  }
  const rect = el.getBoundingClientRect();
  const br = Number(getComputedStyle(el).borderRadius) || 4;
  setHoverTarget(rect, br + 2);
}

function handleMouseMove(e: MouseEvent): void {
  if (!isActive) {
    return;
  }
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  if (isTextEditing()) {
    return;
  }
  if (isPanningActive()) {
    return;
  }

  if (mode === "resize-drag") {
    handleResizeDragMove(e);
    return;
  }

  if (mode === "pending-move") {
    handlePendingMoveDrag(e);
    return;
  }

  // Active move-drag — update position
  if (mode === "move-drag") {
    updateMovePosition(e.clientX, e.clientY);
    return;
  }

  if (mode === "pending" && mouseDownPos) {
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    if (dx > 10 || dy > 10) {
      mode = "marquee";
    }
  }

  if (mode === "marquee") {
    updateMarqueeBox(e);
    return;
  }

  if (mode === "idle") {
    handleIdleHover(e);
  }
}

function handleMouseUp(e: MouseEvent): void {
  if (!isActive) {
    return;
  }
  if (isTextEditing()) {
    return;
  }
  if (isPanningActive()) {
    return;
  }

  const prevMode = mode;
  mode = "idle";

  // Commit resize
  if (prevMode === "resize-drag") {
    document.body.style.cursor = "";
    resizeDragCorner = null;
    resizeInitialRect = null;
    mouseDownPos = null;
    if (multiResizeInitials.length > 0) {
      multiResizeInitials = [];
    } else {
      propertyPanel.scheduledCommit();
    }
    return;
  }

  // Complete move-drag
  if (prevMode === "move-drag") {
    const movedEl = endMove();
    if (movedEl) {
      selectElementForMove(movedEl);
    }
    mouseDownPos = null;
    mouseDownElement = null;
    return;
  }

  // Pending-move that didn't exceed threshold → treat as click (re-select)
  if (prevMode === "pending-move") {
    // Already selected — no action needed
    mouseDownPos = null;
    mouseDownElement = null;
    return;
  }

  if (prevMode === "marquee" && mouseDownPos) {
    if (marqueeBox) {
      marqueeBox.style.display = "none";
    }
    performMarqueeSelect(
      Math.min(e.clientX, mouseDownPos.x),
      Math.min(e.clientY, mouseDownPos.y),
      Math.max(e.clientX, mouseDownPos.x),
      Math.max(e.clientY, mouseDownPos.y)
    );
    mouseDownPos = null;
    mouseDownElement = null;
    isMultiSelectClick = false;
    return;
  }

  // prevMode was "pending" — treat as a click
  if (mouseDownElement) {
    if (isMultiSelectClick) {
      toggleMultiSelect(mouseDownElement);
    } else {
      // Regular click: clear multi-select, do single select
      clearMultiSelectState();
      selectElement(mouseDownElement);
    }
  }
  mouseDownPos = null;
  mouseDownElement = null;
  isMultiSelectClick = false;
}

function handleClick(e: MouseEvent): void {
  if (!isActive) {
    return;
  }
  if (isTextEditing()) {
    return;
  }
  // Interact key (`) held → let the app handle the click (links, buttons).
  if (isInteractActive()) {
    return;
  }
  // Block all other clicks (prevents link navigation, form submission, etc.)
  e.preventDefault();
}

// --- Keyboard shortcuts ------------------------------------------------------

/** Backtick (`) = toggle interact mode. Skip while typing so the key still works
 *  in fields. A toast + the hover outline (gone in interact mode) show the state.
 *  Returns true if it consumed the key. */
function handleInteractToggleKey(
  e: KeyboardEvent,
  isEditing: boolean
): boolean {
  if (!(e.code === "Backquote" || e.key === "`") || isEditing) {
    return false;
  }
  interactMode = !interactMode;
  document.body.style.cursor = "";
  refreshIdleHover();
  showToast(interactMode ? "Interact mode — press ` to select" : "Select mode");
  e.preventDefault();
  return true;
}

/** Cmd+C — Copy selected element. Returns true if it consumed the key. */
function handleCopyKey(e: KeyboardEvent): boolean {
  if (!selectedElement || !currentSelection) {
    return false;
  }
  if (currentSelection.filePath) {
    copyElement(selectedElement, currentSelection);
    showToast("Copied");
    e.preventDefault();
  } else {
    showToast("Cannot copy — no source file resolved");
  }
  return true;
}

/** Register a fresh clone in canvas state and the changelog. */
function recordCloneChange(cloneEntry: CloneEntry): void {
  addClone(cloneEntry);
  addChangeEntry({
    type: "clone",
    componentName: cloneEntry.sourceLocation.componentName,
    filePath: cloneEntry.sourceLocation.filePath,
    summary: `duplicated <${cloneEntry.domHints.tagName}>`,
    state: "pending",
    elementIdentity: {
      componentName: cloneEntry.sourceLocation.componentName,
      filePath: cloneEntry.sourceLocation.filePath,
      lineNumber: cloneEntry.sourceLocation.lineNumber,
      columnNumber: cloneEntry.sourceLocation.columnNumber,
      tagName: cloneEntry.domHints.tagName,
      jsxPath: cloneEntry.domHints.jsxPath,
    },
    revertData: { type: "cloneRemove", cloneId: cloneEntry.id },
  });
}

/** Cmd+V — Paste cloned element. Returns true if it consumed the key. */
function handlePasteKey(e: KeyboardEvent): boolean {
  if (!hasClipboard()) {
    return false;
  }
  const cloneEntry = pasteElement();
  if (cloneEntry) {
    recordCloneChange(cloneEntry);
    selectElement(cloneEntry.element);
    showToast("Pasted");
  }
  e.preventDefault();
  return true;
}

/** Cmd+D — Duplicate in place. Returns true if it consumed the key. */
function handleDuplicateKey(e: KeyboardEvent): boolean {
  if (!selectedElement || !currentSelection || !currentSelection.filePath) {
    return false;
  }
  if (isInsideMapTemplate(currentSelection)) {
    showToast("Cannot duplicate elements inside .map()");
    e.preventDefault();
    return true;
  }
  copyElement(selectedElement, currentSelection);
  const cloneEntry = pasteElement();
  if (cloneEntry) {
    recordCloneChange(cloneEntry);
    selectElement(cloneEntry.element);
    showToast("Duplicated");
  }
  e.preventDefault();
  return true;
}

/** Delete / Backspace — remove selected element. Returns true if consumed. */
function handleDeleteKey(e: KeyboardEvent, isEditing: boolean): boolean {
  if ((e.key !== "Delete" && e.key !== "Backspace") || isEditing) {
    return false;
  }
  if (!selectedElement || !currentSelection) {
    return false;
  }
  const cloneEntry = getCloneForElement(selectedElement);
  if (cloneEntry) {
    removeCloneEntry(cloneEntry.id);
    clearSelection();
    showToast("Clone removed");
    e.preventDefault();
    return true;
  }
  if (!currentSelection.filePath) {
    showToast("Cannot delete — no source file resolved");
    e.preventDefault();
    return true;
  }
  if (isInsideMapTemplate(currentSelection)) {
    showToast("Cannot delete elements inside .map()");
    e.preventDefault();
    return true;
  }
  const entry = deleteElement(selectedElement, currentSelection);
  if (entry) {
    addDelete(entry);
    addChangeEntry({
      type: "delete",
      componentName: entry.sourceLocation.componentName,
      filePath: entry.sourceLocation.filePath,
      summary: `deleted <${entry.domHints.tagName}>`,
      state: "pending",
      elementIdentity: {
        componentName: entry.sourceLocation.componentName,
        filePath: entry.sourceLocation.filePath,
        lineNumber: entry.sourceLocation.lineNumber,
        columnNumber: entry.sourceLocation.columnNumber,
        tagName: entry.domHints.tagName,
        jsxPath: entry.domHints.jsxPath,
      },
      revertData: { type: "deleteRestore", deleteId: entry.id },
    });
    clearSelection();
    showToast("Deleted");
  }
  e.preventDefault();
  return true;
}

function handleEscapeKey(e: KeyboardEvent): void {
  // Clear multi-select first
  if (multiSelected.size > 0) {
    clearMultiSelectState();
    hideSelectionLabel();
    updateComponentDetail(null);
    e.preventDefault();
    return;
  }
  if (!currentSelection) {
    return;
  }
  // Before clearing selection on Escape, check if property controller has active overrides
  if (propertyPanel.hasActiveOverrides()) {
    propertyPanel.cancel();
    e.preventDefault();
    return; // Don't clear selection, just cancel the preview
  }
  clearSelection();
  e.preventDefault();
}

/** Shared guard for the navigation shortcuts: not typing, not interacting,
 *  and no browser-level modifier held. */
function isPlainNavCombo(e: KeyboardEvent, isEditing: boolean): boolean {
  return (
    !isEditing && !isInteractActive() && !e.metaKey && !e.ctrlKey && !e.altKey
  );
}

/** Arrow keys = hierarchy navigation (↑ parent, ↓ child, ←/→ siblings).
 *  Only when a single element is selected and we're not typing or interacting. */
function handleArrowNavKey(e: KeyboardEvent, isEditing: boolean): void {
  if (!(e.key in ARROW_TO_DIR) || !isPlainNavCombo(e, isEditing)) {
    return;
  }
  if (navigateHierarchy(e.key)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** [ / ] = move the selected element up / down among its source siblings. */
function handleSiblingReorderKey(e: KeyboardEvent, isEditing: boolean): void {
  if ((e.key !== "[" && e.key !== "]") || !isPlainNavCombo(e, isEditing)) {
    return;
  }
  if (selectedElement && currentSelection && multiSelected.size === 0) {
    moveSelectedSibling(e.key === "[" ? "up" : "down");
    e.preventDefault();
    e.stopPropagation();
  }
}

/** z / x = drill down / surface up through elements stacked at the selection's
 *  center point (overlapping layers the hierarchy arrows can't reach). */
function handleZStackKey(e: KeyboardEvent, isEditing: boolean): void {
  if ((e.key !== "z" && e.key !== "x") || !isPlainNavCombo(e, isEditing)) {
    return;
  }
  if (selectedElement && currentSelection && multiSelected.size === 0) {
    navigateZStack(e.key === "z" ? 1 : -1);
    e.preventDefault();
    e.stopPropagation();
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (!isActive) {
    return;
  }

  // Resolve focus through the overlay's shadow DOM — document.activeElement only
  // reports the shadow host, so an overlay input wouldn't otherwise count as editing.
  const isEditing = isTextEditing() || isEditableFocused();

  if (handleInteractToggleKey(e, isEditing)) {
    return;
  }

  const isCmdCombo =
    (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !isEditing;
  if (isCmdCombo) {
    if (e.key === "c" && handleCopyKey(e)) {
      return;
    }
    if (e.key === "v" && handlePasteKey(e)) {
      return;
    }
    if (e.key === "d" && handleDuplicateKey(e)) {
      return;
    }
  }

  if (handleDeleteKey(e, isEditing)) {
    return;
  }

  if (e.key === "Escape") {
    handleEscapeKey(e);
    return;
  }

  handleArrowNavKey(e, isEditing);
  handleSiblingReorderKey(e, isEditing);
  handleZStackKey(e, isEditing);
}

// --- Lifecycle ---------------------------------------------------------------

export function initSelection(): void {
  registerSelectElement(selectElement);
  registerSelectionAccessor({ getSelection, getSelectedElement });

  const shadowRoot = getShadowRoot();
  if (!shadowRoot) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = OVERLAY_STYLES;
  shadowRoot.append(style);

  selectionLabel = document.createElement("div");
  selectionLabel.className = "selection-label";
  shadowRoot.append(selectionLabel);

  marqueeBox = document.createElement("div");
  marqueeBox.className = "marquee-box";
  shadowRoot.append(marqueeBox);

  isActive = true;
  attachMoveResultListener();

  // Single set of event listeners — selection.ts owns all mouse dispatch
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("scroll", updateSelectionPosition, true);
  window.addEventListener("resize", updateSelectionPosition);
  listenersAttached = true;
}

export function deactivateSelection(): void {
  isActive = false;
  unfreezeSelected();
  document.removeEventListener("mousedown", handleMouseDown, true);
  document.removeEventListener("mousemove", handleMouseMove, true);
  document.removeEventListener("mouseup", handleMouseUp, true);
  document.removeEventListener("keydown", handleKeyDown, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("scroll", updateSelectionPosition, true);
  window.removeEventListener("resize", updateSelectionPosition);
  interactMode = false;
  listenersAttached = false;
  selectionLabel?.remove();
  selectionLabel = null;
}

/**
 * Enable/disable Phase 1 selection handlers.
 * setEnabled(false) removes capture-phase listeners so the interaction layer can receive events.
 * setEnabled(true) re-attaches them for Pointer mode.
 * Different from deactivateSelection() which is a permanent teardown.
 */
export function setEnabled(enabled: boolean): void {
  if (enabled && !listenersAttached) {
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("scroll", updateSelectionPosition, true);
    window.addEventListener("resize", updateSelectionPosition);
    listenersAttached = true;
    isActive = true;
  } else if (!enabled && listenersAttached) {
    document.removeEventListener("mousedown", handleMouseDown, true);
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("mouseup", handleMouseUp, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("scroll", updateSelectionPosition, true);
    window.removeEventListener("resize", updateSelectionPosition);
    interactMode = false;
    listenersAttached = false;
    isActive = false;
  }
}

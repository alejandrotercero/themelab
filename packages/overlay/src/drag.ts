import type { ComponentInfo, SiblingInfo } from "@themelab/shared";
// packages/overlay/src/drag.ts
import { getFiberFromHostInstance, isCompositeFiber } from "bippy";

import { send, onMessage } from "./bridge.js";
import { addPendingReorderOperation } from "./canvas-state.js";
import { clearSelection, setDragCallbacks } from "./selection.js";
import { getShadowRoot, showToast } from "./toolbar.js";
import { getDebugSource } from "./utils/fiber-debug-source.js";

// Drag state — preview is created immediately, siblings arrive async
let preview: HTMLDivElement | null = null;
let dropIndicator: HTMLDivElement | null = null;
let dragSelection: ComponentInfo | null = null;
let isDragging = false;
let dragStartPos: { x: number; y: number } | null = null;

// Sibling data — populated asynchronously after getSiblings response
let siblings: SiblingInfo[] = [];
let siblingElements = new Map<number, { el: HTMLElement; rect: DOMRect }>();
let siblingsReady = false;

const DRAG_STYLES = `
  .drag-preview {
    position: fixed;
    pointer-events: none;
    opacity: 0.6;
    z-index: 2147483647;
    border: 2px solid #1e88e5;
    border-radius: 4px;
    overflow: hidden;
    display: none;
  }
  .drop-indicator {
    position: fixed;
    height: 3px;
    background: #1e88e5;
    z-index: 2147483646;
    display: none;
    pointer-events: none;
    border-radius: 2px;
  }
  .drop-indicator::before,
  .drop-indicator::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    background: #1e88e5;
    border-radius: 50%;
    top: -3px;
  }
  .drop-indicator::before { left: -4px; }
  .drop-indicator::after { right: -4px; }
`;

let dropTarget: SiblingInfo | null = null;

function cleanupDrag(): void {
  preview?.remove();
  dropIndicator?.remove();
  preview = null;
  dropIndicator = null;
  dragSelection = null;
  isDragging = false;
  dragStartPos = null;
  siblingsReady = false;
  siblings = [];
  siblingElements = new Map();
  dropTarget = null;
}

function handleDragStart(
  e: MouseEvent,
  el: HTMLElement,
  selection: ComponentInfo
): void {
  dragSelection = selection;
  dragStartPos = { x: e.clientX, y: e.clientY };
  isDragging = false;
  siblingsReady = false;
  siblings = [];
  siblingElements = new Map();
  dropTarget = null;

  const shadowRoot = getShadowRoot();
  if (!shadowRoot) {
    return;
  }

  // Create preview element immediately (shown once drag threshold met)
  preview = document.createElement("div");
  preview.className = "drag-preview";
  const rect = el.getBoundingClientRect();
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.innerHTML = el.outerHTML;
  shadowRoot.append(preview);

  dropIndicator = document.createElement("div");
  dropIndicator.className = "drop-indicator";
  shadowRoot.append(dropIndicator);

  // Request siblings asynchronously (drop indicators appear when ready)
  const [, parentStack] = selection.stack;
  if (!parentStack?.filePath) {
    showToast("Can't reorder this element");
    cleanupDrag();
    return;
  }

  send({
    type: "getSiblings",
    filePath: parentStack.filePath,
    parentLine: parentStack.lineNumber,
  });

  const unsubscribe = onMessage((msg) => {
    if (msg.type !== "siblingsList") {
      return;
    }
    unsubscribe();

    ({ siblings } = msg);

    // Match siblings to DOM elements using bippy fiber walking
    const allElements = document.querySelectorAll("*");
    for (const sibEl of allElements) {
      if (sibEl.closest("#themelab-root")) {
        continue;
      }
      const fiber = getFiberFromHostInstance(sibEl);
      if (!fiber) {
        continue;
      }

      // Walk up to find the nearest composite fiber with source info
      let current: typeof fiber | null = fiber;
      while (current) {
        if (isCompositeFiber(current)) {
          const debugSource = getDebugSource(current);
          if (debugSource) {
            for (const sib of msg.siblings) {
              if (
                debugSource.lineNumber === sib.lineNumber &&
                debugSource.fileName === parentStack.filePath
              ) {
                siblingElements.set(sib.lineNumber, {
                  el: sibEl as HTMLElement,
                  rect: (sibEl as HTMLElement).getBoundingClientRect(),
                });
              }
            }
            break; // Only check the nearest composite fiber
          }
        }
        current = current.return;
      }
    }

    siblingsReady = true;
  });
}

function handleDragMove(e: MouseEvent): void {
  if (!dragStartPos) {
    return;
  }

  const dx = Math.abs(e.clientX - dragStartPos.x);
  const dy = Math.abs(e.clientY - dragStartPos.y);
  if (dx < 5 && dy < 5) {
    return;
  }

  isDragging = true;

  // Show and move preview immediately
  if (preview) {
    preview.style.display = "block";
    preview.style.left = `${e.clientX + 10}px`;
    preview.style.top = `${e.clientY + 10}px`;
  }

  // Only show drop indicators once sibling data has arrived
  if (!siblingsReady || !dragSelection) {
    return;
  }

  let closestSibling: SiblingInfo | null = null;
  let closestDistance = Infinity;
  let indicatorY = 0;
  let indicatorLeft = 0;
  let indicatorWidth = 0;

  for (const sibling of siblings) {
    if (sibling.lineNumber === dragSelection.lineNumber) {
      continue;
    }

    const sibData = siblingElements.get(sibling.lineNumber);
    if (!sibData) {
      continue;
    }

    const sibRect = sibData.rect;
    const midY = sibRect.top + sibRect.height / 2;
    const distance = Math.abs(e.clientY - midY);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestSibling = sibling;
      indicatorY = e.clientY < midY ? sibRect.top - 2 : sibRect.bottom + 2;
      indicatorLeft = sibRect.left;
      indicatorWidth = sibRect.width;
    }
  }

  dropTarget = closestSibling;

  if (closestSibling && dropIndicator) {
    dropIndicator.style.display = "block";
    dropIndicator.style.top = `${indicatorY}px`;
    dropIndicator.style.left = `${indicatorLeft}px`;
    dropIndicator.style.width = `${indicatorWidth}px`;
  } else if (dropIndicator) {
    dropIndicator.style.display = "none";
  }
}

function handleDragEnd(_e: MouseEvent): void {
  if (!isDragging || !dropTarget || !dragSelection) {
    cleanupDrag();
    return;
  }

  if (!dragSelection.filePath) {
    showToast("Can't reorder this element");
    cleanupDrag();
    return;
  }

  addPendingReorderOperation(
    `${dragSelection.filePath}:${dragSelection.lineNumber}`,
    {
      op: "reorder",
      file: dragSelection.filePath,
      fromLine: dragSelection.lineNumber,
      toLine: dropTarget.lineNumber,
    }
  );

  cleanupDrag();
}

export function initDrag(): void {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = DRAG_STYLES;
  shadowRoot.append(style);

  // Register drag callbacks with selection.ts (no separate event listeners)
  setDragCallbacks({
    onStart: handleDragStart,
    onMove: handleDragMove,
    onEnd: handleDragEnd,
  });

  // Listen for reorder completion
  onMessage((msg) => {
    if (msg.type === "reorderComplete") {
      cleanupDrag();
      clearSelection();
    }
  });
}

export function deactivateDrag(): void {
  cleanupDrag();
}

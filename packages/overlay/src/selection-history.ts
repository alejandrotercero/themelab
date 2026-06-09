// packages/overlay/src/selection-history.ts
//
// Bounded stack of previously selected elements (newest first), surfaced in the
// History tab of the changelog panel. Entries keep both the live element ref
// (fast path while it's still connected) and an ElementIdentity so stale
// entries can be reacquired after HMR replaces the DOM.

import type { ComponentInfo, ElementIdentity } from "@themelab/shared";

export interface SelectionHistoryEntry {
  id: string;
  element: HTMLElement;
  identity: ElementIdentity;
  timestamp: number;
}

const MAX_HISTORY_ENTRIES = 50;

let entries: SelectionHistoryEntry[] = [];

// --- Listener pattern (matches canvas-state.ts) ---

type HistoryListener = () => void;
let historyListeners: HistoryListener[] = [];

export function onSelectionHistoryChange(fn: HistoryListener): () => void {
  historyListeners.push(fn);
  return () => {
    historyListeners = historyListeners.filter((f) => f !== fn);
  };
}

function notifyHistoryChange(): void {
  historyListeners.forEach((fn) => fn());
}

// --- Public API ---

export function recordSelection(element: HTMLElement, info: ComponentInfo): void {
  // Re-selecting the current head just refreshes its timestamp — no duplicate rows.
  if (entries[0]?.element === element) {
    entries[0].timestamp = Date.now();
    notifyHistoryChange();
    return;
  }

  // An element appears once, at its most recent position.
  entries = entries.filter((entry) => entry.element !== element);
  entries.unshift({
    id: crypto.randomUUID(),
    element,
    identity: {
      componentName: info.componentName,
      filePath: info.filePath,
      lineNumber: info.lineNumber,
      columnNumber: info.columnNumber,
      tagName: info.tagName,
      jsxPath: info.jsxPath,
    },
    timestamp: Date.now(),
  });
  if (entries.length > MAX_HISTORY_ENTRIES) entries.length = MAX_HISTORY_ENTRIES;
  notifyHistoryChange();
}

/** Newest first. */
export function getHistoryEntries(): SelectionHistoryEntry[] {
  return entries;
}

export function getHistoryEntry(id: string): SelectionHistoryEntry | undefined {
  return entries.find((entry) => entry.id === id);
}

export function clearSelectionHistory(): void {
  entries = [];
  notifyHistoryChange();
}

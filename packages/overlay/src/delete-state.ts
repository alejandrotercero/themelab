// packages/overlay/src/delete-state.ts
//
// Manages deleted DOM elements (instant removal, source commit on Confirm).
// Tracks parent + nextSibling for precise re-insertion on undo.

import type { ComponentInfo, JSXStructuralPath } from "@themelab/shared";

import { send } from "./bridge.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface DeleteEntry {
  id: string;
  element: HTMLElement;
  originalParent: HTMLElement;
  originalNextSibling: ChildNode | null;
  sourceInfo: ComponentInfo;
  sourceLocation: {
    filePath: string;
    lineNumber: number;
    columnNumber: number;
    componentName: string;
  };
  domHints: {
    tagName: string;
    className?: string;
    parentTagName?: string;
    parentClassName?: string;
    nthOfType?: number;
    elementId?: string;
    jsxKey?: string;
    jsxPath?: JSXStructuralPath;
  };
  fileMtime?: number;
  fileSize?: number;
}

const deletes = new Map<string, DeleteEntry>();

export function deleteElement(
  el: HTMLElement,
  info: ComponentInfo
): DeleteEntry | null {
  const parent = el.parentElement;
  if (!parent) {
    return null;
  }

  const deleteId = crypto.randomUUID();
  const { nextSibling } = el;
  const tagName = el.tagName.toLowerCase();
  const className = el.className || undefined;
  const parentTagName = parent.tagName.toLowerCase();
  const parentClassName = parent.className || undefined;
  const elementId = el.id || undefined;

  let nthOfType = 0;
  for (const child of parent.children) {
    if (child === el) {
      break;
    }
    if (child.tagName === el.tagName) {
      nthOfType += 1;
    }
  }

  const lastSegment = info.jsxPath?.segments.at(-1);

  const entry: DeleteEntry = {
    id: deleteId,
    element: el,
    originalParent: parent,
    originalNextSibling: nextSibling,
    sourceInfo: info,
    sourceLocation: {
      filePath: info.filePath,
      lineNumber: info.lineNumber,
      columnNumber: info.columnNumber,
      componentName: info.componentName,
    },
    domHints: {
      tagName,
      className,
      parentTagName,
      parentClassName,
      nthOfType,
      elementId,
      jsxKey:
        lastSegment?.discriminator.type === "key"
          ? (
              lastSegment.discriminator as {
                type: "key";
                value: string;
              }
            ).value
          : undefined,
      jsxPath: info.jsxPath,
    },
  };

  el.remove();

  if (info.filePath) {
    send({ type: "fileStat", filePath: info.filePath });
  }

  deletes.set(deleteId, entry);
  return entry;
}

export function restoreDeletedElement(id: string): void {
  const entry = deletes.get(id);
  if (!entry) {
    return;
  }
  const { element, originalParent, originalNextSibling } = entry;
  if (document.contains(originalParent)) {
    if (originalNextSibling && originalParent.contains(originalNextSibling)) {
      originalNextSibling.before(element);
    } else {
      originalParent.append(element);
    }
  }
  deletes.delete(id);
}

export function getDeletes(): Map<string, DeleteEntry> {
  return deletes;
}

export function updateDeleteFileStat(
  filePath: string,
  mtime: number,
  size: number
): void {
  for (const entry of deletes.values()) {
    if (
      entry.sourceLocation.filePath === filePath &&
      entry.fileMtime === undefined
    ) {
      entry.fileMtime = mtime;
      entry.fileSize = size;
    }
  }
}

export function clearAllDeletes(): void {
  for (const entry of deletes.values()) {
    const { element, originalParent, originalNextSibling } = entry;
    if (document.contains(originalParent)) {
      if (originalNextSibling && originalParent.contains(originalNextSibling)) {
        originalNextSibling.before(element);
      } else {
        originalParent.append(element);
      }
    }
  }
  deletes.clear();
}

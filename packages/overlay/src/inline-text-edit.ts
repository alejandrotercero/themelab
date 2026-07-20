import type {
  ServerMessage,
  ComponentInfo,
  ElementIdentity,
  TextEditAnchor,
  TextEditAnnotation,
} from "@themelab/shared";
import {
  getFiberFromHostInstance,
  isCompositeFiber,
  getDisplayName,
} from "bippy";

import { onMessage, requestFileDiscovery } from "./bridge.js";
import { getActiveTool, addTextEditAnnotation } from "./canvas-state.js";
import { addChangeEntry } from "./changelog.js";
import { COLORS } from "./design-tokens.js";
import {
  getCachedFilePath,
  setCachedFilePath,
} from "./file-discovery-cache.js";
import {
  setInteractionPointerEvents,
  activateInteraction,
  getPageElementAtPoint,
  registerIsTextEditing,
} from "./interaction.js";
import {
  clearSelection,
  selectElement,
  getSelection,
  getSelectedElement,
} from "./selection.js";
import { getElementVisibleText, getRangeVisibleText } from "./text-model.js";
import {
  isInternalName,
  isLibraryPath,
  isMdxFilePath,
  isValidElement,
} from "./utils/component-filter.js";
import { buildJSXPath } from "./utils/jsx-path.js";
import { computeNthOfType } from "./utils/nth-of-type.js";
import { getResolvedOwnerStack } from "./utils/server-symbolication.js";
import { resolveFrameFilePath } from "./utils/source-resolve.js";

type FiberNode = NonNullable<ReturnType<typeof getFiberFromHostInstance>>;

// --- Helpers ---

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

const TEXT_EDIT_CONTEXT_WINDOW = 32;

function findTextDiffRange(
  oldText: string,
  newText: string
): { start: number; oldEnd: number } | null {
  if (oldText === newText) {
    return null;
  }

  let start = 0;
  while (
    start < oldText.length &&
    start < newText.length &&
    oldText[start] === newText[start]
  ) {
    start += 1;
  }

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldText[oldEnd - 1] === newText[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return { start, oldEnd };
}

function buildTextEditAnchor(
  oldText: string,
  newText: string
): TextEditAnchor | undefined {
  const diff = findTextDiffRange(oldText, newText);
  if (!diff) {
    return undefined;
  }

  return {
    start: diff.start,
    end: diff.oldEnd,
    contextBefore: oldText.slice(
      Math.max(0, diff.start - TEXT_EDIT_CONTEXT_WINDOW),
      diff.start
    ),
    contextAfter: oldText.slice(
      diff.oldEnd,
      Math.min(oldText.length, diff.oldEnd + TEXT_EDIT_CONTEXT_WINDOW)
    ),
  };
}

// --- Blocklist: replaced/void elements where contentEditable is useless ---
const BLOCKED_TAGS = new Set([
  "IMG",
  "INPUT",
  "VIDEO",
  "IFRAME",
  "CANVAS",
  "SELECT",
  "TEXTAREA",
  "HR",
  "BR",
  "EMBED",
  "OBJECT",
  "PROGRESS",
]);
const TEXT_CONTAINER_TAGS = new Set([
  "P",
  "SPAN",
  "A",
  "BUTTON",
  "LABEL",
  "LI",
  "TD",
  "TH",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "STRONG",
  "EM",
  "SMALL",
  "CODE",
  "PRE",
]);

// --- Internal state ---
let editingElement: HTMLElement | null = null;
let originalTextContent = "";
let originalInnerHTML = "";
let lastKnownText = "";
let componentInfo: ComponentInfo | null = null;
let savedOutline = "";
let unsubscribeMessage: (() => void) | null = null;

// --- Pending commit for annotation fallback ---
let pendingCommit: {
  componentInfo: ComponentInfo;
  originalText: string;
  newText: string;
  cursorOffset?: number;
  textAnchor?: TextEditAnchor;
  originalInnerHTML: string;
  tagName: string;
} | null = null;

export function isTextEditing(): boolean {
  return editingElement !== null;
}

function handleUpdateTextResponse(
  msg: Extract<ServerMessage, { type: "updateTextComplete" }>
): void {
  if (msg.success && msg.undoId && pendingCommit) {
    // Path A: AST write succeeded — record as active change with undo support
    const pc = pendingCommit;
    const identity: ElementIdentity = {
      componentName: pc.componentInfo.componentName,
      filePath: pc.componentInfo.filePath,
      lineNumber: pc.componentInfo.lineNumber,
      columnNumber: pc.componentInfo.columnNumber,
      tagName: pc.tagName,
    };
    addChangeEntry({
      type: "textEdit",
      componentName: pc.componentInfo.componentName,
      filePath: pc.componentInfo.filePath,
      summary: `"${truncate(pc.originalText, 20)}" → "${truncate(pc.newText, 20)}"`,
      state: "active",
      elementIdentity: identity,
      revertData: { type: "cliUndo", undoIds: [msg.undoId] },
    });
  } else if (!msg.success && msg.reason === "no-match" && pendingCommit) {
    // Path B-1: AST write returned no-match — fall back to annotation
    const pc = pendingCommit;
    const ann: TextEditAnnotation = {
      type: "textEdit",
      id: `text-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      componentName: pc.componentInfo.componentName,
      filePath: pc.componentInfo.filePath,
      lineNumber: pc.componentInfo.lineNumber,
      columnNumber: pc.componentInfo.columnNumber,
      originalText: pc.originalText,
      newText: pc.newText,
      cursorOffset: pc.cursorOffset,
      textAnchor: pc.textAnchor,
    };
    const identity: ElementIdentity = {
      componentName: pc.componentInfo.componentName,
      filePath: pc.componentInfo.filePath,
      lineNumber: pc.componentInfo.lineNumber,
      columnNumber: pc.componentInfo.columnNumber,
      tagName: pc.tagName,
    };
    addTextEditAnnotation(ann, identity, pc.originalInnerHTML);
    addChangeEntry({
      type: "textAnnotation",
      componentName: ann.componentName,
      filePath: ann.filePath || "",
      summary: `"${truncate(ann.originalText, 20)}" → "${truncate(ann.newText, 20)}"`,
      state: "pending",
      elementIdentity: identity,
      revertData: {
        type: "annotationRemove",
        annotationId: ann.id,
        originalInnerHTML: pc.originalInnerHTML,
        elementIdentity: identity,
      },
    });
  }
  pendingCommit = null;
}

// --- Multi-line detection ---

function isMultiLine(el: HTMLElement): boolean {
  if (el.scrollHeight > el.clientHeight + 4) {
    return true;
  }
  if (el.querySelector("br")) {
    return true;
  }
  const style = getComputedStyle(el);
  if (style.whiteSpace !== "nowrap" && el.getClientRects().length > 1) {
    return true;
  }
  return false;
}

// --- Component resolution (matches selection.ts async pattern for React 19) ---

/** Strategy 1: async getOwnerStack (React 19 — _debugSource is absent). */
async function resolveViaOwnerStack(
  el: HTMLElement,
  fiber: FiberNode
): Promise<ComponentInfo | null> {
  try {
    const frames = await getResolvedOwnerStack(fiber);
    if (frames && frames.length > 0) {
      for (const frame of frames) {
        if (!frame.functionName) {
          continue;
        }
        const name = frame.functionName;
        if (name[0] !== name[0].toUpperCase()) {
          continue;
        }

        const filePath = resolveFrameFilePath(frame.fileName);

        // MDX content files: accept immediately — component name is synthetic
        if (filePath && isMdxFilePath(filePath)) {
          return {
            tagName: el.tagName.toLowerCase(),
            componentName: name,
            filePath,
            lineNumber: frame.lineNumber ?? 0,
            columnNumber: frame.columnNumber ?? 0,
            stack: [],
            boundingRect: el.getBoundingClientRect(),
            jsxPath: buildJSXPath(el, filePath, name) ?? undefined,
          };
        }

        if (isInternalName(name)) {
          continue;
        }

        // Skip library components (framer-motion, react-router, etc.)
        if (
          !filePath ||
          isLibraryPath(filePath) ||
          isLibraryPath(frame.fileName || "")
        ) {
          continue;
        }

        return {
          tagName: el.tagName.toLowerCase(),
          componentName: name,
          filePath,
          lineNumber: frame.lineNumber ?? 0,
          columnNumber: frame.columnNumber ?? 0,
          stack: [],
          boundingRect: el.getBoundingClientRect(),
          jsxPath: buildJSXPath(el, filePath, name) ?? undefined,
        };
      }
    }
  } catch {
    // getOwnerStack failed — fall through to fiber walk
  }
  return null;
}

/** Strategy 2: synchronous fiber walk fallback (React 18 — uses _debugSource). */
function resolveViaFiberWalk(
  el: HTMLElement,
  fiber: FiberNode
): ComponentInfo | null {
  try {
    let current: FiberNode | null = fiber;
    while (current) {
      if (isCompositeFiber(current)) {
        const name = getDisplayName(current.type);
        const debugSource =
          current._debugSource || current._debugOwner?._debugSource;

        if (name && name[0] === name[0].toUpperCase() && debugSource) {
          const filePath = debugSource.fileName || "";
          // MDX content files: accept immediately — component name is synthetic
          if (isMdxFilePath(filePath) || !isInternalName(name)) {
            return {
              tagName: el.tagName.toLowerCase(),
              componentName: name,
              filePath,
              lineNumber: debugSource.lineNumber || 0,
              columnNumber: debugSource.columnNumber || 0,
              stack: [],
              boundingRect: el.getBoundingClientRect(),
              jsxPath: buildJSXPath(el, filePath, name) ?? undefined,
            };
          }
        }
      }
      if (!current.return) {
        break;
      }
      current = current.return;
    }
  } catch {
    // Fiber resolution can fail
  }
  return null;
}

async function resolveComponent(
  el: HTMLElement
): Promise<ComponentInfo | null> {
  const fiber = getFiberFromHostInstance(el);
  if (!fiber) {
    return null;
  }

  const viaOwnerStack = await resolveViaOwnerStack(el, fiber);
  if (viaOwnerStack) {
    return viaOwnerStack;
  }

  return resolveViaFiberWalk(el, fiber);
}

function normalizeTextNodeValue(value: string | null | undefined): string {
  return (value ?? "").replaceAll("\u00A0", " ").trim();
}

function hasDirectVisibleText(el: HTMLElement): boolean {
  return [...el.childNodes].some(
    (node) =>
      node.nodeType === Node.TEXT_NODE &&
      normalizeTextNodeValue(node.textContent).length > 0
  );
}

function isInlineLikeDisplay(display: string): boolean {
  return (
    display === "inline" ||
    display === "inline-block" ||
    display === "inline-flex" ||
    display === "contents"
  );
}

function hasVisibleBlockChild(el: HTMLElement): boolean {
  return [...el.children].some((child) => {
    if (!(child instanceof HTMLElement)) {
      return false;
    }
    if (!getElementVisibleText(child).trim()) {
      return false;
    }
    return !isInlineLikeDisplay(getComputedStyle(child).display);
  });
}

function isEditableTextContainer(el: HTMLElement): boolean {
  if (BLOCKED_TAGS.has(el.tagName)) {
    return false;
  }
  if (!getElementVisibleText(el).trim()) {
    return false;
  }
  if (
    Object.hasOwn(el.dataset, "themelabInteraction") ||
    el.closest("#themelab-root")
  ) {
    return false;
  }

  const tagPrefersTextEditing = TEXT_CONTAINER_TAGS.has(el.tagName);
  return (
    (tagPrefersTextEditing || hasDirectVisibleText(el)) &&
    !hasVisibleBlockChild(el)
  );
}

function getSelectionAnchorElement(): HTMLElement | null {
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  if (!anchorNode) {
    return null;
  }
  if (anchorNode instanceof HTMLElement) {
    return anchorNode;
  }
  return anchorNode.parentElement;
}

function resolveClickTarget(e: MouseEvent): HTMLElement | null {
  const eventTarget = e.target;
  if (
    eventTarget instanceof HTMLElement &&
    eventTarget !== document.documentElement &&
    eventTarget !== document.body &&
    !Object.hasOwn(eventTarget.dataset, "themelabInteraction") &&
    !eventTarget.closest("#themelab-root")
  ) {
    return eventTarget;
  }
  return getPageElementAtPoint(e.clientX, e.clientY);
}

function resolveEditableTextTarget(e: MouseEvent): HTMLElement | null {
  const selectionAnchor = getSelectionAnchorElement();
  const eventTarget = e.target instanceof HTMLElement ? e.target : null;
  const clickedElement = resolveClickTarget(e);
  const start = selectionAnchor ?? eventTarget ?? clickedElement;
  if (!start) {
    return null;
  }

  let best: HTMLElement | null = null;
  for (
    let current: HTMLElement | null = start;
    current;
    current = current.parentElement
  ) {
    if (current === document.body || current === document.documentElement) {
      break;
    }
    if (current.closest("#themelab-root")) {
      break;
    }
    if (isEditableTextContainer(current)) {
      best = current;
    }
  }

  return best ?? clickedElement;
}

function getCaretOffsetWithin(element: HTMLElement): number | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  if (!range.collapsed) {
    return undefined;
  }
  if (!element.contains(range.endContainer)) {
    return undefined;
  }

  const prefix = range.cloneRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.endContainer, range.endOffset);
  return getRangeVisibleText(prefix).length;
}

/** If componentInfo's filePath is unknown, resolve it from the cache or kick
 *  off async file discovery (grep-based lookup by component name). Extracted
 *  out of recordTextEditAnnotation() to keep its branching manageable. */
function resolveMissingFilePath(): void {
  if (
    !componentInfo ||
    componentInfo.filePath ||
    !componentInfo.componentName
  ) {
    return;
  }
  const cached = getCachedFilePath(componentInfo.componentName);
  if (cached) {
    componentInfo = { ...componentInfo, filePath: cached };
    return;
  }
  // Fire async discovery — won't block, annotation created with empty path for now.
  // Capture the queried name now: componentInfo may be reassigned (or cleared by
  // exitEditMode) by the time this resolves, so a live read would be unsafe.
  const queriedName = componentInfo.componentName;
  // oxlint-disable-next-line promise/prefer-await-to-then -- intentional fire-and-forget: the annotation is created immediately (by the caller) with the current (possibly empty) filePath; awaiting here would delay that and change behavior
  requestFileDiscovery(queriedName).then((discovered) => {
    if (discovered) {
      setCachedFilePath(queriedName, discovered);
    }
  });
}

/** Builds the elementContext object addTextEditAnnotation needs to relocate
 *  the edit if the original element is gone by write time. Extracted out of
 *  recordTextEditAnnotation() to keep its branching manageable. */
function buildEditedElementContext(
  info: ComponentInfo
): Parameters<typeof addTextEditAnnotation>[3] {
  return {
    tagName: editingElement?.tagName.toLowerCase() || info.tagName,
    className: editingElement?.className || undefined,
    parentTagName: editingElement?.parentElement?.tagName.toLowerCase(),
    parentClassName: editingElement?.parentElement?.className || undefined,
    nthOfType: editingElement ? computeNthOfType(editingElement) : undefined,
    elementId: editingElement?.id || undefined,
    jsxPath: info.jsxPath,
    fileMtime: info.fileMtime,
    fileSize: info.fileSize,
  };
}

/** Builds and records the pending text-edit annotation (or triggers file
 *  discovery first when the component's file path is unknown). Extracted out
 *  of commitAndExit() to keep that function's branching manageable — this
 *  covers exactly the `changed && componentInfo` branch of the original body. */
function recordTextEditAnnotation(
  newText: string,
  cursorOffset: number | undefined,
  textAnchor: TextEditAnchor | undefined
): void {
  if (!componentInfo) {
    return;
  }

  resolveMissingFilePath();
  if (!componentInfo) {
    return;
  }

  const ann: TextEditAnnotation = {
    type: "textEdit",
    id: `text-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    componentName: componentInfo.componentName,
    filePath: componentInfo.filePath || "",
    lineNumber: componentInfo.lineNumber || 0,
    columnNumber: componentInfo.columnNumber || 0,
    originalText: originalTextContent,
    newText,
    cursorOffset,
    textAnchor,
  };
  const identity: ElementIdentity = {
    componentName: componentInfo.componentName,
    filePath: componentInfo.filePath || "",
    lineNumber: componentInfo.lineNumber || 0,
    columnNumber: componentInfo.columnNumber || 0,
    tagName: componentInfo.tagName,
  };
  addTextEditAnnotation(
    ann,
    identity,
    originalInnerHTML,
    buildEditedElementContext(componentInfo)
  );
  addChangeEntry({
    type: "textAnnotation",
    componentName: ann.componentName,
    filePath: ann.filePath || "",
    summary: `"${truncate(ann.originalText, 20)}" → "${truncate(ann.newText, 20)}"`,
    state: "pending",
    elementIdentity: identity,
    revertData: {
      type: "annotationRemove",
      annotationId: ann.id,
      originalInnerHTML,
      elementIdentity: identity,
    },
  });
}

function commitAndExit(options?: {
  nextSelection?: HTMLElement | null;
  clearSelection?: boolean;
  reselectEditedElement?: boolean;
}): void {
  if (!editingElement) {
    return;
  }

  const newText = lastKnownText;
  const cursorOffset = getCaretOffsetWithin(editingElement);
  const changed = newText !== originalTextContent;
  const textAnchor = changed
    ? buildTextEditAnchor(originalTextContent, newText)
    : undefined;

  console.log(
    "[ThemeLab:textEdit] commitAndExit changed:",
    changed,
    "componentInfo:",
    componentInfo?.componentName,
    "filePath:",
    componentInfo?.filePath
  );

  if (changed && componentInfo) {
    recordTextEditAnnotation(newText, cursorOffset, textAnchor);
  }

  const elementToSelect = editingElement;
  // oxlint-disable-next-line no-use-before-define -- exitEditMode and commitAndExit are mutually recursive (exitEditMode is invoked here; handleBlur/handleKeydown, defined after exitEditMode, call back into commitAndExit). Function declarations hoist, so this is safe at runtime; see ordering note above exitEditMode.
  exitEditMode();
  if (options?.nextSelection && document.contains(options.nextSelection)) {
    selectElement(options.nextSelection, { skipSidebar: false });
    return;
  }
  if (options?.clearSelection) {
    clearSelection();
    return;
  }
  if (options?.reselectEditedElement === false) {
    return;
  }
  // After exiting edit mode, highlight the edited element as selected
  if (elementToSelect && document.contains(elementToSelect)) {
    selectElement(elementToSelect, { skipSidebar: false });
  }
}

function handleBlur(): void {
  commitAndExit();
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    commitAndExit();
    return;
  }

  if (e.key === "Enter" && editingElement && !isMultiLine(editingElement)) {
    e.preventDefault();
    commitAndExit();
    return;
  }

  e.stopPropagation();
}

function handleInput(): void {
  if (editingElement) {
    lastKnownText = getElementVisibleText(editingElement);
  }
}

// exitEditMode references handleBlur/handleKeydown/handleInput (all defined
// above) to remove the listeners it added; commitAndExit (defined above, since
// handleBlur/handleKeydown call it) calls exitEditMode — a genuine mutual
// recursion between commitAndExit and exitEditMode that no linear ordering can
// fully avoid. See the disable-line on the `exitEditMode()` call in
// commitAndExit above.
function exitEditMode(): void {
  if (!editingElement) {
    return;
  }

  // Remove listeners BEFORE removeAttribute — removing contenteditable
  // can trigger a synchronous blur event, causing re-entrant commitAndExit
  editingElement.removeEventListener("blur", handleBlur);
  editingElement.removeEventListener("keydown", handleKeydown);
  editingElement.removeEventListener("input", handleInput);

  editingElement.removeAttribute("contenteditable");

  editingElement.style.outline = savedOutline;

  activateInteraction(getActiveTool());

  editingElement = null;
  originalTextContent = "";
  originalInnerHTML = "";
  lastKnownText = "";
  componentInfo = null;
  savedOutline = "";
}

function enterEditMode(element: HTMLElement): void {
  editingElement = element;

  originalTextContent = getElementVisibleText(element);
  originalInnerHTML = element.innerHTML;
  lastKnownText = originalTextContent;

  // Use the selection system's already-resolved component info (correct for React 19)
  // Falls back to local resolveComponent only if no selection exists
  const selectionInfo = getSelection();
  const selectedElement = getSelectedElement();
  if (selectionInfo && selectionInfo.filePath && selectedElement === element) {
    componentInfo = selectionInfo;
    console.log("[ThemeLab:textEdit] Using selection info:", {
      componentName: selectionInfo.componentName,
      filePath: selectionInfo.filePath,
      line: selectionInfo.lineNumber,
    });
  } else {
    componentInfo = null;
    console.log("[ThemeLab:textEdit] No selection match, resolving async...", {
      hasSelection: !!selectionInfo,
      selectionFilePath: selectionInfo?.filePath,
      selectedElement: selectedElement?.tagName,
      editElement: element.tagName,
    });
    // oxlint-disable-next-line promise/prefer-await-to-then -- intentional fire-and-forget: the synchronous setup below (outline, contentEditable, focus) must run immediately without waiting on fiber resolution
    resolveComponent(element).then((info) => {
      if (editingElement === element) {
        componentInfo = info;
        console.log("[ThemeLab:textEdit] Async resolve result:", {
          componentName: info?.componentName,
          filePath: info?.filePath,
          line: info?.lineNumber,
        });
      }
    });
  }

  savedOutline = element.style.outline;
  element.style.outline = `2px solid ${COLORS.accent}`;

  element.contentEditable = "true";

  setInteractionPointerEvents(false);

  element.focus();
  // Place cursor at the end of text content
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false); // collapse to end
    sel.addRange(range);
  }

  element.addEventListener("blur", handleBlur);
  element.addEventListener("keydown", handleKeydown);
  element.addEventListener("input", handleInput);
}

// --- Double-click handler ---

function handleDblClick(e: MouseEvent): void {
  if (editingElement) {
    commitAndExit();
  }

  const target = resolveEditableTextTarget(e);

  if (!target) {
    return;
  }
  if (BLOCKED_TAGS.has(target.tagName)) {
    return;
  }
  if (!getElementVisibleText(target).trim()) {
    return;
  }

  // Prevent browser's native word selection on double-click
  e.preventDefault();
  enterEditMode(target);
}

function handleOutsidePointerDown(e: MouseEvent): void {
  if (!editingElement) {
    return;
  }

  const eventTarget = e.target;
  if (
    eventTarget instanceof Node &&
    (eventTarget === editingElement || editingElement.contains(eventTarget))
  ) {
    return;
  }

  const targetElement = eventTarget instanceof HTMLElement ? eventTarget : null;
  if (targetElement?.closest("#themelab-root")) {
    commitAndExit();
    return;
  }

  const clickedElement = resolveClickTarget(e);
  if (clickedElement && isValidElement(clickedElement)) {
    e.preventDefault();
    e.stopPropagation();
    commitAndExit({
      nextSelection: clickedElement,
      reselectEditedElement: false,
    });
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  commitAndExit({ clearSelection: true, reselectEditedElement: false });
}

// --- Exports ---

export function initInlineTextEdit(): void {
  registerIsTextEditing(isTextEditing);
  document.addEventListener("dblclick", handleDblClick, true);
  document.addEventListener("mousedown", handleOutsidePointerDown, true);
  unsubscribeMessage = onMessage((msg: ServerMessage) => {
    if (msg.type === "updateTextComplete") {
      handleUpdateTextResponse(msg);
    }
  });
}

export function destroyInlineTextEdit(): void {
  if (editingElement) {
    exitEditMode();
  }
  document.removeEventListener("dblclick", handleDblClick, true);
  document.removeEventListener("mousedown", handleOutsidePointerDown, true);
  unsubscribeMessage?.();
  unsubscribeMessage = null;
}

export function cancelTextEditSession(): void {
  if (!editingElement) {
    return;
  }
  editingElement.innerHTML = originalInnerHTML;
  pendingCommit = null;
  exitEditMode();
}

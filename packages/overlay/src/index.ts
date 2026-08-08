import {
  initAnnotationLayer,
  destroyAnnotationLayer,
  clearAnnotationLayer,
  removeAnnotationElement,
} from "./annotation-layer.js";
// packages/overlay/src/index.ts
import { connect, disconnect, send, onMessage } from "./bridge.js";
import {
  onToolChange,
  onStateChange,
  getActiveTool,
  setActiveTool,
  canvasUndo,
  canUndo,
  resetCanvas,
  hasChanges,
  onAnnotationRemoved,
  getMoves,
  removeMove,
  getClones,
  removeCloneEntry,
  buildBatchOperations,
} from "./canvas-state.js";
import {
  destroyCanvasTransform,
  resetCanvasTransform,
  saveCanvasState,
  restoreCanvasState,
  clearSavedCanvasState,
  toggleCanvasTransform,
} from "./canvas-transform.js";
import {
  initChangelog,
  destroyChangelog,
  addChangeEntry,
  isChangelogOpen,
  setChangelogOpen,
  clearChangelog,
} from "./changelog.js";
import { updateCloneFileStat } from "./clone-state.js";
import { updateDeleteFileStat } from "./delete-state.js";
import {
  SHADOWS,
  RADII,
  TRANSITIONS,
  FONT_FAMILY,
  ensurePanelFont,
} from "./design-tokens.js";
import { initDrag, deactivateDrag } from "./drag.js";
import {
  initHighlightCanvas,
  destroyHighlightCanvas,
} from "./highlight-canvas.js";
import {
  initInlineTextEdit,
  destroyInlineTextEdit,
  cancelTextEditSession,
} from "./inline-text-edit.js";
import {
  initInteraction,
  destroyInteraction,
  activateInteraction,
} from "./interaction.js";
import type { MoveEntry } from "./move-state.js";
import {
  reacquireMovedElement,
  reacquireMovedElementAsync,
  applyMoveTransform,
} from "./move-state.js";
import { showOnboardingHint, dismissOnboarding } from "./onboarding.js";
import {
  initPropertyController,
  destroyPropertyController,
  bindToken,
  pickTailwindColor,
  preview as previewProperty,
  commit as commitProperty,
  cancel as cancelProperty,
} from "./properties/property-controller.js";
import { setVariantTarget } from "./properties/variant-target.js";
import { clearSelectionHistory } from "./selection-history.js";
import {
  initSelection,
  deactivateSelection,
  clearSelection,
  setEnabled,
  clearResolutionCache,
  previewDesktopStyle,
  clearDesktopPreviewStyles,
  refreshDesktopSelection,
  navigate,
  moveSelectedSibling,
} from "./selection.js";
import type { ComponentInfo } from "@themelab/shared";
import { initSettingsPanel, toggleSettingsPanel } from "./settings-panel.js";
import { initThemePanel, destroyThemePanel } from "./theme-panel.js";
import {
  commit as commitTheme,
  previewVar,
  resetPreview as resetThemePreview,
  setMode as setThemeMode,
} from "./theme-state.js";
import {
  mountToolbar,
  destroyToolbar,
  setOnGenerate,
  setOnGenerateAi,
  setOnCanvasUndo,
  updateGenerateButton,
  showToast,
  getShadowRoot,
} from "./toolbar.js";
import {
  initToolsPanel,
  destroyToolsPanel,
  updateActiveToolUI,
  setOnClearAll,
  setOnCanvasUndo as setOnCanvasUndoPanel,
  updateCanvasUndoButton,
  flashToolButton,
  toggleShortcutsOverlay,
} from "./tools-panel.js";
import { clearVisibilityCache } from "./utils/component-filter.js";
import { clearElementCache } from "./utils/element-cache.js";

declare global {
  interface Window {
    __THEMELAB_WS_PORT__?: number;
    __THEMELAB_DESKTOP_PREVIEW_STYLE__?: (
      property: string,
      value: string
    ) => ComponentInfo | null;
    __THEMELAB_DESKTOP_CLEAR_PREVIEW_STYLES__?: () => ComponentInfo | null;
    __THEMELAB_DESKTOP_PREVIEW_THEME__?: (
      mode: "light" | "dark",
      name: string,
      value: string
    ) => boolean;
    __THEMELAB_DESKTOP_PREVIEW_THEME_MODE__?: (
      mode: "light" | "dark"
    ) => boolean;
    __THEMELAB_DESKTOP_RESET_THEME__?: () => boolean;
    __THEMELAB_DESKTOP_COMMIT_THEME__?: () => boolean;
    __THEMELAB_DESKTOP_NAVIGATE__?: (
      direction: "up" | "down" | "left" | "right"
    ) => boolean;
    __THEMELAB_DESKTOP_MOVE__?: (direction: "up" | "down") => boolean;
    __THEMELAB_DESKTOP_UNDO__?: () => boolean;
    __THEMELAB_DESKTOP_CANVAS_UNDO__?: () => boolean;
    __THEMELAB_DESKTOP_RESET__?: () => boolean;
    __THEMELAB_DESKTOP_TOGGLE_CANVAS__?: () => boolean;
    __THEMELAB_DESKTOP_TOGGLE_HISTORY__?: () => boolean;
    __THEMELAB_DESKTOP_CLOSE__?: () => boolean;
    __THEMELAB_DESKTOP_BIND_TOKEN__?: (key: string, token: string) => boolean;
    __THEMELAB_DESKTOP_PICK_TAILWIND__?: (
      key: string,
      token: string,
      css: string
    ) => boolean;
    __THEMELAB_DESKTOP_SET_VARIANT__?: (breakpoint: string, dark: boolean) => boolean;
    __THEMELAB_DESKTOP_COMMIT__?: () => boolean;
    __THEMELAB_DESKTOP_COMMIT_AI__?: () => boolean;
    __THEMELAB_DESKTOP_TOGGLE_SHORTCUTS__?: () => boolean;
    __THEMELAB_DESKTOP_TOGGLE_SETTINGS__?: () => boolean;
  }
}

// ---------------------------------------------------------------------------
// Error boundary — prevents overlay crashes from affecting the host app
// ---------------------------------------------------------------------------

let errorToastEl: HTMLDivElement | null = null;
let errorToastTimeout: ReturnType<typeof setTimeout> | null = null;

/** Check if an error likely originated from overlay code */
function isOverlayError(error: unknown): boolean {
  const stack =
    error instanceof Error && error.stack ? error.stack : String(error);
  return /themelab|overlay/i.test(stack);
}

/** Show a minimal error toast inside the Shadow DOM */
function showErrorToast(message: string): void {
  const root = getShadowRoot();
  if (!root) {
    return;
  }

  // Remove existing error toast if present
  errorToastEl?.remove();
  if (errorToastTimeout) {
    clearTimeout(errorToastTimeout);
  }

  const container = document.createElement("div");
  container.setAttribute(
    "style",
    [
      "position: fixed",
      "bottom: 72px",
      "right: 16px",
      `z-index: 2147483647`,
      `background: rgba(30, 30, 30, 0.92)`,
      `color: #fff`,
      `font-family: ${FONT_FAMILY}`,
      `font-size: 12px`,
      `padding: 10px 14px`,
      `border-radius: ${RADII.sm}`,
      `box-shadow: ${SHADOWS.md}`,
      `max-width: 320px`,
      `display: flex`,
      `align-items: center`,
      `gap: 10px`,
      `opacity: 0`,
      `transition: opacity ${TRANSITIONS.medium}`,
    ].join("; ")
  );

  const text = document.createElement("span");
  text.textContent = message;
  text.setAttribute("style", "flex: 1;");

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "Dismiss";
  dismissBtn.setAttribute(
    "style",
    [
      "background: rgba(255,255,255,0.15)",
      "border: none",
      "color: #fff",
      `font-family: ${FONT_FAMILY}`,
      "font-size: 11px",
      "padding: 3px 8px",
      `border-radius: ${RADII.xs}`,
      "cursor: pointer",
      "white-space: nowrap",
    ].join("; ")
  );
  dismissBtn.addEventListener("click", () => {
    container.style.opacity = "0";
    setTimeout(() => container.remove(), 200);
    if (errorToastTimeout) {
      clearTimeout(errorToastTimeout);
    }
    errorToastEl = null;
  });

  container.append(text);
  container.append(dismissBtn);
  root.append(container);
  errorToastEl = container;

  // Fade in
  requestAnimationFrame(() => {
    container.style.opacity = "1";
  });

  // Auto-dismiss after 8 seconds
  errorToastTimeout = setTimeout(() => {
    container.style.opacity = "0";
    setTimeout(() => container.remove(), 200);
    errorToastEl = null;
  }, 8000);
}

/** Handle an overlay error: log it and show toast */
function handleOverlayError(error: unknown): void {
  console.error("[ThemeLab]", error);
  showErrorToast("ThemeLab encountered an error. Your app is unaffected.");
}

/** Install global error handlers that catch overlay-originating errors */
function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (event: ErrorEvent) => {
    if (isOverlayError(event.error ?? event.message)) {
      handleOverlayError(event.error ?? event.message);
      event.preventDefault(); // Prevent default browser error logging
    }
    // Non-overlay errors pass through untouched
  });

  window.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      if (isOverlayError(event.reason)) {
        handleOverlayError(event.reason);
        event.preventDefault();
      }
    }
  );
}

let moveObserver: MutationObserver | null = null;

const DESKTOP_PROPERTY_KEYS: Record<string, string> = {
  display: "display",
  "flex-direction": "flexDirection",
  "justify-content": "justifyContent",
  "align-items": "alignItems",
  gap: "gap",
  width: "width",
  height: "height",
  "min-width": "minWidth",
  "min-height": "minHeight",
  "max-width": "maxWidth",
  "max-height": "maxHeight",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "text-transform": "textTransform",
  "line-height": "lineHeight",
  "letter-spacing": "letterSpacing",
  "text-align": "textAlign",
  color: "color",
  "background-color": "backgroundColor",
  "border-radius": "borderRadius",
  "border-width": "borderWidth",
};

function previewDesktopProperty(property: string, value: string): ComponentInfo | null {
  const key = DESKTOP_PROPERTY_KEYS[property];
  if (key) {
    previewProperty(key, value);
    return refreshDesktopSelection();
  }
  return previewDesktopStyle(property, value);
}

function clearDesktopPreview(): ComponentInfo | null {
  cancelProperty();
  return clearDesktopPreviewStyles();
}

function resetOverlayState(): void {
  cancelTextEditSession();
  clearSelection();
  clearAnnotationLayer();
  clearChangelog();
  clearSelectionHistory();
  setChangelogOpen(false);
  resetCanvas();
  resetCanvasTransform();
  clearElementCache();
  clearVisibilityCache();
  clearResolutionCache();

  if (getActiveTool() === "select") {
    setEnabled(true);
    activateInteraction("select");
    updateActiveToolUI("select");
  } else {
    setActiveTool("select");
  }
}

function restoreMoveToElement(
  id: string,
  entry: MoveEntry,
  newEl: HTMLElement
): void {
  entry.originalCssText = newEl.style.cssText;
  entry.element = newEl;
  applyMoveTransform(entry);
}

function close(): void {
  delete window.__THEMELAB_DESKTOP_PREVIEW_STYLE__;
  delete window.__THEMELAB_DESKTOP_CLEAR_PREVIEW_STYLES__;
  delete window.__THEMELAB_DESKTOP_PREVIEW_THEME__;
  delete window.__THEMELAB_DESKTOP_PREVIEW_THEME_MODE__;
  delete window.__THEMELAB_DESKTOP_RESET_THEME__;
  delete window.__THEMELAB_DESKTOP_COMMIT_THEME__;
  delete window.__THEMELAB_DESKTOP_NAVIGATE__;
  delete window.__THEMELAB_DESKTOP_MOVE__;
  delete window.__THEMELAB_DESKTOP_UNDO__;
  delete window.__THEMELAB_DESKTOP_CANVAS_UNDO__;
  delete window.__THEMELAB_DESKTOP_RESET__;
  delete window.__THEMELAB_DESKTOP_TOGGLE_CANVAS__;
  delete window.__THEMELAB_DESKTOP_TOGGLE_HISTORY__;
  delete window.__THEMELAB_DESKTOP_CLOSE__;
  delete window.__THEMELAB_DESKTOP_BIND_TOKEN__;
  delete window.__THEMELAB_DESKTOP_PICK_TAILWIND__;
  delete window.__THEMELAB_DESKTOP_SET_VARIANT__;
  delete window.__THEMELAB_DESKTOP_COMMIT__;
  delete window.__THEMELAB_DESKTOP_COMMIT_AI__;
  delete window.__THEMELAB_DESKTOP_TOGGLE_SHORTCUTS__;
  delete window.__THEMELAB_DESKTOP_TOGGLE_SETTINGS__;
  cancelProperty();
  clearElementCache();
  clearVisibilityCache();
  clearResolutionCache();
  deactivateSelection();
  destroyHighlightCanvas();
  deactivateDrag();
  destroyPropertyController();
  destroyAnnotationLayer();
  moveObserver?.disconnect();
  destroyToolsPanel();
  destroyChangelog();
  destroyThemePanel();
  destroyInlineTextEdit();
  destroyInteraction();
  resetCanvas();
  window.removeEventListener("beforeunload", saveCanvasState);
  clearSavedCanvasState();
  destroyCanvasTransform();
  disconnect();
  destroyToolbar();
}

/** Re-enter canvas mode after `load` + a frame — always post-hydration, see init(). */
function deferredRestore(): void {
  requestAnimationFrame(() => setTimeout(restoreCanvasState, 200));
}

function init(): void {
  // Only run in the top-level frame — skip iframes to avoid duplicate WS connections
  if (window !== window.top) {
    return;
  }

  const wsPort = window.__THEMELAB_WS_PORT__;
  if (!wsPort) {
    console.warn("[ThemeLab] No WebSocket port found.");
    return;
  }

  if (document.querySelector("#themelab-root")) {
    return;
  } // Already initialized

  ensurePanelFont(); // Load Google Sans Code before any UI paints
  connect(wsPort);
  const desktopMode = new URLSearchParams(window.location.search).has(
    "themelabDesktop"
  );
  mountToolbar(close, { desktop: desktopMode });
  if (desktopMode) {
    window.__THEMELAB_DESKTOP_PREVIEW_STYLE__ = previewDesktopProperty;
    window.__THEMELAB_DESKTOP_CLEAR_PREVIEW_STYLES__ = clearDesktopPreview;
    window.__THEMELAB_DESKTOP_PREVIEW_THEME__ = (mode, name, value) => {
      setThemeMode(mode);
      previewVar(name, value);
      return true;
    };
    window.__THEMELAB_DESKTOP_PREVIEW_THEME_MODE__ = (mode) => {
      setThemeMode(mode);
      return true;
    };
    window.__THEMELAB_DESKTOP_RESET_THEME__ = () => {
      resetThemePreview();
      return true;
    };
    window.__THEMELAB_DESKTOP_COMMIT_THEME__ = () => commitTheme();
    window.__THEMELAB_DESKTOP_NAVIGATE__ = (direction) => {
      navigate(direction);
      return true;
    };
    window.__THEMELAB_DESKTOP_MOVE__ = (direction) => {
      moveSelectedSibling(direction);
      return true;
    };
    window.__THEMELAB_DESKTOP_UNDO__ = () => {
      send({ type: "undo" });
      return true;
    };
    window.__THEMELAB_DESKTOP_CANVAS_UNDO__ = () => {
      const description = canvasUndo();
      if (description) showToast(`Undo: ${description}`);
      return Boolean(description);
    };
    window.__THEMELAB_DESKTOP_RESET__ = () => {
      resetOverlayState();
      showToast("Everything reset");
      return true;
    };
    window.__THEMELAB_DESKTOP_TOGGLE_CANVAS__ = () => {
      toggleCanvasTransform();
      return true;
    };
    window.__THEMELAB_DESKTOP_TOGGLE_HISTORY__ = () => {
      setChangelogOpen(!isChangelogOpen());
      return true;
    };
    window.__THEMELAB_DESKTOP_CLOSE__ = () => {
      close();
      return true;
    };
    window.__THEMELAB_DESKTOP_BIND_TOKEN__ = (key, token) => {
      bindToken(key, token);
      return true;
    };
    window.__THEMELAB_DESKTOP_PICK_TAILWIND__ = (key, token, css) => {
      pickTailwindColor(key, token, css);
      return true;
    };
    window.__THEMELAB_DESKTOP_SET_VARIANT__ = (breakpoint, dark) => {
      setVariantTarget({ breakpoint, dark });
      return true;
    };
    window.__THEMELAB_DESKTOP_TOGGLE_SHORTCUTS__ = () => {
      toggleShortcutsOverlay();
      return true;
    };
    window.__THEMELAB_DESKTOP_TOGGLE_SETTINGS__ = () => {
      toggleSettingsPanel();
      return true;
    };
  }

  // Initialize property controller (requires Shadow DOM from mountToolbar)
  const shadowRoot = getShadowRoot();
  if (shadowRoot) {
    initPropertyController(shadowRoot);
    initChangelog(shadowRoot);
    initThemePanel(shadowRoot);
    initSettingsPanel(shadowRoot);
  }

  // Phase 1 systems
  initSelection();
  initHighlightCanvas();
  initDrag();

  // Phase 2A layers
  initAnnotationLayer();

  // Wire annotation removal from undo to SVG layer cleanup
  onAnnotationRemoved((id) => removeAnnotationElement(id));

  // HMR survival for moved elements
  moveObserver = new MutationObserver(() => {
    for (const [id, entry] of getMoves()) {
      if (!document.contains(entry.element)) {
        setTimeout(() => {
          // Try sync reacquisition first
          const newEl = reacquireMovedElement(entry.identity);
          if (newEl) {
            restoreMoveToElement(id, entry, newEl);
            return;
          }
          // Try async reacquisition
          void (async () => {
            const asyncEl = await reacquireMovedElementAsync(entry.identity);
            if (asyncEl) {
              restoreMoveToElement(id, entry, asyncEl);
            } else {
              removeMove(id);
              showToast(
                `Component ${entry.componentRef.componentName} removed — move cleared`
              );
            }
          })();
        }, 80);
      }
    }

    // Check if clones were detached by HMR
    for (const [id, entry] of getClones()) {
      if (!document.contains(entry.element)) {
        setTimeout(() => {
          if (document.contains(entry.originalElement)) {
            const parent = entry.originalElement.parentElement;
            if (parent) {
              entry.originalElement.after(entry.element);
              return;
            }
          }
          removeCloneEntry(id);
          showToast(
            `Clone of ${entry.sourceLocation.componentName} removed — original no longer present`
          );
        }, 80);
      }
    }
  });

  moveObserver.observe(document.body, { childList: true, subtree: true });

  // Keyboard shortcut: Cmd+Shift+L / Ctrl+Shift+L — toggle changelog
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "l") {
      e.preventDefault();
      setChangelogOpen(!isChangelogOpen());
    }
  });

  initToolsPanel();
  initInlineTextEdit();
  initInteraction();
  showOnboardingHint();

  // Select tool uses selection.ts capture-phase listeners directly (no interaction handler needed).
  // Only text tool needs an interaction handler.

  // Tool change listener — handles mode switching
  onToolChange((tool, _prev) => {
    dismissOnboarding();
    flashToolButton(tool);

    // Clear caches on tool switch
    clearElementCache();
    clearVisibilityCache();
    clearResolutionCache();

    // Enable/disable selection capture-phase listeners based on tool
    setEnabled(tool === "select");

    activateInteraction(tool);
    updateActiveToolUI(tool);
  });

  // State change → update confirm + canvas undo buttons
  onStateChange(() => {
    updateGenerateButton(hasChanges());
    updateCanvasUndoButton(canUndo());
  });

  // Canvas undo from tools panel sidebar
  setOnCanvasUndoPanel(() => {
    const description = canvasUndo();
    if (description) {
      showToast(`Undo: ${description}`);
    }
  });

  // Confirm button — deterministic batch for moves/colors/text edits.
  // "Confirm with AI" (forceAi) resolves every op via the AI locator up front.
  let generating = false;
  const doCommit = (forceAi: boolean) => {
    if (generating) {
      showToast("Operation in progress");
      return;
    }
    commitProperty();
    if (!hasChanges()) {
      showToast("Nothing to confirm — make some visual changes first");
      return;
    }

    const batchOps = buildBatchOperations();
    if (batchOps.length > 0) {
      generating = true;
      updateGenerateButton(false);
      const n = batchOps.length;
      showToast(
        `Applying ${n} change${n === 1 ? "" : "s"}${forceAi ? " with AI…" : "..."}`
      );
      send({
        type: "commitBatch",
        operations: batchOps,
        forceAi: forceAi || undefined,
      });
    } else {
      showToast(
        "Could not resolve source files for these changes — try re-selecting"
      );
    }
  };
  setOnGenerate(() => doCommit(false));
  setOnGenerateAi(() => doCommit(true));
  if (desktopMode) {
    window.__THEMELAB_DESKTOP_COMMIT__ = () => { doCommit(false); return true; };
    window.__THEMELAB_DESKTOP_COMMIT_AI__ = () => { doCommit(true); return true; };
  }

  // Handle commitBatch completion from CLI
  onMessage((msg) => {
    if (msg.type === "commitBatchComplete") {
      // Property sidebar saves also use commitBatch now; only the explicit
      // confirm/apply flow should drive the global generate/apply UI.
      if (!generating) {
        return;
      }

      generating = false;
      updateGenerateButton(hasChanges());

      const successCount = msg.results?.filter((r) => r.success).length ?? 0;
      const totalCount = msg.results?.length ?? 0;
      const undoIds = msg.undoIds ?? [];

      if (msg.success) {
        addChangeEntry({
          type: "commitBatch",
          componentName: "Batch Apply",
          filePath: "",
          summary: `${successCount}/${totalCount} changes applied`,
          state: "active",
          revertData: { type: "batchApplyUndo", undoIds },
        });
        showToast(`Applied ${successCount}/${totalCount} changes`);
        clearSelection();
        clearAnnotationLayer();
        resetCanvas();
        // Reload after source files are written — HMR may handle this,
        // but force reload as fallback to ensure the page reflects changes
        setTimeout(() => window.location.reload(), 600);
      } else if (successCount > 0) {
        // Partial success
        addChangeEntry({
          type: "commitBatch",
          componentName: "Batch Apply",
          filePath: "",
          summary: `${successCount}/${totalCount} changes applied (${totalCount - successCount} failed)`,
          state: "active",
          revertData: { type: "batchApplyUndo", undoIds },
        });
        showToast(
          `Applied ${successCount}/${totalCount} — ${totalCount - successCount} failed`
        );
        clearSelection();
        clearAnnotationLayer();
        resetCanvas();
        setTimeout(() => window.location.reload(), 600);
      } else {
        const failedDetails = msg.results
          ?.filter((r) => !r.success)
          .map((r) => r.error)
          .filter(Boolean)
          .join("; ");
        showToast(
          `Error: ${failedDetails || msg.error || "Batch apply failed"}`
        );
        console.error("[ThemeLab] Batch apply failed:", msg.results);
        generating = false;
        updateGenerateButton(hasChanges());
      }
    }
  });

  // Canvas undo (Ctrl+Z) — works in all tool modes
  setOnCanvasUndo(() => {
    const description = canvasUndo();
    if (description) {
      showToast(`Undo: ${description}`);
      return true;
    }
    return false;
  });

  // File stat responses — update clone and delete staleness data
  onMessage((msg) => {
    if (msg.type === "fileStatResult") {
      updateCloneFileStat(msg.filePath, msg.mtime, msg.size);
      updateDeleteFileStat(msg.filePath, msg.mtime, msg.size);
    }
  });

  // Clear All
  setOnClearAll(() => {
    clearSavedCanvasState();
    resetOverlayState();
    showToast("Everything reset");
  });

  // Persist the canvas view across the reload an applied edit triggers. The
  // desktop shell owns the viewport and intentionally keeps the preview in a
  // responsive document flow, so it must not restore the CLI's infinite-canvas
  // transform from a previous session.
  if (!desktopMode) {
    window.addEventListener("beforeunload", saveCanvasState);
  }
  // Restore only AFTER the framework has hydrated. Wrapping <body> children
  // mid-hydration (e.g. Next App Router, which owns <body>) corrupts React's
  // reconciliation and wipes unknown nodes — including the overlay. The manual
  // toggle is safe precisely because it's always post-hydration, so we mirror
  // that by waiting for `load` + a frame before re-entering the canvas.
  if (!desktopMode) {
    if (document.readyState === "complete") {
      deferredRestore();
    } else {
      window.addEventListener("load", deferredRestore, { once: true });
    }
  }

  console.log("[ThemeLab] Overlay initialized with Phase 2A canvas tools");
}

function safeInit(): void {
  try {
    init();
    installGlobalErrorHandlers();
  } catch (error) {
    handleOverlayError(error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeInit);
} else {
  safeInit();
}

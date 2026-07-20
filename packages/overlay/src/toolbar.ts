import { mountBrandBadge, destroyBrandBadge } from "./brand.js";
// packages/overlay/src/toolbar.ts
import {
  send,
  onMessage,
  setOnMaxRetries,
  setOnTabTakenOver,
  setOnReconnected,
  manualReconnect,
} from "./bridge.js";
import {
  COLORS,
  SHADOWS,
  RADII,
  TRANSITIONS,
  FONT_FAMILY,
} from "./design-tokens.js";
import { isTextInput, isEditableFocused } from "./utils/active-element.js";

let shadowRoot: ShadowRoot | null = null;
let undoBtn: HTMLButtonElement | null = null;
let undoCount = 0;
let toastEl: HTMLDivElement | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let componentDetailEl: HTMLDivElement | null = null;
let generateBtn: HTMLButtonElement | null = null;
let onGenerate: (() => void) | null = null;
let generateAiBtn: HTMLButtonElement | null = null;
let onGenerateAi: (() => void) | null = null;
let onCanvasUndo: (() => boolean) | null = null;
let host: HTMLDivElement | null = null;
let reattachObserver: MutationObserver | null = null;

const UNDO_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.18,4,8.6,5.44,6.06,8h9.71a6,6,0,0,1,0,12h-2V18h2a4,4,0,0,0,0-8H6.06L8.6,12.51,7.18,13.92,2.23,9Z"></path></svg>`;
const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z"></path></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z"></path></svg>`;

const TOOLBAR_STYLES = `
  :host {
    all: initial;
  }
  .toolbar {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: ${COLORS.bgPrimary};
    border: 1px solid ${COLORS.border};
    border-radius: ${RADII.md};
    font-family: ${FONT_FAMILY};
    font-size: 12px;
    color: ${COLORS.textPrimary};
    box-shadow: ${SHADOWS.md};
    user-select: none;
    opacity: 0;
    animation: fadeIn ${TRANSITIONS.settle} forwards;
  }
  @keyframes fadeIn {
    to { opacity: 1; }
  }
  .divider {
    width: 1px;
    height: 16px;
    background: ${COLORS.border};
    flex-shrink: 0;
  }
  .toolbar-tools {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .icon-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: ${COLORS.textSecondary};
    cursor: pointer;
    padding: 0;
    transition: background ${TRANSITIONS.fast}, color ${TRANSITIONS.fast};
  }
  .icon-btn svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
  .icon-btn:hover:not(:disabled) {
    background: ${COLORS.bgSecondary};
    color: ${COLORS.textPrimary};
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .icon-btn.active {
    color: ${COLORS.accent};
  }
  .close-btn {
    color: ${COLORS.textTertiary};
  }
  .close-btn:hover {
    background: ${COLORS.dangerSoft};
    color: ${COLORS.danger};
  }
  .generate-btn {
    background: ${COLORS.accent};
    border: none;
    border-radius: ${RADII.sm};
    color: white;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    font-family: ${FONT_FAMILY};
    cursor: pointer;
    transition: background ${TRANSITIONS.fast};
  }
  .generate-btn:hover:not(:disabled) {
    background: ${COLORS.accentHover};
  }
  .generate-btn:disabled {
    background: ${COLORS.bgTertiary};
    color: ${COLORS.textTertiary};
    cursor: default;
  }
  .generate-ai-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid ${COLORS.accent};
    border-radius: ${RADII.sm};
    color: ${COLORS.textPrimary};
    padding: 6px;
    cursor: pointer;
    transition: background ${TRANSITIONS.fast};
  }
  .generate-ai-btn:hover:not(:disabled) {
    background: rgba(236, 0, 63, 0.14);
  }
  .generate-ai-btn:disabled {
    border-color: ${COLORS.bgTertiary};
    color: ${COLORS.textTertiary};
    cursor: default;
  }
  .generate-ai-btn svg { width: 16px; height: 16px; display: block; }
  .component-detail {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 280px;
    overflow: hidden;
  }
  .component-detail .tag {
    color: ${COLORS.accent};
    font-size: 11px;
    font-weight: 600;
    font-family: monospace;
    flex-shrink: 0;
  }
  .component-detail .name {
    color: ${COLORS.textPrimary};
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .component-detail .path {
    color: ${COLORS.textTertiary};
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .component-detail.empty {
    color: ${COLORS.textTertiary};
    font-size: 12px;
  }
  .toast {
    position: fixed;
    bottom: 68px;
    left: 50%;
    transform: translateX(-50%);
    background: ${COLORS.bgPrimary};
    border: 1px solid ${COLORS.border};
    color: ${COLORS.textPrimary};
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-family: ${FONT_FAMILY};
    box-shadow: ${SHADOWS.md};
    z-index: 2147483647;
    opacity: 0;
    transition: opacity ${TRANSITIONS.medium};
  }
  .toast.visible {
    opacity: 1;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid ${COLORS.border};
    border-top-color: ${COLORS.textSecondary};
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
`;

// Select the whole value when a text field in the overlay is first focused, so a
// single click is enough to replace it. The mouseup that follows the focusing
// click would normally collapse the selection to a caret — we suppress it once.
function wireInputSelectAll(root: ShadowRoot): void {
  let armed = false;
  root.addEventListener("focusin", (e) => {
    const t = e.target;
    if (isTextInput(t as Element)) {
      armed = true;
      (t as HTMLInputElement).select();
    }
  });
  root.addEventListener("mouseup", (e) => {
    if (armed && isTextInput(e.target as Element)) {
      e.preventDefault(); // keep the focus-time selection instead of collapsing to a caret
    }
    armed = false;
  });
}

function isTextInputFocused(): boolean {
  // Resolve through the overlay's shadow DOM, not just document.activeElement.
  return isEditableFocused();
}

export function showToast(
  message: string,
  _level: "info" | "success" | "warning" | "error" = "info"
): void {
  if (!toastEl) {
    return;
  }
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }
  toastTimeout = setTimeout(() => {
    toastEl?.classList.remove("visible");
  }, 2000);
}

export function mountToolbar(onClose: () => void): void {
  const hostEl = document.createElement("div");
  hostEl.id = "themelab-root";
  host = hostEl;
  // Mount on <html>, not <body>. Frameworks that own <body> via React (Next.js
  // App Router) reconcile its children and can pull the overlay into the
  // infinite-canvas transform wrapper — which reparents our fixed UI under a
  // transformed ancestor, shifting/clipping the whole toolbar. <html> is outside
  // React's body subtree and outside the canvas wrapper, so fixed positioning
  // stays viewport-relative no matter what the app does to <body>.
  document.documentElement.append(hostEl);

  // Survive React hydration regeneration. In Next.js App Router (full-document
  // hydration) — and especially when the app has a hydration mismatch, which makes
  // React discard the server DOM and re-render the whole tree on the client —
  // React rebuilds <html>'s children from its vdom and removes any node it didn't
  // create, including this host. The overlay would mount, then vanish the instant
  // the app finishes loading. Re-attach the host whenever it's detached; the node
  // (and its shadow DOM) is reused, so all overlay state and listeners persist.
  reattachObserver = new MutationObserver(() => {
    if (host && !host.isConnected) {
      document.documentElement.append(host);
    }
  });
  reattachObserver.observe(document.documentElement, { childList: true });

  shadowRoot = hostEl.attachShadow({ mode: "open" });
  wireInputSelectAll(shadowRoot);

  const style = document.createElement("style");
  style.textContent = TOOLBAR_STYLES;

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  toolbar.innerHTML = `
    <div class="toolbar-tools"></div>
    <span class="divider"></span>
    <div class="component-detail empty">No selection</div>
    <span class="divider"></span>
    <button class="icon-btn undo-btn" disabled title="Undo Reorder">
      ${UNDO_SVG}
    </button>
    <span class="divider"></span>
    <button class="generate-btn" disabled>Confirm</button>
    <button class="generate-ai-btn" disabled title="Confirm with AI — resolve each change via the AI locator">
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576L3.044 12.96a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 8.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5ZM16.5 15a.75.75 0 0 1 .712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 0 1 0 1.422l-1.183.395a1.5 1.5 0 0 0-.948.948l-.395 1.183a.75.75 0 0 1-1.422 0l-.395-1.183a1.5 1.5 0 0 0-.948-.948l-1.183-.395a.75.75 0 0 1 0-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0 1 16.5 15Z"/></svg>
    </button>
    <button class="icon-btn close-btn" title="Close ThemeLab">
      ${CLOSE_SVG}
    </button>
  `;

  shadowRoot.append(style);
  shadowRoot.append(toolbar);

  undoBtn = toolbar.querySelector(".undo-btn");
  generateBtn = toolbar.querySelector(".generate-btn");
  generateAiBtn = toolbar.querySelector(".generate-ai-btn");
  const closeBtn = toolbar.querySelector(".close-btn");

  componentDetailEl = toolbar.querySelector(".component-detail");

  // Toast element
  toastEl = document.createElement("div");
  toastEl.className = "toast";
  shadowRoot.append(toastEl);

  // Decorative ThemeLab wordmark, pinned bottom-right.
  mountBrandBadge(shadowRoot);

  undoBtn?.addEventListener("click", () => {
    send({ type: "undo" });
    if (undoBtn) {
      undoBtn.innerHTML = `<div class="spinner"></div>`;
      undoBtn.disabled = true;
    }
  });

  closeBtn?.addEventListener("click", onClose);

  // Generate button (Path A only)
  generateBtn?.addEventListener("click", () => {
    if (onGenerate) {
      onGenerate();
    }
  });
  generateAiBtn?.addEventListener("click", () => {
    if (onGenerateAi) {
      onGenerateAi();
    }
  });

  // Keyboard shortcut: Ctrl/Cmd+Z for canvas undo
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "z" &&
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !isTextInputFocused() &&
      onCanvasUndo?.()
    ) {
      e.preventDefault();
    }
  });

  // Show reconnect button when max retries exhausted
  setOnMaxRetries(() => {
    showToast("Disconnected. Click to reconnect.");
    manualReconnect();
  });

  // Show message when another tab takes over
  setOnTabTakenOver(() => {
    showToast("Disconnected: another tab took over");
  });

  // Reset undo counter on reconnect (server clears undo stack on disconnect)
  setOnReconnected(() => {
    undoCount = 0;
    if (undoBtn) {
      undoBtn.disabled = true;
    }
  });

  // Listen for server messages
  onMessage((msg) => {
    switch (msg.type) {
      case "reorderComplete": {
        if (msg.success) {
          undoCount += 1;
          if (undoBtn) {
            undoBtn.innerHTML = CHECK_SVG;
            setTimeout(() => {
              if (undoBtn) {
                undoBtn.innerHTML = UNDO_SVG;
                undoBtn.disabled = false;
              }
            }, 200);
          }
        } else if (msg.error) {
          showToast(msg.error);
        }
        break;
      }

      case "undoComplete": {
        if (msg.success) {
          undoCount = Math.max(0, undoCount - 1);
          if (undoBtn) {
            undoBtn.innerHTML = CHECK_SVG;
            setTimeout(() => {
              if (undoBtn) {
                undoBtn.innerHTML = UNDO_SVG;
                undoBtn.disabled = undoCount === 0;
              }
            }, 200);
          }
        } else if (msg.error) {
          showToast(msg.error);
        }
        break;
      }

      case "devServerDisconnected": {
        showToast("Dev server disconnected");
        break;
      }

      case "devServerReconnected": {
        showToast("Dev server reconnected");
        break;
      }

      default: {
        break;
      }
    }
  });
}

export function destroyToolbar(): void {
  // Stop the re-attach guard before removing, or it would immediately re-add the host.
  reattachObserver?.disconnect();
  reattachObserver = null;
  destroyBrandBadge();
  (host ?? document.querySelector("#themelab-root"))?.remove();
  host = null;
  shadowRoot = null;
  undoBtn = null;
}

export function getShadowRoot(): ShadowRoot | null {
  return shadowRoot;
}

/** The slot inside the bottom toolbar where the tool/action buttons mount,
 *  so they form one unified bar instead of a separate floating left strip. */
export function getToolbarToolsSlot(): HTMLElement | null {
  return shadowRoot?.querySelector(".toolbar-tools") ?? null;
}

export function setOnGenerate(fn: () => void): void {
  onGenerate = fn;
}
export function setOnGenerateAi(fn: () => void): void {
  onGenerateAi = fn;
}
export function setOnCanvasUndo(fn: () => boolean): void {
  onCanvasUndo = fn;
}

export function updateGenerateButton(enabled: boolean): void {
  if (generateBtn) {
    generateBtn.disabled = !enabled;
  }
  if (generateAiBtn) {
    generateAiBtn.disabled = !enabled;
  }
}

/**
 * Update the component detail section in the action bar.
 * Shows tag name, component name, and file path.
 */
export function updateComponentDetail(
  info: {
    tagName: string;
    componentName: string;
    filePath: string;
    lineNumber: number;
  } | null
): void {
  if (!componentDetailEl) {
    return;
  }
  if (!info) {
    componentDetailEl.className = "component-detail empty";
    componentDetailEl.textContent = "No selection";
    return;
  }
  componentDetailEl.className = "component-detail";
  const shortPath = info.filePath
    ? `${info.filePath.replace(/^.*?\/src\//, "src/")}:${info.lineNumber}`
    : "";
  componentDetailEl.innerHTML = `<span class="tag">&lt;${info.tagName}&gt;</span><span class="name">${info.componentName}</span>${shortPath ? `<span class="path">${shortPath}</span>` : ""}`;
}

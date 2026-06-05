// packages/overlay/src/settings-panel.ts
// AI locator settings (API key / base URL / model / enable) + the confirm
// prompt for structural "AI proposals". All UI lives in the Shadow DOM.

import { COLORS, RADII, SHADOWS, TRANSITIONS, FONT_FAMILY } from "./design-tokens.js";
import { send, onMessage } from "./bridge.js";
import { showToast } from "./toolbar.js";
import { addChangeEntry } from "./changelog.js";
import { brandMark } from "./brand.js";
import type { AiSettingsView } from "@themelab/shared";

let panelEl: HTMLDivElement | null = null;
let overlayEl: HTMLDivElement | null = null;
let open = false;
let view: AiSettingsView | null = null;
let inputs: {
  apiKey: HTMLInputElement;
  baseURL: HTMLInputElement;
  model: HTMLInputElement;
  enabled: HTMLInputElement;
} | null = null;

const STYLES = `
.rr-settings-overlay {
  position: fixed; inset: 0; z-index: 2147483646;
  display: none; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.4);
}
.rr-settings-overlay.visible { display: flex; animation: rrSettingsFade ${TRANSITIONS.medium}; }
.rr-settings {
  width: 320px; max-width: calc(100vw - 32px);
  background: ${COLORS.bgPrimary}; border: 1px solid ${COLORS.border};
  border-radius: ${RADII.lg}; box-shadow: ${SHADOWS.lg};
  display: flex; flex-direction: column;
  font-family: ${FONT_FAMILY}; color: ${COLORS.textPrimary};
  animation: rrSettingsSlide ${TRANSITIONS.settle};
}
@keyframes rrSettingsFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rrSettingsSlide {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to { opacity: 1; transform: none; }
}
.rr-settings-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid ${COLORS.border};
}
.rr-settings-head h3 { margin: 0; font-size: 10px; font-weight: 500; letter-spacing: 0.04em; color: ${COLORS.textSecondary}; text-transform: uppercase; }
.rr-settings-x { background: none; border: none; color: ${COLORS.textSecondary}; cursor: pointer; font-size: 16px; line-height: 1; }
.rr-settings-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
.rr-field { display: flex; flex-direction: column; gap: 4px; }
.rr-field label { font-size: 10px; color: ${COLORS.textSecondary}; text-transform: uppercase; letter-spacing: 0.04em; }
.rr-field .rr-src { color: ${COLORS.accent}; text-transform: none; letter-spacing: 0; }
.rr-field input[type=text], .rr-field input[type=password] {
  width: 100%; box-sizing: border-box; padding: 5px 7px;
  font: 400 11px/1.3 ${FONT_FAMILY}; color: ${COLORS.textPrimary};
  background: ${COLORS.bgSecondary}; border: 1px solid ${COLORS.border};
  border-radius: ${RADII.xs}; outline: none;
}
.rr-field input:focus { border-color: ${COLORS.accent}; }
.rr-row { display: flex; align-items: center; gap: 8px; }
.rr-settings-foot { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 14px; border-top: 1px solid ${COLORS.border}; }
.rr-btn { font: 500 11px ${FONT_FAMILY}; padding: 5px 12px; border-radius: ${RADII.xs}; cursor: pointer; border: 1px solid ${COLORS.border}; background: ${COLORS.bgSecondary}; color: ${COLORS.textPrimary}; }
.rr-btn.primary { background: ${COLORS.accent}; border-color: ${COLORS.accent}; color: #fff; }
.rr-btn.ghost { background: none; }
.rr-hint { font-size: 10px; color: ${COLORS.textSecondary}; }

.rr-confirm {
  position: fixed; bottom: 68px; left: 50%; transform: translateX(-50%) translateY(8px);
  width: 360px; max-width: calc(100vw - 32px);
  background: ${COLORS.bgPrimary}; border: 1px solid ${COLORS.border};
  border-radius: ${RADII.md}; box-shadow: ${SHADOWS.lg}; z-index: 2147483647;
  font-family: ${FONT_FAMILY}; color: ${COLORS.textPrimary};
  padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;
  opacity: 0; transition: opacity ${TRANSITIONS.medium}, transform ${TRANSITIONS.medium};
}
.rr-confirm.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
.rr-confirm-title { font-size: 11px; color: ${COLORS.accent}; text-transform: uppercase; letter-spacing: 0.04em; }
.rr-confirm-body { font-size: 12px; line-height: 1.4; }
.rr-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

.rr-ai-ind {
  position: fixed; bottom: 110px; left: 50%; transform: translateX(-50%) translateY(8px);
  display: none; align-items: center; gap: 8px; padding: 7px 12px;
  background: ${COLORS.bgPrimary}; border: 1px solid ${COLORS.border};
  border-radius: 999px; box-shadow: ${SHADOWS.md}; z-index: 2147483647;
  font: 500 12px ${FONT_FAMILY}; color: ${COLORS.textPrimary};
  opacity: 0; transition: opacity ${TRANSITIONS.medium}, transform ${TRANSITIONS.medium};
}
.rr-ai-ind.visible { display: flex; opacity: 1; transform: translateX(-50%) translateY(0); }
.rr-ai-ind .rr-spark { display: flex; color: ${COLORS.accent}; }
.rr-ai-ind.resolving .rr-spark { animation: rrSparkPulse 1s ease-in-out infinite; }
.rr-ai-ind.notfound .rr-spark { color: ${COLORS.textSecondary}; }
@keyframes rrSparkPulse {
  0%, 100% { opacity: 0.45; transform: scale(0.85) rotate(0deg); }
  50% { opacity: 1; transform: scale(1.12) rotate(8deg); }
}
`;

const GEAR_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

function field(label: string, input: HTMLInputElement): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "rr-field";
  const l = document.createElement("label");
  l.textContent = label;
  wrap.append(l, input);
  return wrap;
}

function mkInput(type: "text" | "password", placeholder: string): HTMLInputElement {
  const i = document.createElement("input");
  i.type = type;
  i.placeholder = placeholder;
  i.spellcheck = false;
  i.autocomplete = "off";
  return i;
}

export function initSettingsPanel(shadowRoot: ShadowRoot): void {
  const style = document.createElement("style");
  style.textContent = STYLES;
  shadowRoot.appendChild(style);

  panelEl = document.createElement("div");
  panelEl.className = "rr-settings";

  const head = document.createElement("div");
  head.className = "rr-settings-head";
  const heading = document.createElement("div");
  heading.style.cssText = "display: flex; flex-direction: column; gap: 5px;";
  heading.appendChild(brandMark(15));
  heading.insertAdjacentHTML("beforeend", `<h3>AI locator settings</h3>`);
  head.appendChild(heading);
  const x = document.createElement("button");
  x.className = "rr-settings-x";
  x.textContent = "✕";
  x.addEventListener("click", () => toggleSettingsPanel());
  head.appendChild(x);

  const body = document.createElement("div");
  body.className = "rr-settings-body";

  const apiKey = mkInput("password", "sk-ant-…");
  const baseURL = mkInput("text", "https://api.anthropic.com (default)");
  const model = mkInput("text", "claude-haiku-4-5 (default)");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";

  const enabledRow = document.createElement("div");
  enabledRow.className = "rr-row";
  const enabledLabel = document.createElement("label");
  enabledLabel.style.cssText = "font-size:11px;color:" + COLORS.textPrimary + ";text-transform:none;letter-spacing:0;";
  enabledLabel.textContent = "Enable AI locator";
  enabledRow.append(enabled, enabledLabel);

  const hint = document.createElement("div");
  hint.className = "rr-hint";
  hint.textContent = "Used only when deterministic resolution can't pin the element (maps, instances, conditionals). Key is stored locally; leave blank to keep the current one.";

  body.append(
    field("Anthropic API key", apiKey),
    field("Custom endpoint (base URL)", baseURL),
    field("Model", model),
    enabledRow,
    hint,
  );

  const foot = document.createElement("div");
  foot.className = "rr-settings-foot";
  const clearBtn = document.createElement("button");
  clearBtn.className = "rr-btn ghost";
  clearBtn.textContent = "Clear key";
  clearBtn.addEventListener("click", () => {
    send({ type: "saveSettings", ai: { apiKey: "" } });
    apiKey.value = "";
  });
  const saveBtn = document.createElement("button");
  saveBtn.className = "rr-btn primary";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const patch: Record<string, unknown> = {
      baseURL: baseURL.value.trim(),
      model: model.value.trim(),
      enabled: enabled.checked,
    };
    if (apiKey.value.trim()) patch.apiKey = apiKey.value.trim(); // blank = keep current
    send({ type: "saveSettings", ai: patch });
    showToast("AI settings saved", "success");
  });
  foot.append(clearBtn, saveBtn);

  panelEl.append(head, body, foot);

  // Centered modal: a full-screen backdrop holds the panel in the middle,
  // matching the keyboard-shortcuts overlay. Clicking the backdrop closes it.
  overlayEl = document.createElement("div");
  overlayEl.className = "rr-settings-overlay";
  overlayEl.appendChild(panelEl);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) toggleSettingsPanel();
  });
  shadowRoot.appendChild(overlayEl);
  inputs = { apiKey, baseURL, model, enabled };

  // Esc closes the modal (capture + stopPropagation so it doesn't also deselect).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        toggleSettingsPanel();
      }
    },
    true,
  );

  buildIndicator(shadowRoot);

  onMessage((msg) => {
    if (msg.type === "settings") applyView(msg.ai);
    else if (msg.type === "aiResolving") indResolving();
    else if (msg.type === "aiProposal") { indFound("Located it — confirm below"); showProposal(msg); }
    else if (msg.type === "aiProposalComplete") onProposalComplete(msg);
    else if (msg.type === "commitBatchComplete") {
      if (msg.success || msg.results.some((r) => r.resolvedBy === "ai")) indFound("Found it");
      else indMaybeNotFound();
    } else if (msg.type === "updatePropertyComplete" || msg.type === "updateTextComplete") {
      if (msg.success) indFound("Found it");
      else indMaybeNotFound();
    }
  });
}

function applyView(v: AiSettingsView): void {
  view = v;
  if (!inputs) return;
  inputs.baseURL.value = v.baseURL ?? "";
  inputs.model.value = v.model ?? "";
  inputs.enabled.checked = v.enabled;
  // Never receive the raw key — reflect presence via placeholder.
  inputs.apiKey.value = "";
  inputs.apiKey.placeholder = v.hasApiKey
    ? (v.source.apiKey === "env" ? "set via ANTHROPIC_API_KEY (env)" : "•••••••• (stored)")
    : "sk-ant-…";
  inputs.apiKey.disabled = v.source.apiKey === "env";
}

export function isSettingsPanelOpen(): boolean {
  return open;
}

export function toggleSettingsPanel(): void {
  if (!overlayEl) return;
  open = !open;
  if (open) {
    send({ type: "getSettings" });
    overlayEl.classList.add("visible");
  } else {
    overlayEl.classList.remove("visible");
  }
}

export function createSettingsButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "action-btn";
  btn.innerHTML = GEAR_SVG;
  btn.title = "AI locator settings";
  btn.addEventListener("click", () => {
    toggleSettingsPanel();
    btn.classList.toggle("active", open);
  });
  return btn;
}

// ── "Locating with AI…" indicator (trying → found) ─────────────────────────

// Same filled sparkle as the toolbar "AI" button, for a consistent look.
const SPARKLE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576L3.044 12.96a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 8.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5ZM16.5 15a.75.75 0 0 1 .712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 0 1 0 1.422l-1.183.395a1.5 1.5 0 0 0-.948.948l-.395 1.183a.75.75 0 0 1-1.422 0l-.395-1.183a1.5 1.5 0 0 0-.948-.948l-1.183-.395a.75.75 0 0 1 0-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0 1 16.5 15Z"/></svg>`;

let indEl: HTMLDivElement | null = null;
let indActive = false;
let indSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let indPendingTimer: ReturnType<typeof setTimeout> | null = null;

function buildIndicator(shadowRoot: ShadowRoot): void {
  indEl = document.createElement("div");
  indEl.className = "rr-ai-ind";
  indEl.innerHTML = `<span class="rr-spark">${SPARKLE_SVG}</span><span class="rr-ind-text"></span>`;
  shadowRoot.appendChild(indEl);
}

function clearIndTimers(): void {
  if (indSafetyTimer) { clearTimeout(indSafetyTimer); indSafetyTimer = null; }
  if (indPendingTimer) { clearTimeout(indPendingTimer); indPendingTimer = null; }
}

function indSetText(t: string): void {
  const span = indEl?.querySelector(".rr-ind-text");
  if (span) span.textContent = t;
}

function indResolving(): void {
  if (!indEl) return;
  indActive = true;
  clearIndTimers();
  indEl.className = "rr-ai-ind resolving visible";
  indSetText("Locating with AI…");
  indSafetyTimer = setTimeout(indHide, 25000); // safety: never hang forever
}

function indFound(text: string): void {
  if (!indEl || !indActive) return;
  indActive = false;
  clearIndTimers();
  indEl.className = "rr-ai-ind visible";
  indSetText(text);
  indSafetyTimer = setTimeout(indHide, 1700);
}

/** A failed completion arrived while resolving — wait briefly for a proposal,
 *  then conclude "couldn't locate" if none follows. */
function indMaybeNotFound(): void {
  if (!indActive || indPendingTimer) return;
  indPendingTimer = setTimeout(() => {
    indPendingTimer = null;
    if (!indActive || !indEl) return;
    indActive = false;
    clearIndTimers();
    indEl.className = "rr-ai-ind notfound visible";
    indSetText("Couldn't locate it");
    indSafetyTimer = setTimeout(indHide, 2000);
  }, 350);
}

function indHide(): void {
  clearIndTimers();
  indActive = false;
  indEl?.classList.remove("visible");
}

// ── Proposal confirm ───────────────────────────────────────────────────────

let confirmEl: HTMLDivElement | null = null;

function showProposal(msg: Extract<import("@themelab/shared").ServerMessage, { type: "aiProposal" }>): void {
  if (!panelEl?.parentNode) return;
  confirmEl?.remove();
  const root = panelEl.parentNode;
  confirmEl = document.createElement("div");
  confirmEl.className = "rr-confirm";
  const kindLabel: Record<string, string> = {
    "map-template": "Map template — affects all rendered items",
    conditional: "Conditional branch",
    instance: "Inside a reused component",
    "array-item": "Reorders the source array (the list data)",
  };
  confirmEl.innerHTML =
    `<div class="rr-confirm-title">AI located this element</div>` +
    `<div class="rr-confirm-body">${escapeHtml(msg.summary)}<br>` +
    `<span class="rr-hint">${escapeHtml(kindLabel[msg.kind] ?? msg.kind)} — ${escapeHtml(msg.reasoning)}</span><br>` +
    `<span class="rr-hint">${escapeHtml(msg.filePath)}:${msg.line}</span></div>`;
  const actions = document.createElement("div");
  actions.className = "rr-confirm-actions";
  const dismiss = document.createElement("button");
  dismiss.className = "rr-btn ghost";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => { send({ type: "confirmResolution", id: msg.id, accept: false }); hideConfirm(); });
  const apply = document.createElement("button");
  apply.className = "rr-btn primary";
  apply.textContent = "Apply";
  apply.addEventListener("click", () => { send({ type: "confirmResolution", id: msg.id, accept: true }); hideConfirm(); });
  actions.append(dismiss, apply);
  confirmEl.appendChild(actions);
  root.appendChild(confirmEl);
  requestAnimationFrame(() => confirmEl?.classList.add("visible"));
}

function hideConfirm(): void {
  confirmEl?.classList.remove("visible");
  const el = confirmEl;
  confirmEl = null;
  setTimeout(() => el?.remove(), 200);
}

function onProposalComplete(msg: Extract<import("@themelab/shared").ServerMessage, { type: "aiProposalComplete" }>): void {
  if (msg.success) {
    showToast("Applied AI-resolved edit", "success");
    addChangeEntry({
      type: "commitBatch",
      componentName: "AI Resolver",
      filePath: msg.filePath ?? "",
      summary: `AI-resolved edit (${msg.kind ?? "ai"})`,
      state: "active",
      revertData: { type: "batchApplyUndo", undoIds: msg.undoId ? [msg.undoId] : [] },
    });
  } else {
    showToast(msg.error ?? "AI resolution failed", "error");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

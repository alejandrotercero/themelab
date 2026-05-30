// packages/overlay/src/settings-panel.ts
// AI locator settings (API key / base URL / model / enable) + the confirm
// prompt for structural "AI proposals". All UI lives in the Shadow DOM.

import { COLORS, RADII, SHADOWS, TRANSITIONS, FONT_FAMILY } from "./design-tokens.js";
import { send, onMessage } from "./bridge.js";
import { showToast } from "./toolbar.js";
import { addChangeEntry } from "./changelog.js";
import type { AiSettingsView } from "@react-rewrite/shared";

let panelEl: HTMLDivElement | null = null;
let open = false;
let view: AiSettingsView | null = null;
let inputs: {
  apiKey: HTMLInputElement;
  baseURL: HTMLInputElement;
  model: HTMLInputElement;
  enabled: HTMLInputElement;
} | null = null;

const STYLES = `
.rr-settings {
  position: fixed; top: 16px; right: 16px; width: 320px;
  background: ${COLORS.bgPrimary}; border: 1px solid ${COLORS.border};
  border-radius: ${RADII.lg}; box-shadow: ${SHADOWS.lg};
  z-index: 2147483646; display: none; flex-direction: column;
  font-family: ${FONT_FAMILY}; color: ${COLORS.textPrimary};
  opacity: 0; transform: translateY(-8px);
  transition: opacity ${TRANSITIONS.medium}, transform ${TRANSITIONS.medium};
}
.rr-settings.visible { display: flex; opacity: 1; transform: translateY(0); }
.rr-settings-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid ${COLORS.border};
}
.rr-settings-head h3 { margin: 0; font-size: 12px; font-weight: 500; letter-spacing: 0.02em; }
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
  head.innerHTML = `<h3>AI locator settings</h3>`;
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
  shadowRoot.appendChild(panelEl);
  inputs = { apiKey, baseURL, model, enabled };

  onMessage((msg) => {
    if (msg.type === "settings") applyView(msg.ai);
    else if (msg.type === "aiProposal") showProposal(msg);
    else if (msg.type === "aiProposalComplete") onProposalComplete(msg);
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
  if (!panelEl) return;
  open = !open;
  if (open) {
    send({ type: "getSettings" });
    panelEl.classList.add("visible");
  } else {
    panelEl.classList.remove("visible");
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

// ── Proposal confirm ───────────────────────────────────────────────────────

let confirmEl: HTMLDivElement | null = null;

function showProposal(msg: Extract<import("@react-rewrite/shared").ServerMessage, { type: "aiProposal" }>): void {
  if (!panelEl?.parentNode) return;
  confirmEl?.remove();
  const root = panelEl.parentNode;
  confirmEl = document.createElement("div");
  confirmEl.className = "rr-confirm";
  const kindLabel: Record<string, string> = {
    "map-template": "Map template — affects all rendered items",
    conditional: "Conditional branch",
    instance: "Inside a reused component",
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

function onProposalComplete(msg: Extract<import("@react-rewrite/shared").ServerMessage, { type: "aiProposalComplete" }>): void {
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

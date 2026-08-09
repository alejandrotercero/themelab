import path from "node:path";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  WebContentsView,
} from "electron";
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent, OpenDialogOptions } from "electron";

import { healthCheck } from "../../../packages/cli/dist/detect.js";
import { createProxyServer } from "../../../packages/cli/dist/inject.js";
import { createSketchServer } from "../../../packages/cli/dist/server.js";
import { executeBatch } from "../../../packages/cli/dist/batch-transform.js";
import { resolveTheme } from "../../../packages/cli/dist/theme-resolver.js";
import { upsertCssVars } from "../../../packages/cli/dist/theme-writer.js";
import { getAvailablePort } from "../../../packages/cli/dist/utils.js";
import { applyProposal, createProposal, listRecovery, proposalDiff, undoProposal } from "@themelab/core";
import type { ChangeProposal } from "@themelab/core";
import type { BatchOperation, ComponentInfo, ThemeSource } from "@themelab/shared";
import { inspectProject } from "./project/project-discovery.js";
import type { ProjectCandidate, ProjectDescriptor, RecentProjectRecord } from "./project/project-model.js";
import { readProjectStore, rememberProject, validateRecentProjects, writeProjectStore } from "./project/project-store.js";
import { createInstallPlan, environmentWithRuntime, resolvePackageManagerExecutable } from "./project/dependency-service.js";
import type { InstallPlan } from "./project/dependency-service.js";
import { createInstallController, type InstallState } from "./project/install-controller.js";
import { acceptsLifecycleRequest, isCurrentLifecycleSession, LifecycleSession } from "./project/lifecycle-protocol.js";
import type { LifecycleSnapshot, PreviewLifecycleState, ServerLifecycleState } from "./project/lifecycle-protocol.js";
import { allocateLoopbackPort, createDevCommandPlan, resolveStartedEndpoint, validateLoopbackUrl } from "./project/dev-server-service.js";
import type { LoopbackEndpoint } from "./project/dev-server-service.js";
import { startOwnedProcess } from "./project/owned-process.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let workspaceRoot = process.env.THEMELAB_WORKSPACE
  ? path.resolve(process.env.THEMELAB_WORKSPACE)
  : null;

let shell: BrowserWindow | null = null;
let preview: WebContentsView | null = null;
let proxy: ReturnType<typeof createProxyServer> | null = null;
let sketch: ReturnType<typeof createSketchServer> | null = null;
let previewUrl = "";
let currentThemeSource: ThemeSource | null = null;
let ownedDevProcess: ReturnType<typeof startOwnedProcess> | null = null;
let activeProject: ProjectDescriptor | null = null;
let selectedAppRoot: string | null = null;
let selectedNodeExecutable: string | null = null;
let pendingDevEndpointChoices: LoopbackEndpoint[] = [];
let isQuitting = false;
const lifecycle = new LifecycleSession();
let installState: InstallState = { status: "idle" };
const installLogs: Array<{ projectId: string; operationId: string; stream: "stdout" | "stderr"; text: string; at: number }> = [];
let devState: DevState = { status: "idle", message: "Attach an existing dev server or start the detected project script." };
const devLogs: Array<{ stream: "stdout" | "stderr"; text: string; at: number }> = [];
// One shared queue for visual, theme, and eventually agent proposals. Keeping
// these separate in the renderer used to overwrite an unrelated pending change.
const pendingProposals = new Map<string, ChangeProposal>();
const appliedProposals = new Map<string, ChangeProposal>();

interface WorkspaceSummary {
  root: string;
  framework: "nextjs" | "vite" | "cra" | null;
  port: number | null;
  detectionError: string | null;
  project: ProjectDescriptor | null;
  appChoices: ProjectCandidate[];
  git: { available: boolean; root: string | null; branch: string | null; changedFiles: number };
  runtime: { nodeRequirement: string | null; nodeSource: string | null; nodePath: string | null; nodeVersion: string | null; packageManager: "pnpm" | "npm" | "yarn" | "bun" | null; dependenciesInstalled: boolean } | null;
}

interface DevState {
  status: "idle" | "starting" | "choosing-endpoint" | "running" | "attached" | "error" | "stopped";
  command?: string;
  message?: string;
  targetUrl?: string;
  candidates?: LoopbackEndpoint[];
}

interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreviewStylePatch {
  property: string;
  value: string;
}

interface PreviewThemePatch {
  mode: "light" | "dark";
  name: string;
  value: string;
}

interface ThemeProposalRequest {
  edits: Record<string, string>;
}

function proposalSummary(proposal: ChangeProposal) {
  return {
    id: proposal.id,
    label: proposal.label,
    createdAt: proposal.createdAt,
    origin: proposal.origin,
    operation: proposal.operation,
    selectionKey: proposal.selectionKey,
    diff: proposalDiff(proposal),
    files: proposal.files.map((file) => file.path),
  };
}

function stageProposal(proposal: ChangeProposal) {
  pendingProposals.set(proposal.id, proposal);
  return proposalSummary(proposal);
}

async function applyPendingProposal(proposalId: unknown) {
  if (typeof proposalId !== "string" || !workspaceRoot) return null;
  const proposal = pendingProposals.get(proposalId);
  if (!proposal) return null;
  try {
    const result = await applyProposal(workspaceRoot, proposal);
    pendingProposals.delete(proposalId);
    appliedProposals.set(proposalId, proposal);
    const resolved = resolveTheme(workspaceRoot);
    currentThemeSource = resolved?.source ?? null;
    shell?.webContents.send("preview:theme", resolved ? { theme: resolved.theme, source: resolved.source } : null);
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not apply pending change." };
  }
}

async function undoAppliedProposal(proposalId: unknown) {
  if (typeof proposalId !== "string" || !workspaceRoot) return null;
  try {
    const recovery = await listRecovery(workspaceRoot);
    const entry = recovery.find((candidate) => candidate.proposalId === proposalId);
    if (!entry) return { error: "The recovery record is no longer available." };
    if (entry.status !== "undoable") return { error: "This change cannot be undone because its source files changed afterwards." };
    const result = await undoProposal(workspaceRoot, proposalId);
    appliedProposals.delete(proposalId);
    const resolved = resolveTheme(workspaceRoot);
    currentThemeSource = resolved?.source ?? null;
    shell?.webContents.send("preview:theme", resolved ? { theme: resolved.theme, source: resolved.source } : null);
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not undo applied change." };
  }
}

function discardPendingProposal(proposalId: unknown) {
  if (typeof proposalId !== "string") return false;
  return pendingProposals.delete(proposalId);
}

async function inspectWorkspace(root: string): Promise<WorkspaceSummary> {
  const inspection = await inspectProject(root, { appRoot: selectedAppRoot ?? undefined, nodeExecutable: selectedNodeExecutable ?? undefined });
  const project = inspection.status === "ready" ? inspection.project : null;
  const framework = project?.framework === "unknown" ? null : project?.framework ?? null;
  const detectionError = inspection.status === "ready" ? project?.diagnostics.map((diagnostic) => diagnostic.message).join(" ") || null : inspection.diagnostics.map((diagnostic) => diagnostic.message).join(" ");
  const runtime = project
    ? {
      nodeRequirement: project.runtime.requirement,
      nodeSource: project.runtime.requirementSource,
      nodePath: project.runtime.executable,
      nodeVersion: project.runtime.version,
      packageManager: project.packageManager.name,
      dependenciesInstalled: project.dependencyStatus === "ready",
    }
    : null;
  const appChoices = inspection.status === "needs-app-choice" ? inspection.candidates : [];
  try {
    const [{ stdout: gitRoot }, { stdout: branch }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" }),
      execFileAsync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }),
      execFileAsync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }),
    ]);
    return { root, framework, port: null, detectionError, project, appChoices, git: { available: true, root: gitRoot.trim() || null, branch: branch.trim() || null, changedFiles: status.split("\n").filter(Boolean).length }, runtime };
  } catch {
    return { root, framework, port: null, detectionError, project, appChoices, git: { available: false, root: null, branch: null, changedFiles: 0 }, runtime };
  }
}

async function planWorkspaceDependencies(): Promise<{ ok: boolean; message?: string; planId?: string; plan?: InstallPlan }> {
  const project = await resolveActiveProject();
  const executable = await resolvePackageManagerExecutable(project);
  const result = createInstallPlan(project, executable);
  if (!result.ok) return result;
  const state = installController.plan(result.plan);
  if (state.status !== "needs-confirmation") return { ok: false, message: "Could not create an install plan." };
  return { ok: true, planId: state.planId, plan: state.plan };
}

async function confirmWorkspaceDependencies(planId: unknown): Promise<{ ok: boolean; message: string; operationId?: string }> {
  const project = await resolveActiveProject();
  const state = installController.confirm(project.id, planId);
  if (state.status === "installing") return { ok: true, message: "Installing dependencies…", operationId: state.operationId };
  return { ok: false, message: state.status === "error" ? state.message : "Could not start dependency installation." };
}

async function stopOwnedInstallProcess(): Promise<void> {
  await installController.stopForProjectChange();
}

async function cancelWorkspaceDependencies(): Promise<{ ok: boolean; message: string }> {
  const state = await installController.cancel();
  return state.status === "cancelled" ? { ok: true, message: "Dependency install cancelled." } : { ok: false, message: state.status === "error" ? state.message : "No dependency install is running." };
}

function workspaceStatePath(): string {
  return path.join(app.getPath("userData"), "workspace-state.json");
}

async function recentProjects(): Promise<RecentProjectRecord[]> {
  const statePath = workspaceStatePath();
  const verified = await validateRecentProjects(await readProjectStore(statePath));
  await writeProjectStore(statePath, verified);
  return verified.recentProjects;
}

async function rememberCurrentProject(): Promise<void> {
  if (!workspaceRoot) return;
  const statePath = workspaceStatePath();
  const current = await readProjectStore(statePath);
  const summary = await inspectWorkspace(workspaceRoot);
  await writeProjectStore(statePath, rememberProject(current, summary.project ?? { workspaceRoot, displayName: path.basename(workspaceRoot) }));
}

function isActiveLifecycleSession(sessionId: string | null): boolean {
  return isCurrentLifecycleSession(lifecycle.current().sessionId, sessionId);
}

/** Do not let an async action from a closed/switched project repaint the new one. */
function publishDevState(next: DevState, sessionId: string | null = lifecycle.current().sessionId): void {
  if (sessionId !== null && !isActiveLifecycleSession(sessionId)) return;
  devState = next;
  const activeSessionId = lifecycle.current().sessionId;
  shell?.webContents.send("dev:status", { ...next, sessionId: activeSessionId });
  if (!activeSessionId) return;
  const snapshot = lifecycle.update(activeSessionId, { server: serverStateFor(next) });
  if (snapshot) publishLifecycleSnapshot(snapshot);
}

function serverStateFor(state: DevState): ServerLifecycleState {
  if (state.status === "starting") return { status: "starting", operationId: state.command ?? "starting", command: state.command ?? "", message: state.message };
  if (state.status === "choosing-endpoint") return { status: "choosing-endpoint", operationId: state.command ?? "starting", command: state.command ?? "", candidates: state.candidates ?? [], message: state.message };
  if (state.status === "running" && state.targetUrl) return { status: "ready", ownership: "owned", targetUrl: state.targetUrl, message: state.message };
  if (state.status === "attached" && state.targetUrl) return { status: "ready", ownership: "attached", targetUrl: state.targetUrl, message: state.message };
  if (state.status === "stopped") return { status: "exited", exitCode: null, signal: null, message: state.message };
  if (state.status === "error") return { status: "error", message: state.message ?? "Dev server error." };
  return { status: "idle", message: state.message };
}

function publishPreviewState(state: PreviewLifecycleState): void {
  const sessionId = lifecycle.current().sessionId;
  if (!sessionId) return;
  const snapshot = lifecycle.update(sessionId, { preview: state });
  if (snapshot) publishLifecycleSnapshot(snapshot);
}

function publishLifecycleSnapshot(snapshot: LifecycleSnapshot): void {
  shell?.webContents.send("session:snapshot", snapshot);
}

/** Lifecycle actions are accepted only from ThemeLab's local shell renderer. */
function hasActiveShellSession(event: IpcMainInvokeEvent, value: unknown): value is string {
  return acceptsLifecycleRequest({
    senderId: event.sender.id,
    shellSenderId: shell && !shell.isDestroyed() ? shell.webContents.id : null,
    sessionId: value,
    activeSessionId: lifecycle.current().sessionId,
  });
}

function isShellSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(shell && !shell.isDestroyed() && event.sender.id === shell.webContents.id);
}

function hasActivePreviewSession(event: IpcMainInvokeEvent, sessionId: unknown): boolean {
  return hasActiveShellSession(event, sessionId) && Boolean(preview);
}

function appendDevLog(stream: "stdout" | "stderr", chunk: Buffer, sessionId: string | null = lifecycle.current().sessionId): void {
  if (sessionId !== null && !isActiveLifecycleSession(sessionId)) return;
  const text = chunk.toString("utf8");
  if (!text) return;
  devLogs.push({ stream, text, at: Date.now() });
  if (devLogs.length > 250) devLogs.splice(0, devLogs.length - 250);
  shell?.webContents.send("dev:log", { stream, text, at: Date.now() });
}

function appendInstallLog(projectId: string, operationId: string, stream: "stdout" | "stderr", chunk: Buffer): void {
  const text = chunk.toString("utf8");
  if (!text) return;
  const entry = { projectId, operationId, stream, text, at: Date.now() };
  installLogs.push(entry);
  if (installLogs.length > 250) installLogs.splice(0, installLogs.length - 250);
  shell?.webContents.send("install:log", entry);
}

const installController = createInstallController({
  start(plan, operationId) {
    installLogs.splice(0);
    const owned = startOwnedProcess({ ...plan, env: environmentWithRuntime(activeProject?.runtime.executable ?? null) });
    owned.child.stdout.on("data", (chunk: Buffer) => appendInstallLog(plan.projectId, operationId, "stdout", chunk));
    owned.child.stderr.on("data", (chunk: Buffer) => appendInstallLog(plan.projectId, operationId, "stderr", chunk));
    return owned;
  },
  async verify(projectId) {
    if (!workspaceRoot) return false;
    activeProject = null;
    const project = await resolveActiveProject();
    return project.id === projectId && project.dependencyStatus === "ready";
  },
  onState(next) {
    installState = next;
    shell?.webContents.send("install:status", next);
    const sessionId = lifecycle.current().sessionId;
    if (sessionId) {
      const snapshot = lifecycle.update(sessionId, { install: next });
      if (snapshot) publishLifecycleSnapshot(snapshot);
    }
  },
});

async function stopOwnedDevProcess(sessionId: string | null = lifecycle.current().sessionId): Promise<void> {
  const process = ownedDevProcess;
  if (!process) {
    ownedDevProcess = null;
    return;
  }
  await process.stop();
  ownedDevProcess = null;
  publishDevState({ status: "stopped", message: "ThemeLab stopped the dev process it started." }, sessionId);
}

async function resolveActiveProject(): Promise<ProjectDescriptor> {
  if (!workspaceRoot) throw new Error("Choose a React workspace first.");
  if (activeProject) return activeProject;
  const inspection = await inspectProject(workspaceRoot, { appRoot: selectedAppRoot ?? undefined, nodeExecutable: selectedNodeExecutable ?? undefined });
  if (inspection.status !== "ready") throw new Error(inspection.diagnostics.map((diagnostic) => diagnostic.message).join(" "));
  activeProject = inspection.project;
  return activeProject;
}

async function startOwnedDevProcess(sessionId: string): Promise<string | null> {
  if (!isActiveLifecycleSession(sessionId)) throw new Error("This project session is no longer active.");
  if (!workspaceRoot) throw new Error("Choose a React workspace first.");
  if (ownedDevProcess) throw new Error("ThemeLab already owns a dev server for this project.");
  const project = await resolveActiveProject();
  if (!isActiveLifecycleSession(sessionId)) throw new Error("This project session is no longer active.");
  const executable = await resolvePackageManagerExecutable(project);
  if (!isActiveLifecycleSession(sessionId)) throw new Error("This project session is no longer active.");
  const port = await allocateLoopbackPort();
  const result = createDevCommandPlan(project, executable, "dev", port);
  if (!result.ok) throw new Error(result.message);
  const command = result.plan;
  devLogs.splice(0);
  publishDevState({ status: "starting", command: command.displayCommand, message: `Starting ${command.displayCommand}` }, sessionId);
  const owned = startOwnedProcess(command);
  ownedDevProcess = owned;
  owned.child.stdout.on("data", (chunk: Buffer) => appendDevLog("stdout", chunk, sessionId));
  owned.child.stderr.on("data", (chunk: Buffer) => appendDevLog("stderr", chunk, sessionId));
  owned.child.once("error", (error) => {
    if (ownedDevProcess === owned) ownedDevProcess = null;
    publishDevState({ status: "error", command: command.displayCommand, message: error.message }, sessionId);
  });
  owned.child.once("exit", (code, signal) => {
    if (ownedDevProcess !== owned) return;
    ownedDevProcess = null;
    if (!isActiveLifecycleSession(sessionId)) return;
    void shutdown({ stopDev: false });
    publishDevState({ status: "stopped", command: command.displayCommand, message: `Dev process exited${code === null ? ` (${signal ?? "signal"})` : ` (${code})`}.` }, sessionId);
  });
  const resolution = await resolveStartedEndpoint({
    expected: command.endpoint,
    output: () => devLogs.map((entry) => entry.text).join(""),
    hasExited: () => owned.child.exitCode !== null || owned.child.signalCode !== null,
    healthCheck: async (endpoint) => healthCheck(endpoint.port, endpoint.host).then(() => true).catch(() => false),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  if (!isActiveLifecycleSession(sessionId)) {
    if (ownedDevProcess === owned) await stopOwnedDevProcess(sessionId);
    else await owned.stop();
    throw new Error("This project session is no longer active.");
  }
  if (resolution.status === "ready") {
    if (ownedDevProcess === owned) publishDevState({ status: "running", command: command.displayCommand, targetUrl: resolution.endpoint.url, message: `Serving on ${resolution.endpoint.url}` }, sessionId);
    return resolution.endpoint.url;
  }
  if (resolution.status === "choose") {
    pendingDevEndpointChoices = resolution.candidates;
    publishDevState({ status: "choosing-endpoint", command: command.displayCommand, candidates: resolution.candidates, message: "Multiple loopback servers were announced. Choose the project endpoint." }, sessionId);
    return null;
  }
  await stopOwnedDevProcess(sessionId);
  throw new Error(resolution.message);
}

/**
 * A deliberately opt-in native boundary probe used by the Electron lifecycle
 * test. It is enabled only by the test environment and exercises the same
 * inspected-project and owned-process path as the desktop UI before quitting.
 */
async function runElectronSmokeLifecycle(): Promise<void> {
  if (process.env.THEMELAB_E2E_AUTOSTART !== "1" || !workspaceRoot) return;
  const sessionId = lifecycle.current().sessionId;
  if (!sessionId) throw new Error("Smoke lifecycle did not open a project session.");
  const endpoint = await startOwnedDevProcess(sessionId);
  if (!endpoint) throw new Error("Smoke lifecycle could not resolve a project endpoint.");
  console.log(`[ThemeLab smoke] owned server ready at ${endpoint}`);
  const quitDelay = Number(process.env.THEMELAB_E2E_QUIT_DELAY_MS ?? "100");
  setTimeout(() => app.quit(), Number.isFinite(quitDelay) ? Math.max(0, quitDelay) : 100);
}

interface SourceClassProposalRequest {
  selection: Pick<ComponentInfo, "filePath" | "lineNumber" | "columnNumber">;
  className: string;
}

interface SourceTailwindProposalRequest {
  selection: ComponentInfo;
  updates: Extract<BatchOperation, { op: "updateClass" }>["updates"];
}

type PreviewNavigateDirection = "up" | "down" | "left" | "right";
type PreviewMoveDirection = "up" | "down";

interface PreviewBindToken {
  key: string;
  token: string;
}

interface PreviewTailwindColor {
  key: string;
  token: string;
  css: string;
}

const PREVIEW_STYLE_PROPERTIES = new Set([
  "display",
  "flex-direction",
  "justify-content",
  "align-items",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "padding",
  "margin",
  "gap",
  "background-color",
  "border-radius",
  "opacity",
  "color",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-align",
  "border-width",
  "border-color",
  "border-style",
]);

function isPreviewBounds(value: unknown): value is PreviewBounds {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every(
    (key) =>
      typeof candidate[key] === "number" &&
      Number.isFinite(candidate[key]) &&
      candidate[key] >= 0
  );
}

function isPreviewStylePatch(value: unknown): value is PreviewStylePatch {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.property === "string" &&
    PREVIEW_STYLE_PROPERTIES.has(candidate.property) &&
    typeof candidate.value === "string" &&
    candidate.value.trim().length > 0 &&
    candidate.value.length <= 80 &&
    !/[;{}]/.test(candidate.value)
  );
}

function isPreviewThemePatch(value: unknown): value is PreviewThemePatch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.mode === "light" || candidate.mode === "dark") &&
    typeof candidate.name === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(candidate.name) &&
    typeof candidate.value === "string" &&
    candidate.value.trim().length > 0 &&
    candidate.value.length <= 160 &&
    !/[;{}]/.test(candidate.value)
  );
}

function isThemeProposalRequest(value: unknown): value is ThemeProposalRequest {
  if (!value || typeof value !== "object") return false;
  const edits = (value as Record<string, unknown>).edits;
  return Boolean(edits) && typeof edits === "object" && Object.entries(edits as Record<string, unknown>).every(([key, next]) =>
    /^(light|dark):[A-Za-z0-9_-]{1,100}$/.test(key) &&
    typeof next === "string" && next.trim().length > 0 && next.length <= 160 && !/[;{}]/.test(next)
  );
}

function isSourceClassProposalRequest(value: unknown): value is SourceClassProposalRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const selection = candidate.selection;
  return typeof candidate.className === "string" &&
    candidate.className.length <= 4_000 &&
    Boolean(selection) &&
    typeof selection === "object" &&
    typeof (selection as Record<string, unknown>).filePath === "string" &&
    typeof (selection as Record<string, unknown>).lineNumber === "number" &&
    typeof (selection as Record<string, unknown>).columnNumber === "number";
}

function isSourceTailwindProposalRequest(value: unknown): value is SourceTailwindProposalRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const selection = candidate.selection as Record<string, unknown> | undefined;
  return Boolean(selection) &&
    typeof selection?.filePath === "string" &&
    typeof selection?.lineNumber === "number" &&
    typeof selection?.columnNumber === "number" &&
    Array.isArray(candidate.updates) &&
    candidate.updates.length > 0 &&
    candidate.updates.every((update) => {
      if (!update || typeof update !== "object") return false;
      const entry = update as Record<string, unknown>;
      return typeof entry.tailwindPrefix === "string" &&
        (typeof entry.tailwindToken === "string" || entry.tailwindToken === null) &&
        typeof entry.value === "string";
    });
}

function workspaceRelativePath(filePath: string): string | null {
  if (!workspaceRoot) return null;
  const relative = path.relative(workspaceRoot, filePath);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
    ? relative.replaceAll(path.sep, "/")
    : null;
}

function isPreviewBindToken(value: unknown): value is PreviewBindToken {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" && /^[A-Za-z][A-Za-z0-9-]{0,80}$/.test(candidate.key) &&
    typeof candidate.token === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(candidate.token)
  );
}

function isPreviewTailwindColor(value: unknown): value is PreviewTailwindColor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" && /^[A-Za-z][A-Za-z0-9-]{0,80}$/.test(candidate.key) &&
    typeof candidate.token === "string" && /^[A-Za-z0-9[\]_.-]{1,100}$/.test(candidate.token) &&
    typeof candidate.css === "string" && candidate.css.length > 0 && candidate.css.length <= 160 &&
    !/[;{}]/.test(candidate.css)
  );
}

function setPreviewBounds(bounds: PreviewBounds): void {
  if (!preview) {
    return;
  }
  // These values come from the shell renderer's actual slot. Do not clamp them
  // against BrowserWindow#getContentBounds: on macOS that value is expressed in
  // a different coordinate space from the renderer's compositor rect, which
  // caps the child view early and leaves a white strip at the preview edge.
  // The slot is an internal, measured element, so it is already bounded by the
  // shell content area.
  preview.setBounds({
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  });
}

function createShell(): BrowserWindow {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
  const options: BrowserWindowConstructorOptions = {
    width: Math.min(1440, workWidth),
    height: Math.min(960, workHeight),
    minWidth: 980,
    minHeight: 640,
    title: "ThemeLab",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  const window = new BrowserWindow(options);
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`[ThemeLab Desktop] Shell failed to load: ${errorDescription} (${errorCode})`);
  });
  window.webContents.on("console-message", (_event, _level, message, line, sourceId) => {
    console.log(`[ThemeLab Desktop] Shell console ${sourceId}:${line} ${message}`);
  });
  window.loadFile(path.join(__dirname, "renderer/index.html"));
  return window;
}

function createPreview(window: BrowserWindow): void {
  const allowedOrigin = new URL(previewUrl).origin;
  preview = new WebContentsView({
    webPreferences: {
      // Keep the untrusted app out of the shell's session. This view may persist local app
      // storage across reloads, but it never shares permissions or IPC with the renderer shell.
      partition: "themelab-preview",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: process.env.NODE_ENV !== "production",
    },
  });
  window.contentView.addChildView(preview);
  const { width, height } = window.getContentBounds();
  // Establish the native overlay geometry before either renderer has painted.
  // This guarantees visible space for the floating action bar on first open;
  // the renderer's measured bounds refine it once both surfaces are ready.
  preview.setBounds({
    x: 14,
    y: 52,
    width: Math.max(1, width - 448),
    height: Math.max(1, height - 118),
  });
  preview.setBackgroundColor("#ffffff");
  preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  preview.webContents.on("will-navigate", (event, navigationUrl) => {
    try {
      if (new URL(navigationUrl).origin === allowedOrigin) return;
    } catch {
      // Invalid navigation targets are denied below with the same bounded status message.
    }
    event.preventDefault();
    shell?.webContents.send("preview:status", { status: "error", message: "Preview blocked an external navigation request." });
    publishPreviewState({ status: "error", message: "Preview blocked an external navigation request." });
  });
  preview.webContents.session.setPermissionCheckHandler(() => false);
  preview.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  preview.webContents.session.on("will-download", (event) => event.preventDefault());
  preview.webContents.on("console-message", (_event, _level, message, line, sourceId) => {
    console.log(`[ThemeLab Desktop] Preview console ${sourceId}:${line} ${message}`);
  });
  void preview.webContents.loadURL(previewUrl);
  preview.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    shell?.webContents.send("preview:status", {
      status: "error",
      message: `${errorDescription} (${errorCode})`,
    });
    publishPreviewState({ status: "error", message: `${errorDescription} (${errorCode})` });
  });
  preview.webContents.on("did-finish-load", () => {
    shell?.webContents.send("preview:status", { status: "connected" });
    publishPreviewState({ status: "ready", targetUrl: previewUrl });
    // The shell may have missed the request emitted during its own first
    // paint. Re-request after the preview itself is ready so the native view
    // always receives the renderer's measured slot.
    shell?.webContents.send("preview:request-bounds");
  });
  shell?.webContents.send("preview:request-bounds");
}

async function startThemeLabRuntime(targetUrl: string): Promise<void> {
  if (!workspaceRoot) throw new Error("Choose a React workspace first.");
  const root = workspaceRoot;
  const target = new URL(targetUrl);
  if (!target.port) throw new Error("A development server URL must include a port.");
  const targetPort = Number(target.port);
  const targetHost = target.hostname;
  await healthCheck(targetPort, targetHost);
  publishPreviewState({ status: "connecting", targetUrl });

  const wsPort = await getAvailablePort(3457);
  sketch = createSketchServer({
    port: wsPort,
    projectRoot: root,
    onSelectionChange: (selection: ComponentInfo | null) => {
      shell?.webContents.send("preview:selection", selection);
    },
    onThemeChange: (theme) => {
      currentThemeSource = theme?.source ?? null;
      shell?.webContents.send("preview:theme", theme);
    },
  });
  const proxyPort = await getAvailablePort(3456);
  proxy = createProxyServer({
    targetUrl: target.toString(),
    targetPort,
    targetHost,
    proxyPort,
    wsPort,
    studioUrl: "https://themelab.dev",
    getActiveClient: sketch.getActiveClient,
  });
  await new Promise<void>((resolve) => {
    proxy?.listen(proxyPort, "127.0.0.1", () => resolve());
  });
  previewUrl = `http://127.0.0.1:${proxyPort}/?themelabDesktop=1`;
}

async function shutdown(options: { stopDev?: boolean } = {}): Promise<void> {
  if (preview) {
    shell?.contentView.removeChildView(preview);
    preview.webContents.close();
  }
  preview = null;
  if (proxy) {
    proxy.close();
    proxy = null;
  }
  sketch?.close();
  sketch = null;
  publishPreviewState({ status: "unavailable", message: "No preview is connected." });
  await stopOwnedInstallProcess();
  if (options.stopDev !== false) await stopOwnedDevProcess();
}

ipcMain.on("preview:setBounds", (_event, value: unknown) => {
  if (isPreviewBounds(value)) {
    setPreviewBounds(value);
  }
});

ipcMain.handle("workspace:get-root", () => workspaceRoot);
ipcMain.handle("workspace:summary", async () => workspaceRoot ? inspectWorkspace(workspaceRoot) : null);
ipcMain.handle("workspace:session", () => lifecycle.current());
ipcMain.handle("workspace:recents", async () => (await recentProjects()).map((record) => record.workspaceRoot));
ipcMain.handle("workspace:install-plan", (event, sessionId: unknown) => hasActiveShellSession(event, sessionId) ? planWorkspaceDependencies() : { ok: false, message: "This project session is no longer active." });
ipcMain.handle("workspace:install-confirm", (event, sessionId: unknown, planId: unknown) => hasActiveShellSession(event, sessionId) ? confirmWorkspaceDependencies(planId) : { ok: false, message: "This project session is no longer active." });
ipcMain.handle("workspace:install-cancel", (event, sessionId: unknown) => hasActiveShellSession(event, sessionId) ? cancelWorkspaceDependencies() : { ok: false, message: "This project session is no longer active." });
ipcMain.handle("workspace:install-status", () => installState);
ipcMain.handle("workspace:install-logs", () => installLogs);
ipcMain.handle("workspace:open-recent", async (event, value: unknown) => {
  if (!isShellSender(event) || typeof value !== "string") return null;
  const record = (await recentProjects()).find((candidate) => candidate.workspaceRoot === value && candidate.availability === "available");
  if (!record) return null;
  try {
    workspaceRoot = await realpath(record.workspaceRoot);
    selectedAppRoot = record.appRoot ? await realpath(record.appRoot) : null;
    selectedNodeExecutable = record.nodeExecutable ? await realpath(record.nodeExecutable) : null;
    activeProject = null;
    return workspaceRoot;
  } catch {
    return null;
  }
});
ipcMain.handle("workspace:close", async (event, sessionId: unknown) => {
  if (!hasActiveShellSession(event, sessionId)) return false;
  await shutdown();
  workspaceRoot = null;
  selectedAppRoot = null;
  selectedNodeExecutable = null;
  activeProject = null;
  currentThemeSource = null;
  pendingProposals.clear();
  appliedProposals.clear();
  if (devState.status === "attached") {
    publishDevState({ status: "stopped", message: "ThemeLab disconnected from the project dev server." });
  }
  shell?.webContents.send("preview:selection", null);
  shell?.webContents.send("preview:theme", null);
  shell?.webContents.send("preview:status", { status: "error", message: "Choose a React project to start a preview." });
  const closed = lifecycle.close(sessionId);
  if (closed) publishLifecycleSnapshot(closed);
  return true;
});
ipcMain.handle("dev:status", () => devState);
ipcMain.handle("dev:logs", () => devLogs);
ipcMain.handle("dev:start", async (event, sessionId: unknown) => {
  if (!hasActiveShellSession(event, sessionId)) return { status: "error", message: "This project session is no longer active." } satisfies DevState;
  try {
    const endpoint = await startOwnedDevProcess(sessionId);
    if (!endpoint) return devState;
    if (!isActiveLifecycleSession(sessionId)) return devState;
    await shutdown({ stopDev: false });
    if (!isActiveLifecycleSession(sessionId)) return devState;
    try {
      await startThemeLabRuntime(endpoint);
      if (!isActiveLifecycleSession(sessionId)) {
        await shutdown({ stopDev: false });
        return devState;
      }
      if (shell) createPreview(shell);
    } catch (error) {
      await stopOwnedDevProcess(sessionId);
      throw error;
    }
    return devState;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the project dev process.";
    publishDevState({ status: "error", message }, sessionId);
    return devState;
  }
});
ipcMain.handle("dev:choose-endpoint", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActiveShellSession(event, sessionId)) return { status: "error", message: "This project session is no longer active." } satisfies DevState;
  if (typeof value !== "string") return { status: "error", message: "Choose one of the announced loopback endpoints." } satisfies DevState;
  const endpoint = pendingDevEndpointChoices.find((candidate) => candidate.url === value);
  if (!endpoint || !ownedDevProcess) return { status: "error", message: "That endpoint choice is no longer available." } satisfies DevState;
  try {
    await healthCheck(endpoint.port, endpoint.host);
    if (!isActiveLifecycleSession(sessionId)) return devState;
    pendingDevEndpointChoices = [];
    await shutdown({ stopDev: false });
    if (!isActiveLifecycleSession(sessionId)) return devState;
    await startThemeLabRuntime(endpoint.url);
    if (!isActiveLifecycleSession(sessionId)) {
      await shutdown({ stopDev: false });
      return devState;
    }
    if (shell) createPreview(shell);
    publishDevState({ status: "running", targetUrl: endpoint.url, message: `Serving on ${endpoint.url}` }, sessionId);
    return devState;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The chosen server endpoint is no longer available.";
    publishDevState({ status: "error", message }, sessionId);
    return devState;
  }
});
ipcMain.handle("dev:attach", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActiveShellSession(event, sessionId)) return { status: "error", message: "This project session is no longer active." } satisfies DevState;
  if (!workspaceRoot) return { status: "error", message: "Choose a React workspace first." } satisfies DevState;
  if (typeof value !== "string") return { status: "error", message: "Enter the exact loopback URL for the server to attach." } satisfies DevState;
  const endpoint = validateLoopbackUrl(value);
  if (!endpoint) return { status: "error", message: "Attach accepts only a loopback http(s) URL with an explicit port." } satisfies DevState;
  try {
    await healthCheck(endpoint.port, endpoint.host);
    if (!isActiveLifecycleSession(sessionId)) return devState;
    await shutdown();
    if (!isActiveLifecycleSession(sessionId)) return devState;
    await startThemeLabRuntime(endpoint.url);
    if (!isActiveLifecycleSession(sessionId)) {
      await shutdown({ stopDev: false });
      return devState;
    }
    if (shell) createPreview(shell);
    publishDevState({ status: "attached", targetUrl: endpoint.url, message: `Attached to ${endpoint.url}. ThemeLab will not stop this external server.` }, sessionId);
    return devState;
  } catch (error) {
    const message = error instanceof Error ? error.message : `No server responded at ${endpoint.url}.`;
    publishDevState({ status: "error", message }, sessionId);
    return devState;
  }
});
ipcMain.handle("dev:stop", async (event, sessionId: unknown) => {
  if (!hasActiveShellSession(event, sessionId)) return { status: "error", message: "This project session is no longer active." } satisfies DevState;
  await shutdown();
  if (devState.status === "attached") {
    publishDevState({ status: "stopped", message: "ThemeLab disconnected from the project dev server." });
  }
  return devState;
});

ipcMain.handle("workspace:choose", async (event) => {
  if (!isShellSender(event)) return null;
  const options: OpenDialogOptions = {
    defaultPath: workspaceRoot ?? process.cwd(),
    properties: ["openDirectory"],
    title: "Open React project",
  };
  const result = shell
    ? await dialog.showOpenDialog(shell, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;
  try {
    workspaceRoot = await realpath(path.resolve(result.filePaths[0]));
    selectedAppRoot = null;
    selectedNodeExecutable = null;
    activeProject = null;
    await rememberCurrentProject();
  } catch {
    return null;
  }
  return workspaceRoot;
});

ipcMain.handle("workspace:start", async (event) => {
  if (!isShellSender(event)) return { error: "Workspace requests must originate from the ThemeLab shell." };
  if (!workspaceRoot) return { error: "Choose a React workspace first." };
  try {
    await shutdown();
    pendingProposals.clear();
    appliedProposals.clear();
    const inspection = await inspectProject(workspaceRoot, { appRoot: selectedAppRoot ?? undefined, nodeExecutable: selectedNodeExecutable ?? undefined });
    activeProject = inspection.status === "ready" ? inspection.project : null;
    const snapshot = lifecycle.open(inspection);
    publishLifecycleSnapshot(snapshot);
    await rememberCurrentProject();
    publishDevState({ status: "idle", message: "Choose Attach existing server or Start detected server." });
    return { root: workspaceRoot, workspace: await inspectWorkspace(workspaceRoot) };
  } catch (error) {
    await shutdown();
    return { error: error instanceof Error ? error.message : "Could not start this workspace." };
  }
});

ipcMain.handle("workspace:choose-app", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActiveShellSession(event, sessionId) || !workspaceRoot || typeof value !== "string") return null;
  const initial = await inspectProject(workspaceRoot, { nodeExecutable: selectedNodeExecutable ?? undefined });
  if (initial.status !== "needs-app-choice") return null;
  let selected: string;
  try { selected = await realpath(value); } catch { return null; }
  if (!initial.candidates.some((candidate) => candidate.appRoot === selected)) return null;
  selectedAppRoot = selected;
  activeProject = null;
  const inspection = await inspectProject(workspaceRoot, { appRoot: selected, nodeExecutable: selectedNodeExecutable ?? undefined });
  if (inspection.status !== "ready") return null;
  activeProject = inspection.project;
  const snapshot = lifecycle.update(sessionId, { inspection, project: inspection.project });
  if (snapshot) publishLifecycleSnapshot(snapshot);
  await rememberCurrentProject();
  return inspectWorkspace(workspaceRoot);
});

ipcMain.handle("workspace:choose-node", async (event, sessionId: unknown) => {
  if (!hasActiveShellSession(event, sessionId) || !workspaceRoot) return null;
  const result = shell
    ? await dialog.showOpenDialog(shell, { defaultPath: selectedNodeExecutable ?? undefined, properties: ["openFile"], title: "Choose existing Node executable" })
    : await dialog.showOpenDialog({ defaultPath: selectedNodeExecutable ?? undefined, properties: ["openFile"], title: "Choose existing Node executable" });
  if (result.canceled || !result.filePaths[0]) return null;
  try {
    const executable = await realpath(result.filePaths[0]);
    const inspection = await inspectProject(workspaceRoot, { appRoot: selectedAppRoot ?? undefined, nodeExecutable: executable });
    if (inspection.status !== "ready" || inspection.project.runtime.executable !== executable) return null;
    selectedNodeExecutable = executable;
    activeProject = inspection.project;
    const snapshot = lifecycle.update(sessionId, { inspection, project: inspection.project });
    if (snapshot) publishLifecycleSnapshot(snapshot);
    await rememberCurrentProject();
    return inspectWorkspace(workspaceRoot);
  } catch { return null; }
});

ipcMain.handle("theme:propose", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || !isThemeProposalRequest(value) || !currentThemeSource) return null;
  const relativePath = workspaceRelativePath(currentThemeSource.filePath);
  if (!relativePath) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const before = await readFile(currentThemeSource.filePath, "utf8");
    const grouped: Record<"light" | "dark", Record<string, string>> = { light: {}, dark: {} };
    for (const [key, next] of Object.entries(value.edits)) {
      const [mode, name] = key.split(":") as ["light" | "dark", string];
      grouped[mode][name] = next;
    }
    let after = before;
    if (Object.keys(grouped.light).length) after = upsertCssVars(after, ":root", grouped.light);
    if (Object.keys(grouped.dark).length) after = upsertCssVars(after, currentThemeSource.darkSelector ?? ".dark", grouped.dark);
    return stageProposal(createProposal("Update theme tokens", [{ path: relativePath, before, after }], { origin: "theme", operation: "token-update" }));
  } catch {
    return null;
  }
});

ipcMain.handle("source:propose-class", (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || !workspaceRoot || !isSourceClassProposalRequest(value)) return null;
  const root = workspaceRoot;
  const { selection, className } = value;
  try {
    const result = executeBatch([{
      op: "replaceClassName",
      file: selection.filePath,
      line: selection.lineNumber,
      col: selection.columnNumber,
      className,
    }], root, { write: false });
    if (!result.results.every((entry) => entry.success) || !result.undoEntries.length) {
      return { error: result.results.find((entry) => !entry.success)?.error ?? "Could not resolve this element in source." };
    }
    return stageProposal(createProposal("Update component classes", result.undoEntries.map((entry) => {
      const relativePath = workspaceRelativePath(entry.filePath);
      if (!relativePath) throw new Error("Resolved file is outside the workspace.");
      return { path: relativePath, before: entry.content, after: entry.afterContent };
    }), { origin: "inspector", operation: "class-name", selectionKey: `${selection.filePath}:${selection.lineNumber}:${selection.columnNumber}` }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not prepare class change." };
  }
});

ipcMain.handle("source:propose-tailwind", (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || !workspaceRoot || !isSourceTailwindProposalRequest(value)) return null;
  const root = workspaceRoot;
  const { selection, updates } = value;
  try {
    const result = executeBatch([{
      op: "updateClass",
      file: selection.filePath,
      line: selection.lineNumber,
      col: selection.columnNumber,
      componentName: selection.componentName,
      tagName: selection.tagName,
      className: selection.className,
      fileMtime: selection.fileMtime,
      fileSize: selection.fileSize,
      jsxPath: selection.jsxPath,
      updates,
    }], root, { write: false });
    if (!result.results.every((entry) => entry.success) || !result.undoEntries.length) {
      return { error: result.results.find((entry) => !entry.success)?.error ?? "Could not resolve these controls in source." };
    }
    return stageProposal(createProposal("Update component styles", result.undoEntries.map((entry) => {
      const relativePath = workspaceRelativePath(entry.filePath);
      if (!relativePath) throw new Error("Resolved file is outside the workspace.");
      return { path: relativePath, before: entry.content, after: entry.afterContent };
    }), { origin: "inspector", operation: "tailwind-class", selectionKey: `${selection.filePath}:${selection.lineNumber}:${selection.columnNumber}` }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not prepare style changes." };
  }
});

ipcMain.handle("changes:list", () => [...pendingProposals.values()].map(proposalSummary));
ipcMain.handle("changes:history", async () => {
  if (!workspaceRoot) return [];
  try {
    return await listRecovery(workspaceRoot);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read recovery history." };
  }
});
ipcMain.handle("changes:apply", (event, sessionId: unknown, proposalId: unknown) => hasActiveShellSession(event, sessionId) ? applyPendingProposal(proposalId) : null);
ipcMain.handle("changes:discard", (event, sessionId: unknown, proposalId: unknown) => hasActiveShellSession(event, sessionId) ? discardPendingProposal(proposalId) : false);
ipcMain.handle("changes:undo", (event, sessionId: unknown, proposalId: unknown) => hasActiveShellSession(event, sessionId) ? undoAppliedProposal(proposalId) : null);

// Compatibility aliases while the renderer migrates from the theme-only API.
ipcMain.handle("theme:apply", (event, sessionId: unknown, proposalId: unknown) => hasActiveShellSession(event, sessionId) ? applyPendingProposal(proposalId) : null);
ipcMain.handle("theme:discard", (event, sessionId: unknown, proposalId: unknown) => hasActiveShellSession(event, sessionId) ? discardPendingProposal(proposalId) : false);

ipcMain.handle("preview:apply-style", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || !isPreviewStylePatch(value)) {
    return null;
  }
  const args = JSON.stringify([value.property, value.value]);
  try {
    return await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PREVIEW_STYLE__?.(...${args}) ?? null`
    );
  } catch {
    return null;
  }
});

ipcMain.handle("preview:clear-styles", async (event, sessionId: unknown) => {
  if (!hasActivePreviewSession(event, sessionId)) {
    return null;
  }
  try {
    return await preview!.webContents.executeJavaScript(
      "window.__THEMELAB_DESKTOP_CLEAR_PREVIEW_STYLES__?.() ?? null"
    );
  } catch {
    return null;
  }
});

ipcMain.handle("preview:apply-theme", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || !isPreviewThemePatch(value)) return false;
  const args = JSON.stringify([value.mode, value.name, value.value]);
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PREVIEW_THEME__?.(...${args}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:set-theme-mode", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || (value !== "light" && value !== "dark")) return false;
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PREVIEW_THEME_MODE__?.(${JSON.stringify(value)}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:reset-theme", async (event, sessionId: unknown) => {
  if (!hasActivePreviewSession(event, sessionId)) return false;
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      "window.__THEMELAB_DESKTOP_RESET_THEME__?.() ?? false"
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:commit-theme", async (event, sessionId: unknown) => {
  if (!hasActivePreviewSession(event, sessionId)) return false;
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      "window.__THEMELAB_DESKTOP_COMMIT_THEME__?.() ?? false"
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:navigate", async (event, sessionId: unknown, value: unknown) => {
  const directions: PreviewNavigateDirection[] = ["up", "down", "left", "right"];
  if (!hasActivePreviewSession(event, sessionId) || typeof value !== "string" || !directions.includes(value as PreviewNavigateDirection)) {
    return false;
  }
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_NAVIGATE__?.(${JSON.stringify(value)}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:move", async (event, sessionId: unknown, value: unknown) => {
  const directions: PreviewMoveDirection[] = ["up", "down"];
  if (!hasActivePreviewSession(event, sessionId) || typeof value !== "string" || !directions.includes(value as PreviewMoveDirection)) {
    return false;
  }
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_MOVE__?.(${JSON.stringify(value)}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:bind-token", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || !isPreviewBindToken(value)) return false;
  const args = JSON.stringify([value.key, value.token]);
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_BIND_TOKEN__?.(...${args}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:pick-tailwind", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || !isPreviewTailwindColor(value)) return false;
  const args = JSON.stringify([value.key, value.token, value.css]);
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PICK_TAILWIND__?.(...${args}) ?? false`
    ));
  } catch {
    return false;
  }
});

async function callPreviewGlobal(name: string, event: IpcMainInvokeEvent, sessionId: unknown): Promise<boolean> {
  if (!hasActivePreviewSession(event, sessionId) || !/^__THEMELAB_DESKTOP_[A-Z_]+__$/.test(name)) return false;
  try {
    return Boolean(await preview!.webContents.executeJavaScript(`window.${name}?.() ?? false`));
  } catch {
    return false;
  }
}

ipcMain.handle("preview:undo", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_UNDO__", event, sessionId));
ipcMain.handle("preview:canvas-undo", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_CANVAS_UNDO__", event, sessionId));
ipcMain.handle("preview:reset", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_RESET__", event, sessionId));
ipcMain.handle("preview:toggle-canvas", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_TOGGLE_CANVAS__", event, sessionId));
ipcMain.handle("preview:toggle-history", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_TOGGLE_HISTORY__", event, sessionId));
ipcMain.handle("preview:close", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_CLOSE__", event, sessionId));
ipcMain.handle("preview:commit", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_COMMIT__", event, sessionId));
ipcMain.handle("preview:commit-ai", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_COMMIT_AI__", event, sessionId));
ipcMain.handle("preview:toggle-shortcuts", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_TOGGLE_SHORTCUTS__", event, sessionId));
ipcMain.handle("preview:toggle-settings", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_TOGGLE_SETTINGS__", event, sessionId));
ipcMain.handle("preview:open-theme-editor", (event, sessionId: unknown) => callPreviewGlobal("__THEMELAB_DESKTOP_OPEN_THEME_EDITOR__", event, sessionId));
ipcMain.handle("preview:paste-theme", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || typeof value !== "string" || value.length > 250_000) return null;
  try {
    const args = JSON.stringify([value]);
    return await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PASTE_THEME__?.(...${args}) ?? null`
    );
  } catch {
    return null;
  }
});
ipcMain.handle("preview:set-variant", async (event, sessionId: unknown, value: unknown) => {
  if (!hasActivePreviewSession(event, sessionId) || !value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.breakpoint !== "string" || !/^(|sm|md|lg|xl|2xl)$/.test(candidate.breakpoint) || typeof candidate.dark !== "boolean") return false;
  const args = JSON.stringify([candidate.breakpoint, candidate.dark]);
  try {
    return Boolean(await preview!.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_SET_VARIANT__?.(...${args}) ?? false`
    ));
  } catch {
    return false;
  }
});

app.whenReady().then(async () => {
  // Resolve an explicit launch workspace before loading the shell. Otherwise the
  // renderer can fetch its initial session while inspection is still pending and
  // end up with a selected project but no valid session for Start/Attach.
  if (workspaceRoot) {
    const inspection = await inspectProject(workspaceRoot);
    activeProject = inspection.status === "ready" ? inspection.project : null;
    lifecycle.open(inspection);
    publishDevState({ status: "idle", message: "Attach an existing dev server or start the detected project script." });
  }
  shell = createShell();
  let previewMounted = false;
  const mountPreview = () => {
    if (previewMounted || !shell || !previewUrl) return;
    previewMounted = true;
    createPreview(shell);
  };
  shell.webContents.once("did-finish-load", mountPreview);
  shell.once("ready-to-show", mountPreview);
  shell.once("ready-to-show", () => shell?.show());
  shell.on("resize", () => {
    shell?.webContents.send("preview:request-bounds");
  });
  shell.on("closed", () => {
    shell = null;
    void shutdown();
  });
  if (workspaceRoot) {
    shell.webContents.once("did-finish-load", () => {
      publishLifecycleSnapshot(lifecycle.current());
      shell?.webContents.send("preview:status", { status: "error", message: "No preview is connected. Start the project's dev script or attach an explicit loopback URL." });
    });
  } else {
    shell.webContents.once("did-finish-load", () => {
      shell?.webContents.send("preview:status", { status: "error", message: "Choose a React project to start a preview." });
    });
  }
  if (process.env.THEMELAB_E2E_AUTOSTART === "1") {
    shell.webContents.once("did-finish-load", () => {
      void runElectronSmokeLifecycle().catch((error) => {
        const detail = devLogs.slice(-8).map((entry) => entry.text).join("");
        console.error(`[ThemeLab smoke] ${error instanceof Error ? error.message : String(error)}${detail ? `\n${detail}` : ""}`);
        app.exit(1);
      });
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  void shutdown().finally(() => app.exit(0));
});

// A dev launch is often restarted from a terminal during development. SIGINT
// bypasses Electron's before-quit event, so explicitly tear down the owned
// process group before allowing the desktop process to exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (isQuitting) return;
    isQuitting = true;
    void shutdown().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

// Electron may terminate directly on a native console signal before the async
// handler above gets a turn. The exit hook is intentionally synchronous and
// only targets the process group ThemeLab created for the active project.
process.on("exit", () => {
  const child = ownedDevProcess?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null || !ownedDevProcess) return;
  try { process.kill(-ownedDevProcess.pid, "SIGTERM"); } catch { /* already gone */ }
});

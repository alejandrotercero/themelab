import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  WebContentsView,
} from "electron";
import type { BrowserWindowConstructorOptions, OpenDialogOptions } from "electron";

import { detect, healthCheck } from "../../../packages/cli/dist/detect.js";
import { createProxyServer } from "../../../packages/cli/dist/inject.js";
import { createSketchServer } from "../../../packages/cli/dist/server.js";
import { executeBatch } from "../../../packages/cli/dist/batch-transform.js";
import { resolveTheme } from "../../../packages/cli/dist/theme-resolver.js";
import { upsertCssVars } from "../../../packages/cli/dist/theme-writer.js";
import { getAvailablePort } from "../../../packages/cli/dist/utils.js";
import { applyProposal, createProposal, listRecovery, proposalDiff, undoProposal } from "@themelab/core";
import type { ChangeProposal } from "@themelab/core";
import type { BatchOperation, ComponentInfo, ThemeSource } from "@themelab/shared";

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
let ownedDevProcess: ChildProcessWithoutNullStreams | null = null;
let devState: DevState = { status: "idle", message: "Attach an existing dev server or start the detected project script." };
const devLogs: Array<{ stream: "stdout" | "stderr"; text: string; at: number }> = [];
// One shared queue for visual, theme, and eventually agent proposals. Keeping
// these separate in the renderer used to overwrite an unrelated pending change.
const pendingProposals = new Map<string, ChangeProposal>();
const appliedProposals = new Map<string, ChangeProposal>();
const MAX_RECENT_WORKSPACES = 10;

interface WorkspaceSummary {
  root: string;
  framework: "nextjs" | "vite" | "cra" | null;
  port: number | null;
  detectionError: string | null;
  git: { available: boolean; root: string | null; branch: string | null; changedFiles: number };
}

interface DesktopWorkspaceState {
  version: 1;
  recentRoots: string[];
}

interface DevState {
  status: "idle" | "starting" | "running" | "attached" | "error" | "stopped";
  command?: string;
  message?: string;
}

interface DevCommand {
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  script: string;
  executable: string;
  args: string[];
  display: string;
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
  let framework: WorkspaceSummary["framework"] = null;
  let port: number | null = null;
  let detectionError: string | null = null;
  try {
    const detection = detect(root);
    framework = detection.framework;
    port = detection.port;
  } catch (error) {
    detectionError = error instanceof Error ? error.message : "Could not inspect this project.";
  }
  try {
    const [{ stdout: gitRoot }, { stdout: branch }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" }),
      execFileAsync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }),
      execFileAsync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }),
    ]);
    return { root, framework, port, detectionError, git: { available: true, root: gitRoot.trim() || null, branch: branch.trim() || null, changedFiles: status.split("\n").filter(Boolean).length } };
  } catch {
    return { root, framework, port, detectionError, git: { available: false, root: null, branch: null, changedFiles: 0 } };
  }
}

function workspaceStatePath(): string {
  return path.join(app.getPath("userData"), "workspace-state.json");
}

async function readWorkspaceState(): Promise<DesktopWorkspaceState> {
  try {
    const parsed = JSON.parse(await readFile(workspaceStatePath(), "utf8")) as Partial<DesktopWorkspaceState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.recentRoots) || !parsed.recentRoots.every((root) => typeof root === "string")) {
      return { version: 1, recentRoots: [] };
    }
    return { version: 1, recentRoots: parsed.recentRoots.slice(0, MAX_RECENT_WORKSPACES) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, recentRoots: [] };
    return { version: 1, recentRoots: [] };
  }
}

async function rememberWorkspace(root: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const current = await readWorkspaceState();
  const next: DesktopWorkspaceState = {
    version: 1,
    recentRoots: [canonicalRoot, ...current.recentRoots.filter((entry) => entry !== canonicalRoot)].slice(0, MAX_RECENT_WORKSPACES),
  };
  const statePath = workspaceStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(next, null, 2), "utf8");
  await rename(temporaryPath, statePath);
}

function publishDevState(next: DevState): void {
  devState = next;
  shell?.webContents.send("dev:status", next);
}

function appendDevLog(stream: "stdout" | "stderr", chunk: Buffer): void {
  const text = chunk.toString("utf8");
  if (!text) return;
  devLogs.push({ stream, text, at: Date.now() });
  if (devLogs.length > 250) devLogs.splice(0, devLogs.length - 250);
  shell?.webContents.send("dev:log", { stream, text, at: Date.now() });
}

async function resolveDevCommand(root: string): Promise<DevCommand> {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
  const script = ["dev", "start"].find((name) => typeof packageJson.scripts?.[name] === "string");
  if (!script) throw new Error("No package.json dev or start script was found. Start your server separately and attach to it.");
  const exists = async (name: string) => readFile(path.join(root, name)).then(() => true).catch(() => false);
  const packageManager: DevCommand["packageManager"] = await exists("pnpm-lock.yaml") ? "pnpm"
    : await exists("yarn.lock") ? "yarn"
      : await exists("bun.lockb") || await exists("bun.lock") ? "bun"
        : "npm";
  if (packageManager === "pnpm") return { packageManager, script, executable: "pnpm", args: ["--dir", root, "run", script], display: `pnpm --dir . run ${script}` };
  if (packageManager === "yarn") return { packageManager, script, executable: "yarn", args: ["--cwd", root, script], display: `yarn --cwd . ${script}` };
  if (packageManager === "bun") return { packageManager, script, executable: "bun", args: ["--cwd", root, "run", script], display: `bun --cwd . run ${script}` };
  return { packageManager, script, executable: "npm", args: ["--prefix", root, "run", script], display: `npm --prefix . run ${script}` };
}

async function stopOwnedDevProcess(): Promise<void> {
  const process = ownedDevProcess;
  if (!process || process.killed || process.exitCode !== null) {
    ownedDevProcess = null;
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (process.exitCode === null) process.kill("SIGKILL");
      resolve();
    }, 5_000);
    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    process.kill("SIGTERM");
  });
  ownedDevProcess = null;
  publishDevState({ status: "stopped", message: "ThemeLab stopped the dev process it started." });
}

async function startOwnedDevProcess(): Promise<DevState> {
  if (!workspaceRoot) throw new Error("Choose a React workspace first.");
  if (ownedDevProcess && ownedDevProcess.exitCode === null) return devState;
  const root = workspaceRoot;
  const detection = detect(root);
  try {
    await fetch(`http://localhost:${detection.port}`, { signal: AbortSignal.timeout(800) });
    publishDevState({ status: "attached", message: `Using the existing dev server on localhost:${detection.port}` });
    return devState;
  } catch {
    // The port is not serving a project yet; start the project-owned command below.
  }
  const command = await resolveDevCommand(root);
  devLogs.splice(0);
  publishDevState({ status: "starting", command: command.display, message: `Starting ${command.display}` });
  const child = spawn(command.executable, command.args, {
    cwd: root,
    env: { ...process.env, BROWSER: "none" },
    stdio: "pipe",
    windowsHide: true,
  });
  ownedDevProcess = child;
  child.stdout.on("data", (chunk: Buffer) => appendDevLog("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => appendDevLog("stderr", chunk));
  child.once("error", (error) => {
    if (ownedDevProcess === child) ownedDevProcess = null;
    publishDevState({ status: "error", command: command.display, message: error.message });
  });
  child.once("exit", (code, signal) => {
    if (ownedDevProcess !== child) return;
    ownedDevProcess = null;
    publishDevState({ status: "stopped", command: command.display, message: `Dev process exited${code === null ? ` (${signal ?? "signal"})` : ` (${code})`}.` });
  });
  for (let attempt = 0; attempt < 15; attempt++) {
    if (child.exitCode !== null) throw new Error(`The dev process exited before port ${detection.port} became available.`);
    try {
      await healthCheck(detection.port, "localhost");
      if (ownedDevProcess === child) publishDevState({ status: "running", command: command.display, message: `Serving on localhost:${detection.port}` });
      return devState;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await stopOwnedDevProcess();
  throw new Error(`Timed out waiting for the dev server on port ${detection.port}.`);
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
  const contentBounds = shell?.getContentBounds();
  // The renderer measures the actual preview slot, including the current
  // inspector width and theme dock state. Do not apply a second fixed gutter
  // here; doing so makes a resized inspector leave a stale blank strip.
  const maxWidth = contentBounds ? Math.max(1, contentBounds.width) : Number.POSITIVE_INFINITY;
  const maxHeight = contentBounds ? Math.max(1, contentBounds.height) : Number.POSITIVE_INFINITY;
  preview.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.min(maxWidth, Math.max(1, Math.round(bounds.width))),
    // The renderer measures the inset preview slot itself, so do not reserve
    // the bottom action-bar gutter a second time here.
    height: Math.min(maxHeight, Math.max(1, Math.round(bounds.height))),
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
  });
  preview.webContents.on("did-finish-load", () => {
    shell?.webContents.send("preview:status", { status: "connected" });
    // The shell may have missed the request emitted during its own first
    // paint. Re-request after the preview itself is ready so the native view
    // always receives the renderer's measured slot.
    shell?.webContents.send("preview:request-bounds");
  });
  shell?.webContents.send("preview:request-bounds");
}

async function startThemeLabRuntime(): Promise<void> {
  if (!workspaceRoot) throw new Error("Choose a React workspace first.");
  const root = workspaceRoot;
  const detection = detect(root);
  const targetPort = detection.port;
  await healthCheck(targetPort, "localhost");

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
    targetPort,
    targetHost: "localhost",
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
  preview?.webContents.close();
  preview = null;
  if (proxy) {
    proxy.close();
    proxy = null;
  }
  sketch?.close();
  sketch = null;
  if (options.stopDev !== false) await stopOwnedDevProcess();
}

ipcMain.on("preview:setBounds", (_event, value: unknown) => {
  if (isPreviewBounds(value)) {
    setPreviewBounds(value);
  }
});

ipcMain.handle("workspace:get-root", () => workspaceRoot);
ipcMain.handle("workspace:summary", async () => workspaceRoot ? inspectWorkspace(workspaceRoot) : null);
ipcMain.handle("workspace:recents", async () => (await readWorkspaceState()).recentRoots);
ipcMain.handle("dev:status", () => devState);
ipcMain.handle("dev:logs", () => devLogs);
ipcMain.handle("dev:start", async () => {
  try {
    await startOwnedDevProcess();
    await shutdown({ stopDev: false });
    await startThemeLabRuntime();
    if (shell) createPreview(shell);
    return devState;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the project dev process.";
    publishDevState({ status: "error", message });
    return devState;
  }
});
ipcMain.handle("dev:stop", async () => {
  await shutdown();
  return devState;
});

ipcMain.handle("workspace:choose", async () => {
  const options: OpenDialogOptions = {
    defaultPath: workspaceRoot ?? process.cwd(),
    properties: ["openDirectory"],
    title: "Open React project",
  };
  const result = shell
    ? await dialog.showOpenDialog(shell, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;
  workspaceRoot = path.resolve(result.filePaths[0]);
  return workspaceRoot;
});

ipcMain.handle("workspace:start", async () => {
  if (!workspaceRoot) return { error: "Choose a React workspace first." };
  try {
    await shutdown();
    pendingProposals.clear();
    appliedProposals.clear();
    await startThemeLabRuntime();
    if (!ownedDevProcess) publishDevState({ status: "attached", message: "Using the existing project dev server." });
    await rememberWorkspace(workspaceRoot);
    if (shell) createPreview(shell);
    return { root: workspaceRoot, workspace: await inspectWorkspace(workspaceRoot) };
  } catch (error) {
    await shutdown();
    return { error: error instanceof Error ? error.message : "Could not start this workspace." };
  }
});

ipcMain.handle("theme:propose", async (_event, value: unknown) => {
  if (!isThemeProposalRequest(value) || !currentThemeSource) return null;
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

ipcMain.handle("source:propose-class", (_event, value: unknown) => {
  if (!workspaceRoot || !isSourceClassProposalRequest(value)) return null;
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

ipcMain.handle("source:propose-tailwind", (_event, value: unknown) => {
  if (!workspaceRoot || !isSourceTailwindProposalRequest(value)) return null;
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
ipcMain.handle("changes:apply", (_event, proposalId: unknown) => applyPendingProposal(proposalId));
ipcMain.handle("changes:discard", (_event, proposalId: unknown) => discardPendingProposal(proposalId));
ipcMain.handle("changes:undo", (_event, proposalId: unknown) => undoAppliedProposal(proposalId));

// Compatibility aliases while the renderer migrates from the theme-only API.
ipcMain.handle("theme:apply", (_event, proposalId: unknown) => applyPendingProposal(proposalId));
ipcMain.handle("theme:discard", (_event, proposalId: unknown) => discardPendingProposal(proposalId));

ipcMain.handle("preview:apply-style", async (_event, value: unknown) => {
  if (!preview || !isPreviewStylePatch(value)) {
    return null;
  }
  const args = JSON.stringify([value.property, value.value]);
  try {
    return await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PREVIEW_STYLE__?.(...${args}) ?? null`
    );
  } catch {
    return null;
  }
});

ipcMain.handle("preview:clear-styles", async () => {
  if (!preview) {
    return null;
  }
  try {
    return await preview.webContents.executeJavaScript(
      "window.__THEMELAB_DESKTOP_CLEAR_PREVIEW_STYLES__?.() ?? null"
    );
  } catch {
    return null;
  }
});

ipcMain.handle("preview:apply-theme", async (_event, value: unknown) => {
  if (!preview || !isPreviewThemePatch(value)) return false;
  const args = JSON.stringify([value.mode, value.name, value.value]);
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PREVIEW_THEME__?.(...${args}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:set-theme-mode", async (_event, value: unknown) => {
  if (!preview || (value !== "light" && value !== "dark")) return false;
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PREVIEW_THEME_MODE__?.(${JSON.stringify(value)}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:reset-theme", async () => {
  if (!preview) return false;
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      "window.__THEMELAB_DESKTOP_RESET_THEME__?.() ?? false"
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:commit-theme", async () => {
  if (!preview) return false;
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      "window.__THEMELAB_DESKTOP_COMMIT_THEME__?.() ?? false"
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:navigate", async (_event, value: unknown) => {
  const directions: PreviewNavigateDirection[] = ["up", "down", "left", "right"];
  if (!preview || typeof value !== "string" || !directions.includes(value as PreviewNavigateDirection)) {
    return false;
  }
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_NAVIGATE__?.(${JSON.stringify(value)}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:move", async (_event, value: unknown) => {
  const directions: PreviewMoveDirection[] = ["up", "down"];
  if (!preview || typeof value !== "string" || !directions.includes(value as PreviewMoveDirection)) {
    return false;
  }
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_MOVE__?.(${JSON.stringify(value)}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:bind-token", async (_event, value: unknown) => {
  if (!preview || !isPreviewBindToken(value)) return false;
  const args = JSON.stringify([value.key, value.token]);
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_BIND_TOKEN__?.(...${args}) ?? false`
    ));
  } catch {
    return false;
  }
});

ipcMain.handle("preview:pick-tailwind", async (_event, value: unknown) => {
  if (!preview || !isPreviewTailwindColor(value)) return false;
  const args = JSON.stringify([value.key, value.token, value.css]);
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PICK_TAILWIND__?.(...${args}) ?? false`
    ));
  } catch {
    return false;
  }
});

async function callPreviewGlobal(name: string): Promise<boolean> {
  if (!preview || !/^__THEMELAB_DESKTOP_[A-Z_]+__$/.test(name)) return false;
  try {
    return Boolean(await preview.webContents.executeJavaScript(`window.${name}?.() ?? false`));
  } catch {
    return false;
  }
}

ipcMain.handle("preview:undo", () => callPreviewGlobal("__THEMELAB_DESKTOP_UNDO__"));
ipcMain.handle("preview:canvas-undo", () => callPreviewGlobal("__THEMELAB_DESKTOP_CANVAS_UNDO__"));
ipcMain.handle("preview:reset", () => callPreviewGlobal("__THEMELAB_DESKTOP_RESET__"));
ipcMain.handle("preview:toggle-canvas", () => callPreviewGlobal("__THEMELAB_DESKTOP_TOGGLE_CANVAS__"));
ipcMain.handle("preview:toggle-history", () => callPreviewGlobal("__THEMELAB_DESKTOP_TOGGLE_HISTORY__"));
ipcMain.handle("preview:close", () => callPreviewGlobal("__THEMELAB_DESKTOP_CLOSE__"));
ipcMain.handle("preview:commit", () => callPreviewGlobal("__THEMELAB_DESKTOP_COMMIT__"));
ipcMain.handle("preview:commit-ai", () => callPreviewGlobal("__THEMELAB_DESKTOP_COMMIT_AI__"));
ipcMain.handle("preview:toggle-shortcuts", () => callPreviewGlobal("__THEMELAB_DESKTOP_TOGGLE_SHORTCUTS__"));
ipcMain.handle("preview:toggle-settings", () => callPreviewGlobal("__THEMELAB_DESKTOP_TOGGLE_SETTINGS__"));
ipcMain.handle("preview:open-theme-editor", () => callPreviewGlobal("__THEMELAB_DESKTOP_OPEN_THEME_EDITOR__"));
ipcMain.handle("preview:paste-theme", async (_event, value: unknown) => {
  if (!preview || typeof value !== "string" || value.length > 250_000) return null;
  try {
    const args = JSON.stringify([value]);
    return await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_PASTE_THEME__?.(...${args}) ?? null`
    );
  } catch {
    return null;
  }
});
ipcMain.handle("preview:set-variant", async (_event, value: unknown) => {
  if (!preview || !value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.breakpoint !== "string" || !/^(|sm|md|lg|xl|2xl)$/.test(candidate.breakpoint) || typeof candidate.dark !== "boolean") return false;
  const args = JSON.stringify([candidate.breakpoint, candidate.dark]);
  try {
    return Boolean(await preview.webContents.executeJavaScript(
      `window.__THEMELAB_DESKTOP_SET_VARIANT__?.(...${args}) ?? false`
    ));
  } catch {
    return false;
  }
});

app.whenReady().then(async () => {
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
    try {
      await startThemeLabRuntime();
      mountPreview();
    } catch (error) {
      console.error("[ThemeLab Desktop] Could not start:", error);
      shell?.webContents.send("preview:status", { status: "error", message: error instanceof Error ? error.message : "Could not start workspace." });
    }
  } else {
    shell.webContents.once("did-finish-load", () => {
      shell?.webContents.send("preview:status", { status: "error", message: "Choose a React project to start a preview." });
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void shutdown();
});

const { contextBridge, ipcRenderer } = require("electron");

let activeSessionId = null;
const invokeSession = (channel, ...args) => ipcRenderer.invoke(channel, activeSessionId, ...args);

contextBridge.exposeInMainWorld("themelabDesktop", {
  // Lifecycle API: grouped by authority. The compatibility methods below are
  // retained while the non-lifecycle preview/editor surface is migrated.
  workspace: {
    getRoot: () => ipcRenderer.invoke("workspace:get-root"),
    summary: () => ipcRenderer.invoke("workspace:summary"),
    choose: () => ipcRenderer.invoke("workspace:choose"),
    recents: () => ipcRenderer.invoke("workspace:recents"),
    openRecent: (root) => ipcRenderer.invoke("workspace:open-recent", root),
    chooseApp: (sessionId, appRoot) => ipcRenderer.invoke("workspace:choose-app", sessionId, appRoot),
    chooseNode: (sessionId) => ipcRenderer.invoke("workspace:choose-node", sessionId),
    close: (sessionId) => ipcRenderer.invoke("workspace:close", sessionId),
    start: () => ipcRenderer.invoke("workspace:start"),
  },
  dependencies: {
    status: () => ipcRenderer.invoke("workspace:install-status"),
    logs: () => ipcRenderer.invoke("workspace:install-logs"),
    plan: (sessionId) => ipcRenderer.invoke("workspace:install-plan", sessionId),
    confirm: (sessionId, planId) => ipcRenderer.invoke("workspace:install-confirm", sessionId, planId),
    cancel: (sessionId) => ipcRenderer.invoke("workspace:install-cancel", sessionId),
    subscribe: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("install:status", listener);
      return () => ipcRenderer.removeListener("install:status", listener);
    },
    subscribeLogs: (callback) => {
      const listener = (_event, entry) => callback(entry);
      ipcRenderer.on("install:log", listener);
      return () => ipcRenderer.removeListener("install:log", listener);
    },
  },
  dev: {
    status: () => ipcRenderer.invoke("dev:status"),
    logs: () => ipcRenderer.invoke("dev:logs"),
    start: (sessionId) => ipcRenderer.invoke("dev:start", sessionId),
    chooseEndpoint: (sessionId, url) => ipcRenderer.invoke("dev:choose-endpoint", sessionId, url),
    attach: (sessionId, url) => ipcRenderer.invoke("dev:attach", sessionId, url),
    stop: (sessionId) => ipcRenderer.invoke("dev:stop", sessionId),
    subscribe: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("dev:status", listener);
      return () => ipcRenderer.removeListener("dev:status", listener);
    },
    subscribeLogs: (callback) => {
      const listener = (_event, entry) => callback(entry);
      ipcRenderer.on("dev:log", listener);
      return () => ipcRenderer.removeListener("dev:log", listener);
    },
  },
  session: {
    current: async () => {
      const snapshot = await ipcRenderer.invoke("workspace:session");
      activeSessionId = snapshot?.sessionId ?? null;
      return snapshot;
    },
    subscribe: (callback) => {
      const listener = (_event, snapshot) => {
        activeSessionId = snapshot?.sessionId ?? null;
        callback(snapshot);
      };
      ipcRenderer.on("session:snapshot", listener);
      return () => ipcRenderer.removeListener("session:snapshot", listener);
    },
  },
  getWorkspaceRoot() {
    return ipcRenderer.invoke("workspace:get-root");
  },
  getWorkspaceSummary() {
    return ipcRenderer.invoke("workspace:summary");
  },
  getWorkspaceSession() {
    return ipcRenderer.invoke("workspace:session");
  },
  chooseWorkspace() {
    return ipcRenderer.invoke("workspace:choose");
  },
  getRecentWorkspaces() {
    return ipcRenderer.invoke("workspace:recents");
  },
  openRecentWorkspace(root) {
    return ipcRenderer.invoke("workspace:open-recent", root);
  },
  chooseWorkspaceApp(sessionId, appRoot) {
    return ipcRenderer.invoke("workspace:choose-app", sessionId, appRoot);
  },
  chooseNodeExecutable(sessionId) {
    return ipcRenderer.invoke("workspace:choose-node", sessionId);
  },
  closeWorkspace(sessionId) {
    return ipcRenderer.invoke("workspace:close", sessionId);
  },
  planWorkspaceDependencies(sessionId) {
    return ipcRenderer.invoke("workspace:install-plan", sessionId);
  },
  confirmWorkspaceDependencies(sessionId, planId) {
    return ipcRenderer.invoke("workspace:install-confirm", sessionId, planId);
  },
  cancelWorkspaceDependencies(sessionId) {
    return ipcRenderer.invoke("workspace:install-cancel", sessionId);
  },
  getInstallStatus() {
    return ipcRenderer.invoke("workspace:install-status");
  },
  getInstallLogs() {
    return ipcRenderer.invoke("workspace:install-logs");
  },
  startWorkspace() {
    return ipcRenderer.invoke("workspace:start");
  },
  getDevStatus() {
    return ipcRenderer.invoke("dev:status");
  },
  getDevLogs() {
    return ipcRenderer.invoke("dev:logs");
  },
  startDevServer(sessionId) {
    return ipcRenderer.invoke("dev:start", sessionId);
  },
  chooseDevEndpoint(sessionId, url) {
    return ipcRenderer.invoke("dev:choose-endpoint", sessionId, url);
  },
  attachDevServer(sessionId, url) {
    return ipcRenderer.invoke("dev:attach", sessionId, url);
  },
  stopDevServer(sessionId) {
    return ipcRenderer.invoke("dev:stop", sessionId);
  },
  onDevStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("dev:status", listener);
    return () => ipcRenderer.removeListener("dev:status", listener);
  },
  onDevLog(callback) {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on("dev:log", listener);
    return () => ipcRenderer.removeListener("dev:log", listener);
  },
  onSessionSnapshot(callback) {
    const listener = (_event, snapshot) => {
      activeSessionId = snapshot?.sessionId ?? null;
      callback(snapshot);
    };
    ipcRenderer.on("session:snapshot", listener);
    return () => ipcRenderer.removeListener("session:snapshot", listener);
  },
  onInstallStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("install:status", listener);
    return () => ipcRenderer.removeListener("install:status", listener);
  },
  onInstallLog(callback) {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on("install:log", listener);
    return () => ipcRenderer.removeListener("install:log", listener);
  },
  proposeTheme(edits) {
    return invokeSession("theme:propose", { edits });
  },
  applyThemeProposal(proposalId) {
    return invokeSession("theme:apply", proposalId);
  },
  discardThemeProposal(proposalId) {
    return invokeSession("theme:discard", proposalId);
  },
  listChanges() {
    return ipcRenderer.invoke("changes:list");
  },
  listChangeHistory() {
    return ipcRenderer.invoke("changes:history");
  },
  applyChange(proposalId) {
    return invokeSession("changes:apply", proposalId);
  },
  discardChange(proposalId) {
    return invokeSession("changes:discard", proposalId);
  },
  undoChange(proposalId) {
    return invokeSession("changes:undo", proposalId);
  },
  proposeClassChange(selection, className) {
    return invokeSession("source:propose-class", { selection, className });
  },
  proposeTailwindChanges(selection, updates) {
    return invokeSession("source:propose-tailwind", { selection, updates });
  },
  setPreviewBounds(bounds) {
    ipcRenderer.send("preview:setBounds", bounds);
  },
  onRequestPreviewBounds(callback) {
    const listener = () => callback();
    ipcRenderer.on("preview:request-bounds", listener);
    return () => ipcRenderer.removeListener("preview:request-bounds", listener);
  },
  onPreviewStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("preview:status", listener);
    return () => ipcRenderer.removeListener("preview:status", listener);
  },
  onPreviewSelection(callback) {
    const listener = (_event, selection) => callback(selection);
    ipcRenderer.on("preview:selection", listener);
    return () => ipcRenderer.removeListener("preview:selection", listener);
  },
  onPreviewTheme(callback) {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on("preview:theme", listener);
    return () => ipcRenderer.removeListener("preview:theme", listener);
  },
  applyPreviewStyle(property, value) {
    return invokeSession("preview:apply-style", { property, value });
  },
  clearPreviewStyles() {
    return invokeSession("preview:clear-styles");
  },
  applyPreviewTheme(mode, name, value) {
    return invokeSession("preview:apply-theme", { mode, name, value });
  },
  setPreviewThemeMode(mode) {
    return invokeSession("preview:set-theme-mode", mode);
  },
  resetPreviewTheme() {
    return invokeSession("preview:reset-theme");
  },
  commitPreviewTheme() {
    return invokeSession("preview:commit-theme");
  },
  navigatePreview(direction) {
    return invokeSession("preview:navigate", direction);
  },
  movePreview(direction) {
    return invokeSession("preview:move", direction);
  },
  bindPreviewToken(key, token) {
    return invokeSession("preview:bind-token", { key, token });
  },
  pickPreviewTailwind(key, token, css) {
    return invokeSession("preview:pick-tailwind", { key, token, css });
  },
  undoPreview() {
    return invokeSession("preview:undo");
  },
  canvasUndoPreview() {
    return invokeSession("preview:canvas-undo");
  },
  resetPreview() {
    return invokeSession("preview:reset");
  },
  togglePreviewCanvas() {
    return invokeSession("preview:toggle-canvas");
  },
  togglePreviewHistory() {
    return invokeSession("preview:toggle-history");
  },
  closePreview() {
    return invokeSession("preview:close");
  },
  commitPreview() {
    return invokeSession("preview:commit");
  },
  commitPreviewAi() {
    return invokeSession("preview:commit-ai");
  },
  togglePreviewShortcuts() {
    return invokeSession("preview:toggle-shortcuts");
  },
  togglePreviewSettings() {
    return invokeSession("preview:toggle-settings");
  },
  openThemeEditor() {
    return invokeSession("preview:open-theme-editor");
  },
  pasteTheme(value) {
    return invokeSession("preview:paste-theme", value);
  },
  setPreviewVariant(breakpoint, dark) {
    return invokeSession("preview:set-variant", { breakpoint, dark });
  },
});

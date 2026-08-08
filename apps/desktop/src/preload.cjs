const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("themelabDesktop", {
  getWorkspaceRoot() {
    return ipcRenderer.invoke("workspace:get-root");
  },
  getWorkspaceSummary() {
    return ipcRenderer.invoke("workspace:summary");
  },
  chooseWorkspace() {
    return ipcRenderer.invoke("workspace:choose");
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
  startDevServer() {
    return ipcRenderer.invoke("dev:start");
  },
  stopDevServer() {
    return ipcRenderer.invoke("dev:stop");
  },
  onDevStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("dev:status", listener);
    return () => ipcRenderer.removeListener("dev:status", listener);
  },
  proposeTheme(edits) {
    return ipcRenderer.invoke("theme:propose", { edits });
  },
  applyThemeProposal(proposalId) {
    return ipcRenderer.invoke("theme:apply", proposalId);
  },
  discardThemeProposal(proposalId) {
    return ipcRenderer.invoke("theme:discard", proposalId);
  },
  listChanges() {
    return ipcRenderer.invoke("changes:list");
  },
  listChangeHistory() {
    return ipcRenderer.invoke("changes:history");
  },
  applyChange(proposalId) {
    return ipcRenderer.invoke("changes:apply", proposalId);
  },
  discardChange(proposalId) {
    return ipcRenderer.invoke("changes:discard", proposalId);
  },
  undoChange(proposalId) {
    return ipcRenderer.invoke("changes:undo", proposalId);
  },
  proposeClassChange(selection, className) {
    return ipcRenderer.invoke("source:propose-class", { selection, className });
  },
  proposeTailwindChanges(selection, updates) {
    return ipcRenderer.invoke("source:propose-tailwind", { selection, updates });
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
    return ipcRenderer.invoke("preview:apply-style", { property, value });
  },
  clearPreviewStyles() {
    return ipcRenderer.invoke("preview:clear-styles");
  },
  applyPreviewTheme(mode, name, value) {
    return ipcRenderer.invoke("preview:apply-theme", { mode, name, value });
  },
  setPreviewThemeMode(mode) {
    return ipcRenderer.invoke("preview:set-theme-mode", mode);
  },
  resetPreviewTheme() {
    return ipcRenderer.invoke("preview:reset-theme");
  },
  commitPreviewTheme() {
    return ipcRenderer.invoke("preview:commit-theme");
  },
  navigatePreview(direction) {
    return ipcRenderer.invoke("preview:navigate", direction);
  },
  movePreview(direction) {
    return ipcRenderer.invoke("preview:move", direction);
  },
  bindPreviewToken(key, token) {
    return ipcRenderer.invoke("preview:bind-token", { key, token });
  },
  pickPreviewTailwind(key, token, css) {
    return ipcRenderer.invoke("preview:pick-tailwind", { key, token, css });
  },
  undoPreview() {
    return ipcRenderer.invoke("preview:undo");
  },
  canvasUndoPreview() {
    return ipcRenderer.invoke("preview:canvas-undo");
  },
  resetPreview() {
    return ipcRenderer.invoke("preview:reset");
  },
  togglePreviewCanvas() {
    return ipcRenderer.invoke("preview:toggle-canvas");
  },
  togglePreviewHistory() {
    return ipcRenderer.invoke("preview:toggle-history");
  },
  closePreview() {
    return ipcRenderer.invoke("preview:close");
  },
  commitPreview() {
    return ipcRenderer.invoke("preview:commit");
  },
  commitPreviewAi() {
    return ipcRenderer.invoke("preview:commit-ai");
  },
  togglePreviewShortcuts() {
    return ipcRenderer.invoke("preview:toggle-shortcuts");
  },
  togglePreviewSettings() {
    return ipcRenderer.invoke("preview:toggle-settings");
  },
  openThemeEditor() {
    return ipcRenderer.invoke("preview:open-theme-editor");
  },
  pasteTheme(value) {
    return ipcRenderer.invoke("preview:paste-theme", value);
  },
  setPreviewVariant(breakpoint, dark) {
    return ipcRenderer.invoke("preview:set-variant", { breakpoint, dark });
  },
});

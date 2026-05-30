import { COLORS, SHADOWS, RADII, TRANSITIONS, PANEL, FONT_MONO, ensurePanelFont } from "../design-tokens.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 260;
const MAX_WIDTH = 380;
const STORAGE_KEY = "react-rewrite-sidebar-width";
const RESIZE_HANDLE_WIDTH = 4;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SIDEBAR_STYLES = `
  .prop-sidebar {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    background: ${PANEL.bg};
    border-left: 1px solid ${PANEL.border};
    box-shadow: ${SHADOWS.lg};
    z-index: 2147483645;
    font-family: ${FONT_MONO};
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform ${TRANSITIONS.settle};
    overflow: hidden;
  }
  .prop-sidebar.visible {
    transform: translateX(0);
  }
  .prop-sidebar-resize {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: ${RESIZE_HANDLE_WIDTH}px;
    cursor: col-resize;
    z-index: 1;
  }
  .prop-sidebar-resize:hover,
  .prop-sidebar-resize.active {
    background: ${PANEL.accent};
    opacity: 0.5;
  }
  .prop-sidebar-header {
    padding: 14px 12px;
    border-bottom: 1px solid ${PANEL.surface};
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .prop-sidebar-header-info {
    flex: 1;
    min-width: 0;
  }
  .prop-sidebar-close {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    cursor: pointer;
    color: ${PANEL.textDim};
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: ${RADII.xs};
  }
  .prop-sidebar-close:hover {
    background: ${PANEL.surface};
    color: ${PANEL.text};
  }
  .prop-sidebar-component-name {
    font-size: 12px;
    font-weight: 500;
    color: ${PANEL.text};
    margin: 0 0 4px;
    line-height: 1.3;
  }
  .prop-sidebar-file-path {
    font-size: 11px;
    color: ${PANEL.textDim};
    margin: 0;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }
  .prop-sidebar-saving-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${PANEL.accent};
    margin-left: 6px;
    vertical-align: middle;
    opacity: 0;
    transition: opacity 150ms ease;
  }
  .prop-sidebar-saving-dot.active {
    opacity: 1;
    animation: prop-saving-pulse 0.8s ease-in-out infinite;
  }
  @keyframes prop-saving-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .prop-sidebar-warning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: ${COLORS.dangerSoft};
    border-bottom: 1px solid ${COLORS.danger};
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: ${COLORS.danger};
    flex-shrink: 0;
  }
  .prop-sidebar-warning-text {
    flex: 1;
    font-weight: 500;
  }
  .prop-sidebar-warning-btn {
    border: 1px solid ${COLORS.danger};
    background: none;
    color: ${COLORS.danger};
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: ${RADII.xs};
    cursor: pointer;
    white-space: nowrap;
  }
  .prop-sidebar-warning-btn:hover {
    background: ${COLORS.danger};
    color: #ffffff;
  }
  .prop-sidebar-nav {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    padding: 10px 12px;
    border-bottom: 1px solid ${PANEL.surface};
    flex-shrink: 0;
  }
  .prop-sidebar-nav-btn {
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid ${PANEL.btnBorder};
    background: ${PANEL.btnBg};
    color: ${PANEL.text};
    border-radius: ${RADII.xs};
    cursor: pointer;
    font-family: ${FONT_MONO};
    font-size: 13px;
    line-height: 1;
    padding: 0;
    transition: ${TRANSITIONS.fast};
  }
  .prop-sidebar-nav-btn:hover:not(:disabled) {
    border-color: ${PANEL.accent};
    color: #ffffff;
  }
  .prop-sidebar-nav-btn:disabled {
    background: ${PANEL.btnBgInactive};
    border-color: ${PANEL.surface};
    color: ${PANEL.textGhost};
    cursor: default;
  }
  .prop-sidebar-move {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    padding: 0 12px 12px;
    flex-shrink: 0;
  }
  .prop-sidebar-move-btn {
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 1px solid ${PANEL.btnBorder};
    background: ${PANEL.btnBg};
    color: ${PANEL.text};
    border-radius: ${RADII.xs};
    cursor: pointer;
    font-family: ${FONT_MONO};
    font-size: 11px;
    font-weight: 400;
    line-height: 1;
    padding: 0;
    transition: ${TRANSITIONS.fast};
  }
  .prop-sidebar-move-btn:hover {
    border-color: ${PANEL.accent};
    color: #ffffff;
  }
  .prop-sidebar-move-btn .kbd {
    font-size: 10px;
    color: ${PANEL.accent};
  }
  .prop-sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .prop-sidebar-content::-webkit-scrollbar {
    width: 6px;
  }
  .prop-sidebar-content::-webkit-scrollbar-track {
    background: transparent;
  }
  .prop-sidebar-content::-webkit-scrollbar-thumb {
    background: ${PANEL.border};
    border-radius: 3px;
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // localStorage not available
  }
  return Math.min(DEFAULT_WIDTH, Math.floor(window.innerWidth * 0.22));
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // localStorage not available
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type NavDir = "up" | "down" | "left" | "right";
type MoveDir = "up" | "down";

export function createSidebar(
  shadowRoot: ShadowRoot,
  onClose?: () => void,
  onNavigate?: (dir: NavDir) => void,
  onMove?: (dir: MoveDir) => void,
): {
  show: (componentName: string, filePath: string, lineNumber: number, content: HTMLElement) => void;
  hide: () => void;
  isVisible: () => boolean;
  getElement: () => HTMLElement;
  replaceContent: (contentEl: HTMLElement) => void;
  showWarning: (message: string, actionLabel: string, onAction: () => void) => void;
  clearWarning: () => void;
  showSaving: () => void;
  hideSaving: () => void;
  updateNav: (availability: Record<NavDir, boolean>) => void;
} {
  // Load the panel's monospace font (Google Sans Code) once
  ensurePanelFont();

  // Inject styles
  const style = document.createElement("style");
  style.textContent = SIDEBAR_STYLES;
  shadowRoot.appendChild(style);

  // Sidebar element
  const sidebar = document.createElement("div");
  sidebar.className = "prop-sidebar";
  sidebar.style.width = `${loadWidth()}px`;

  // Resize handle
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "prop-sidebar-resize";
  sidebar.appendChild(resizeHandle);

  // Header
  const header = document.createElement("div");
  header.className = "prop-sidebar-header";

  const headerInfo = document.createElement("div");
  headerInfo.className = "prop-sidebar-header-info";

  const componentNameEl = document.createElement("div");
  componentNameEl.className = "prop-sidebar-component-name";

  const savingDot = document.createElement("span");
  savingDot.className = "prop-sidebar-saving-dot";

  const filePathEl = document.createElement("div");
  filePathEl.className = "prop-sidebar-file-path";

  headerInfo.appendChild(componentNameEl);
  headerInfo.appendChild(filePathEl);

  const closeBtn = document.createElement("button");
  closeBtn.className = "prop-sidebar-close";
  closeBtn.title = "Collapse panel";
  closeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="8,2 4,6 8,10"/></svg>`;

  header.appendChild(headerInfo);
  header.appendChild(closeBtn);
  sidebar.appendChild(header);

  // Hierarchy navigation row (↑ parent, ↓ child, ←/→ siblings)
  const nav = document.createElement("div");
  nav.className = "prop-sidebar-nav";
  const navButtons: Record<NavDir, HTMLButtonElement> = {} as Record<NavDir, HTMLButtonElement>;
  const NAV_DEFS: Array<{ dir: NavDir; glyph: string; title: string }> = [
    { dir: "left", glyph: "←", title: "Select previous sibling  (←)" },
    { dir: "up", glyph: "↑", title: "Select parent  (↑)" },
    { dir: "down", glyph: "↓", title: "Select first child  (↓)" },
    { dir: "right", glyph: "→", title: "Select next sibling  (→)" },
  ];
  for (const def of NAV_DEFS) {
    const btn = document.createElement("button");
    btn.className = "prop-sidebar-nav-btn";
    btn.textContent = def.glyph;
    btn.title = def.title;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onNavigate?.(def.dir);
    });
    navButtons[def.dir] = btn;
    nav.appendChild(btn);
  }
  sidebar.appendChild(nav);

  // Move row — reorders the element in source (distinct from nav, which selects)
  const move = document.createElement("div");
  move.className = "prop-sidebar-move";
  const MOVE_DEFS: Array<{ dir: MoveDir; label: string; glyph: string; kbd: string; title: string }> = [
    { dir: "up", glyph: "↑", label: "Move up", kbd: "[", title: "Move element up among its siblings  ([)" },
    { dir: "down", glyph: "↓", label: "Move down", kbd: "]", title: "Move element down among its siblings  (])" },
  ];
  for (const def of MOVE_DEFS) {
    const btn = document.createElement("button");
    btn.className = "prop-sidebar-move-btn";
    btn.innerHTML = `${def.glyph} ${def.label} <span class="kbd">${def.kbd}</span>`;
    btn.title = def.title;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onMove?.(def.dir);
    });
    move.appendChild(btn);
  }
  sidebar.appendChild(move);

  // Warning banner (hidden by default)
  const warningBanner = document.createElement("div");
  warningBanner.className = "prop-sidebar-warning";
  warningBanner.style.display = "none";
  sidebar.appendChild(warningBanner);

  // Scrollable content area
  const content = document.createElement("div");
  content.className = "prop-sidebar-content";
  sidebar.appendChild(content);

  shadowRoot.appendChild(sidebar);

  // --- Resize logic ---
  let resizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    resizeHandle.classList.add("active");
    resizeHandle.setPointerCapture(e.pointerId);
  });

  resizeHandle.addEventListener("pointermove", (e: PointerEvent) => {
    if (!resizing) return;
    // Dragging left makes sidebar wider (handle is on left edge, sidebar on right)
    const delta = startX - e.clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
    sidebar.style.width = `${newWidth}px`;
  });

  const endResize = () => {
    if (!resizing) return;
    resizing = false;
    resizeHandle.classList.remove("active");
    saveWidth(sidebar.offsetWidth);
  };

  resizeHandle.addEventListener("pointerup", endResize);
  resizeHandle.addEventListener("pointercancel", endResize);

  // Prevent sidebar events from propagating to interaction layer
  sidebar.addEventListener("pointerdown", (e) => e.stopPropagation());
  sidebar.addEventListener("mousedown", (e) => e.stopPropagation());
  sidebar.addEventListener("click", (e) => e.stopPropagation());
  sidebar.addEventListener("mouseup", (e) => e.stopPropagation());

  // Close button
  closeBtn.addEventListener("click", () => {
    hide();
    if (onClose) onClose();
  });

  // --- Public methods ---

  let visible = false;

  function show(
    componentName: string,
    filePath: string,
    lineNumber: number,
    contentEl: HTMLElement,
  ): void {
    componentNameEl.textContent = `<${componentName}>`;
    componentNameEl.appendChild(savingDot);
    filePathEl.textContent = `${filePath}:${lineNumber}`;
    filePathEl.title = `${filePath}:${lineNumber}`;

    // Replace content
    content.innerHTML = "";
    content.appendChild(contentEl);

    if (!visible) {
      visible = true;
      // Force reflow so transition fires
      sidebar.offsetHeight;
      sidebar.classList.add("visible");
    }
  }

  function hide(): void {
    if (!visible) return;
    visible = false;
    sidebar.classList.remove("visible");
  }

  function replaceContent(contentEl: HTMLElement): void {
    content.innerHTML = "";
    content.appendChild(contentEl);
  }

  function showWarning(message: string, actionLabel: string, onAction: () => void): void {
    warningBanner.innerHTML = "";
    const text = document.createElement("span");
    text.className = "prop-sidebar-warning-text";
    text.textContent = message;
    const btn = document.createElement("button");
    btn.className = "prop-sidebar-warning-btn";
    btn.textContent = actionLabel;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onAction();
    });
    warningBanner.appendChild(text);
    warningBanner.appendChild(btn);
    warningBanner.style.display = "flex";
  }

  function clearWarning(): void {
    warningBanner.style.display = "none";
    warningBanner.innerHTML = "";
  }

  function showSaving(): void {
    savingDot.classList.add("active");
  }

  function hideSaving(): void {
    savingDot.classList.remove("active");
  }

  function updateNav(availability: Record<NavDir, boolean>): void {
    for (const dir of Object.keys(navButtons) as NavDir[]) {
      navButtons[dir].disabled = !availability[dir];
    }
  }

  return {
    show,
    hide,
    isVisible: () => visible,
    getElement: () => sidebar,
    replaceContent,
    showWarning,
    clearWarning,
    showSaving,
    hideSaving,
    updateNav,
  };
}

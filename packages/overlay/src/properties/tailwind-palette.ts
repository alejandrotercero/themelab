// Tailwind color palette picker — a tweakcn-style popover that lists the full
// Tailwind v4 palette grouped by family, searchable, with list + grid views.
// Pick a token (e.g. "red-500") directly; fine-tune via the hex picker after.
import { PANEL, FONT_MONO, RADII, SHADOWS } from "../design-tokens.js";
import { toRenderableCss } from "../utils/color-format.js";
import { TAILWIND_PALETTE } from "./tailwind-palette-data.js";

export interface TailwindPaletteOptions {
  /** Bounding rect of the trigger button — the popover anchors near it. */
  anchorRect: DOMRect;
  /** The trigger element — excluded from outside-click so it can toggle. */
  anchorEl?: Element;
  /** Shadow-DOM node to mount into (keeps fixed positioning + composedPath). */
  mount: HTMLElement | ShadowRoot;
  /** Currently-applied token (e.g. "red-500" or "white") to mark as selected. */
  currentToken?: string | null;
  /** Called with the chosen token name and its renderable CSS color. */
  onPick: (token: string, css: string) => void;
  onClose?: () => void;
}

const PANEL_W = 288;
const PANEL_H = 380;
const CHECKER = "repeating-conic-gradient(#3a3a44 0% 25%, #555 0% 50%) 0 0 / 8px 8px";

let activePanel: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;

/** Tailwind logo (two-wave swoosh). Use as the trigger icon. */
export function tailwindLogoSvg(size = 14, color = "#38bdf8"): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 6c-2.67 0-4.33 1.33-5 4 1-1.33 2.17-1.83 3.5-1.5.76.19 1.31.74 1.91 1.35C13.39 10.85 14.53 12 17 12c2.67 0 4.33-1.33 5-4-1 1.33-2.17 1.83-3.5 1.5-.76-.19-1.31-.74-1.91-1.35C15.61 7.15 14.47 6 12 6ZM7 12c-2.67 0-4.33 1.33-5 4 1-1.33 2.17-1.83 3.5-1.5.76.19 1.31.74 1.91 1.35C8.39 16.85 9.53 18 12 18c2.67 0 4.33-1.33 5-4-1 1.33-2.17 1.83-3.5 1.5-.76-.19-1.31-.74-1.91-1.35C10.61 13.15 9.47 12 7 12Z" fill="${color}"/></svg>`;
}

function renderCss(raw: string): string {
  if (raw === "transparent") return CHECKER;
  try {
    return toRenderableCss(raw) ?? raw;
  } catch {
    return raw;
  }
}

/** Flatten the palette into { token, label, family, css } entries. */
interface Entry {
  token: string; // class suffix: "red-500", "white", "transparent"
  label: string; // display: "Red 500", "White"
  family: string;
  css: string;
}

function buildEntries(): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const [family, shades] of Object.entries(TAILWIND_PALETTE)) {
    const list: Entry[] = [];
    for (const [shade, raw] of Object.entries(shades as Record<string, string>)) {
      const token = shade === "DEFAULT" ? family : `${family}-${shade}`;
      const label = shade === "DEFAULT"
        ? family[0].toUpperCase() + family.slice(1)
        : token;
      list.push({ token, label, family, css: renderCss(raw) });
    }
    groups.set(family, list);
  }
  return groups;
}

const ALL_GROUPS = buildEntries();

export function closeTailwindPalette(): void {
  if (activeCleanup) activeCleanup();
}

export function isTailwindPaletteOpen(): boolean {
  return activePanel !== null;
}

export function openTailwindPalette(opts: TailwindPaletteOptions): void {
  closeTailwindPalette();

  let view: "list" | "grid" = "list";
  let query = "";

  const panel = document.createElement("div");
  panel.style.cssText = `
    position:fixed; z-index:2147483647; width:${PANEL_W}px;
    height:${PANEL_H}px; max-height:calc(100vh - 16px);
    display:flex; flex-direction:column; overflow:hidden;
    background:${PANEL.bg}; border:1px solid ${PANEL.border};
    border-radius:${RADII.sm}; box-shadow:${SHADOWS.lg};
    font-family:${FONT_MONO}; color:${PANEL.text};
  `.trim().replace(/\n\s*/g, " ");

  // Position: anchor right edge near the trigger, flip up if no room below.
  const left = Math.max(8, Math.min(opts.anchorRect.right - PANEL_W, window.innerWidth - PANEL_W - 8));
  let top = opts.anchorRect.bottom + 6;
  if (top + PANEL_H > window.innerHeight - 8) {
    top = Math.max(8, opts.anchorRect.top - PANEL_H - 6);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  // --- Header: logo + "Tailwind v4" + view toggle ---
  const header = document.createElement("div");
  header.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-bottom:1px solid ${PANEL.surface};`;
  const title = document.createElement("div");
  title.style.cssText = `display:flex; align-items:center; gap:6px; font-size:12px; color:${PANEL.textDim};`;
  title.innerHTML = `${tailwindLogoSvg(15)}<span>Tailwind v4</span>`;

  const toggle = document.createElement("div");
  toggle.style.cssText = `display:flex; gap:2px;`;
  const listBtn = makeViewBtn("list");
  const gridBtn = makeViewBtn("grid");
  toggle.appendChild(listBtn);
  toggle.appendChild(gridBtn);
  header.appendChild(title);
  header.appendChild(toggle);

  function makeViewBtn(kind: "list" | "grid"): HTMLButtonElement {
    const b = document.createElement("button");
    b.title = kind === "list" ? "List view" : "Grid view";
    b.innerHTML = kind === "list"
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`;
    b.style.cssText = `display:flex; align-items:center; justify-content:center; width:28px; height:28px; border:none; border-radius:${RADII.xs}; background:transparent; color:${PANEL.textDim}; cursor:pointer;`;
    b.addEventListener("click", () => { view = kind; syncToggle(); render(); });
    return b;
  }
  function syncToggle(): void {
    for (const [kind, b] of [["list", listBtn], ["grid", gridBtn]] as const) {
      const on = view === kind;
      b.style.background = on ? PANEL.surface : "transparent";
      b.style.color = on ? PANEL.text : PANEL.textDim;
    }
  }

  // --- Search ---
  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search Tailwind colors…";
  search.className = "prop-input";
  search.style.cssText = `margin:8px 10px; padding:6px 8px; width:auto; flex-shrink:0;`;
  search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); render(); });

  // --- Scroll body ---
  const body = document.createElement("div");
  body.style.cssText = `flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding:0 6px 8px; overscroll-behavior:contain;`;
  styleScrollbar(body);
  // Keep wheel scrolling inside the popover (the overlay interaction layer
  // otherwise swallows/forwards wheel events for canvas pan-zoom).
  body.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: true });

  function filtered(): Array<[string, Entry[]]> {
    const out: Array<[string, Entry[]]> = [];
    for (const [family, list] of ALL_GROUPS) {
      if (!query) { out.push([family, list]); continue; }
      if (family.toLowerCase().includes(query)) { out.push([family, list]); continue; }
      const hits = list.filter((e) => e.token.toLowerCase().includes(query));
      if (hits.length) out.push([family, hits]);
    }
    return out;
  }

  function render(): void {
    body.innerHTML = "";
    const groups = filtered();
    if (groups.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No colors found.";
      empty.style.cssText = `padding:24px; text-align:center; color:${PANEL.textDim}; font-size:12px;`;
      body.appendChild(empty);
      return;
    }
    for (const [family, list] of groups) {
      const heading = document.createElement("div");
      heading.textContent = family[0].toUpperCase() + family.slice(1);
      heading.style.cssText = `padding:8px 6px 4px; font-size:10px; text-transform:uppercase; letter-spacing:0.8px; color:${PANEL.textDim};`;
      body.appendChild(heading);

      if (view === "list") {
        for (const e of list) body.appendChild(listRow(e));
      } else {
        const strip = document.createElement("div");
        strip.style.cssText = `display:flex; gap:3px; padding:2px 6px 4px; flex-wrap:wrap;`;
        for (const e of list) strip.appendChild(gridCell(e));
        body.appendChild(strip);
      }
    }
  }

  function listRow(e: Entry): HTMLElement {
    const row = document.createElement("button");
    const selected = e.token === opts.currentToken;
    row.style.cssText = `
      display:flex; align-items:center; gap:9px; width:100%; padding:5px 6px;
      border:none; border-radius:${RADII.xs}; cursor:pointer; text-align:left;
      background:${selected ? PANEL.surface : "transparent"}; color:${PANEL.text};
      font-family:${FONT_MONO}; font-size:12px;
    `.trim().replace(/\n\s*/g, " ");
    const sw = document.createElement("span");
    sw.style.cssText = `flex:0 0 auto; width:18px; height:18px; border-radius:4px; border:1px solid ${PANEL.border}; background:${e.css};`;
    const name = document.createElement("span");
    name.textContent = e.token;
    name.style.cssText = `flex:1 1 auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
    row.appendChild(sw);
    row.appendChild(name);
    if (selected) {
      const check = document.createElement("span");
      check.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      check.style.cssText = `flex:0 0 auto; color:${PANEL.accent}; display:flex;`;
      row.appendChild(check);
    }
    row.addEventListener("mouseenter", () => { row.style.background = PANEL.surface; });
    row.addEventListener("mouseleave", () => { row.style.background = selected ? PANEL.surface : "transparent"; });
    row.addEventListener("click", () => { opts.onPick(e.token, e.css); close(); });
    return row;
  }

  function gridCell(e: Entry): HTMLElement {
    const cell = document.createElement("button");
    const selected = e.token === opts.currentToken;
    cell.title = e.token;
    cell.style.cssText = `
      width:20px; height:20px; padding:0; cursor:pointer; border-radius:4px;
      background:${e.css}; border:1px solid ${selected ? PANEL.accent : "rgba(255,255,255,0.12)"};
      box-shadow:${selected ? `0 0 0 1px ${PANEL.accent}` : "none"}; transition:transform 80ms ease;
    `.trim().replace(/\n\s*/g, " ");
    cell.addEventListener("mouseenter", () => { cell.style.transform = "scale(1.18)"; });
    cell.addEventListener("mouseleave", () => { cell.style.transform = "scale(1)"; });
    cell.addEventListener("click", () => { opts.onPick(e.token, e.css); close(); });
    return cell;
  }

  panel.appendChild(header);
  panel.appendChild(search);
  panel.appendChild(body);
  opts.mount.appendChild(panel);

  syncToggle();
  render();
  // Defer focus so the opening click doesn't immediately blur it
  setTimeout(() => search.focus(), 0);

  // --- Lifecycle ---
  function onDocMouseDown(ev: MouseEvent): void {
    const path = ev.composedPath();
    if (path.includes(panel)) return;
    if (opts.anchorEl && path.includes(opts.anchorEl)) return;
    close();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
  }
  document.addEventListener("mousedown", onDocMouseDown, true);
  document.addEventListener("keydown", onKey, true);

  function close(): void {
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onKey, true);
    panel.remove();
    if (activePanel === panel) { activePanel = null; activeCleanup = null; }
    opts.onClose?.();
  }

  activePanel = panel;
  activeCleanup = close;
}

function styleScrollbar(el: HTMLElement): void {
  // Inline scrollbar styling isn't possible; rely on the panel stylesheet if
  // present. Thin scrollbar via class is added by callers' stylesheet.
  el.style.scrollbarWidth = "thin";
  (el.style as CSSStyleDeclaration & { scrollbarColor?: string }).scrollbarColor = `${PANEL.border} transparent`;
}

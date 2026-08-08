import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  CursorIcon,
  GearSixIcon,
  ListBulletsIcon,
  PaletteIcon,
  QuestionIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { ThemeColorPicker } from "@themelab/theme-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  ComponentInfo,
  ComponentStyleSnapshot,
  ThemeSource,
  ThemeStyles,
} from "@themelab/shared";
import {
  detectColorKind,
  serializeToKind,
  toHex,
  toRenderableCss,
} from "./color-utils";
import { TAILWIND_PALETTE } from "../../../../packages/overlay/src/properties/tailwind-palette-data.js";
import { ALL_DESCRIPTORS } from "../../../../packages/overlay/src/properties/property-descriptors.js";

type ThemePayload = { theme: ThemeStyles; source: ThemeSource | null } | null;
type ThemeProposal = { id: string; label: string; createdAt: number; origin: "theme" | "inspector" | "agent" | "other"; operation: string | null; selectionKey: string | null; diff: string; files: string[] };
type RecoveryEntry = { proposalId: string; label: string; createdAt: number; origin: "theme" | "inspector" | "agent" | "other"; operation: string | null; selectionKey: string | null; files: string[]; status: "undoable" | "undone" | "conflicted" };
type WorkspaceSummary = NonNullable<Awaited<ReturnType<Window["themelabDesktop"]["getWorkspaceSummary"]>>>;
type TailwindProposalUpdate = {
  tailwindPrefix: string;
  tailwindToken: string | null;
  value: string;
  relatedPrefixes?: string[];
  classPattern?: string;
  standalone?: boolean;
  variant?: string;
};

function Logo() {
  return <svg aria-label="ThemeLab" className="desktop-wordmark" fill="currentColor" role="img" viewBox="0 0 263 30">
    <path d="M25.012 5.00017H15.0068V30H10.0052V5.00017H0V0H25.012V5.00017Z" />
    <path d="M39.0009 10.0003H54.0077V0H59.0103V30H54.0077V15.0005H39.0009V30H33.9983V0H39.0009V10.0003Z" />
    <path d="M93.0086 5.00017H72.9992V10.0003H88.006V15.0005H72.9992V24.9998H93.0086V30H67.9966V0H93.0086V5.00017Z" />
    <path d="M106.997 5.00017H112V10.0003H106.997V30H101.995V0H106.997V5.00017Z" />
    <path d="M127.007 30H122.004V10.0003H117.002V5.00017H122.004V0H127.007V30Z" />
    <path d="M161.005 5.00017H140.996V10.0003H156.003V15.0005H140.996V24.9998H161.005V30H135.993V0H161.005V5.00017Z" />
    <path d="M174.994 24.9998H195.003V30H169.991V0H174.994V24.9998Z" />
    <path d="M208.992 15.0005H223.999V10.0003H229.002V30H223.999V19.9997H208.992V30H203.99V10.0003H208.992V15.0005Z" />
    <path d="M257.997 5.00017H242.991V10.0003H257.997V15.0005H242.991V24.9998H257.997V30H237.988V0H257.997Z" />
    <path d="M263 24.9998H257.997V15.0005H263V24.9998Z" /><path d="M117.002 19.9997H112V10.0003H117.002V19.9997Z" /><path d="M213.995 10.0003H208.992V5.00017H213.995V10.0003Z" /><path d="M223.999 10.0003H218.996V5.00017H223.999V10.0003Z" /><path d="M263 10.0003H257.997V5.00017H263V10.0003Z" /><path d="M218.996 5.00017H213.995V0H218.996V5.00017Z" />
  </svg>;
}

function SectionLabel({ children }: { children: string }) {
  return <p className="overlay-section-label">{children}</p>;
}

function StyleControl({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="overlay-style-control"><span>{label}</span><input disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function expandBoxSides(value: string): [string, string, string, string] {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ["0px", "0px", "0px", "0px"];
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}

function boundThemeToken(selection: ComponentInfo | null, property: string, themeEntries: [string, string][]): string | null {
  const prefix = property === "color" ? "text" : "bg";
  const names = new Set(themeEntries.map(([name]) => name));
  for (const raw of (selection?.className ?? "").split(/\s+/)) {
    const utility = raw.slice(raw.lastIndexOf(":") + 1).split("/")[0];
    if (utility.startsWith(`${prefix}-`)) {
      const token = utility.slice(prefix.length + 1);
      if (names.has(token)) return token;
    }
  }
  return null;
}

type TailwindPaletteEntry = { token: string; css: string };

const tailwindPaletteEntries: TailwindPaletteEntry[] = Object.entries(TAILWIND_PALETTE).flatMap(([family, shades]) => Object.entries(shades).map(([shade, css]) => ({ token: shade === "DEFAULT" ? family : `${family}-${shade}`, css })));

function TailwindPalette({ anchor, inThemeDock = false, onClose, onPick }: { anchor: HTMLElement; inThemeDock?: boolean; onClose: () => void; onPick: (token: string, css: string) => void }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const panelRef = useRef<HTMLDivElement>(null);
  const entries = tailwindPaletteEntries.filter((entry) => entry.token.includes(query.trim().toLowerCase()));
  const rect = anchor.getBoundingClientRect();
  const dock = inThemeDock ? anchor.closest(".native-theme-dock")?.getBoundingClientRect() : null;
  // A WebContentsView always paints above DOM, regardless of z-index. Keep the
  // theme palette physically inside the dock instead of allowing a fixed popup
  // to cross into the live preview and appear clipped/broken.
  const left = dock ? 8 : Math.max(8, Math.min(rect.right - 288, window.innerWidth - 296));
  const top = dock
    ? Math.max(8, Math.min(rect.top - dock.top, dock.height - 388))
    : Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 388));

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!panelRef.current?.contains(event.target as Node) && event.target !== anchor) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);

  return <div className={`tailwind-palette ${view}${dock ? " in-theme-dock" : ""}`} ref={panelRef} style={{ left, top }}>
    <div className="tailwind-palette-head"><div><TailwindIcon /><span>Tailwind v4</span></div><div><button aria-label="List view" className={view === "list" ? "active" : ""} onClick={() => setView("list")} type="button">☷</button><button aria-label="Grid view" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} type="button">⊞</button></div></div>
    <input autoFocus className="tailwind-palette-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search colors" value={query} />
    <div className="tailwind-palette-list">{entries.length ? entries.map((entry) => <button key={entry.token} onClick={() => { onPick(entry.token, entry.css); onClose(); }} title={entry.token} type="button"><i style={{ background: entry.css === "transparent" ? "repeating-conic-gradient(#3a3a44 0% 25%, #555 0% 50%) 0 0 / 8px 8px" : entry.css }} />{view === "list" ? <span>{entry.token}</span> : null}</button>) : <p>No colors found.</p>}</div>
  </div>;
}

function TailwindIcon() {
  return <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15"><path d="M12 6c-2.67 0-4.33 1.33-5 4 1-1.33 2.17-1.83 3.5-1.5.76.19 1.31.74 1.91 1.35C13.39 10.85 14.53 12 17 12c2.67 0 4.33-1.33 5-4-1 1.33-2.17 1.83-3.5 1.5-.76-.19-1.31-.74-1.91-1.35C15.61 7.15 14.47 6 12 6ZM7 12c-2.67 0-4.33 1.33-5 4 1-1.33 2.17-1.83 3.5-1.5.76.19 1.31.74 1.91 1.35C8.39 16.85 9.53 18 12 18c2.67 0 4.33-1.33 5-4-1 1.33-2.17 1.83-3.5 1.5-.76-.19-1.31-.74-1.91-1.35C10.61 13.15 9.47 12 7 12Z" fill="#38bdf8" /></svg>;
}

function ColorStyleControl({
  label,
  property,
  value,
  disabled,
  selection,
  themeEntries,
  onPreview,
  onBindToken,
  onPickTailwind,
}: {
  label: string;
  property: "color" | "background-color";
  value: string;
  disabled: boolean;
  selection: ComponentInfo | null;
  themeEntries: [string, string][];
  onPreview: (value: string) => void;
  onBindToken: (property: string, token: string) => void;
  onPickTailwind: (property: string, token: string, css: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [tailwindAnchor, setTailwindAnchor] = useState<HTMLElement | null>(null);
  const [boundTokenOverride, setBoundTokenOverride] = useState<string | null>(null);
  const token = boundTokenOverride ?? boundThemeToken(selection, property, themeEntries);
  const tokenValue = token ? themeEntries.find(([name]) => name === token)?.[1] : null;
  const renderable = toRenderableCss(tokenValue ?? value);
  const displayValue = token ? `var(--${token})` : value;

  useEffect(() => {
    setPickerOpen(false);
    setVarsOpen(false);
    setTailwindAnchor(null);
    setBoundTokenOverride(null);
  }, [selection?.filePath, selection?.lineNumber, property]);

  return <div className="overlay-color-control">
    <span className="overlay-color-label">{label}</span>
    <div className="overlay-color-editor">
      <button aria-label={`Edit ${label}`} className="overlay-color-swatch" disabled={disabled} onClick={(event) => { setAnchor(event.currentTarget); setPickerOpen((open) => !open); setVarsOpen(false); setTailwindAnchor(null); }} style={{ background: renderable ?? "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px" }} type="button" />
      <input disabled={disabled} onChange={(event) => { setBoundTokenOverride(null); if (!event.target.value.trim().startsWith("var(")) onPreview(event.target.value); }} value={displayValue} />
      <button aria-expanded={varsOpen} className="overlay-var-button" disabled={disabled || themeEntries.length === 0} onClick={() => { setVarsOpen((open) => !open); setPickerOpen(false); setTailwindAnchor(null); }} type="button">var</button>
      <button aria-label="Pick a Tailwind color" className="overlay-tailwind-button" disabled={disabled} onClick={(event) => { setTailwindAnchor((current) => current ? null : event.currentTarget); setPickerOpen(false); setVarsOpen(false); }} type="button"><TailwindIcon /></button>
      {varsOpen ? <div className="overlay-var-menu">{themeEntries.filter(([, value]) => toRenderableCss(value)).map(([name, value]) => <button key={name} onClick={() => { setBoundTokenOverride(name); onBindToken(property, name); setVarsOpen(false); }} type="button"><i style={{ background: toRenderableCss(value) ?? "transparent" }} /><span>{name}</span></button>)}</div> : null}
      {pickerOpen && anchor ? <ColorPicker left={Math.max(8, Math.min(anchor.getBoundingClientRect().left, window.innerWidth - 304))} onChange={(next) => onPreview(next)} onClose={() => setPickerOpen(false)} top={anchor.getBoundingClientRect().top - 36} value={value} /> : null}
      {tailwindAnchor ? <TailwindPalette anchor={tailwindAnchor} onClose={() => setTailwindAnchor(null)} onPick={(nextToken, css) => { setBoundTokenOverride(null); onPickTailwind(property, nextToken, css); }} /> : null}
    </div>
  </div>;
}

type OverlayIconName = "pointer" | "undo" | "logs" | "reset" | "theme" | "help" | "settings" | "close";

/** The Web studio's Phosphor set is the canonical desktop icon source. */
function OverlayIcon({ name }: { name: OverlayIconName }) {
  const props = { "aria-hidden": true, className: `overlay-icon overlay-icon-${name}`, size: 18 } as const;
  switch (name) {
    case "pointer": return <CursorIcon {...props} weight="fill" />;
    case "undo": return <ArrowCounterClockwiseIcon {...props} weight="bold" />;
    case "logs": return <ListBulletsIcon {...props} weight="bold" />;
    case "reset": return <ArrowClockwiseIcon {...props} weight="bold" />;
    case "theme": return <PaletteIcon {...props} weight="fill" />;
    case "help": return <QuestionIcon {...props} weight="bold" />;
    case "settings": return <GearSixIcon {...props} weight="bold" />;
    case "close": return <XIcon {...props} weight="bold" />;
  }
}

function ToolButton({ active, disabled, label, onClick, children }: { active?: boolean; disabled?: boolean; label: string; onClick?: () => void; children: ReactNode }) {
  return <button aria-label={label} className={`overlay-tool-button${active ? " active" : ""}`} disabled={disabled} onClick={onClick} title={label} type="button">{children}</button>;
}

function OverlaySection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="native-overlay-section"><div className="native-section-heading"><span>{title}</span><CaretDownIcon size={15} weight="bold" /></div>{children}</section>;
}

function Segment({ active, children, disabled, onClick }: { active?: boolean; children: ReactNode; disabled?: boolean; onClick?: () => void }) {
  return <button aria-pressed={active} className={`native-segment${active ? " active" : ""}`} disabled={disabled} onClick={onClick} type="button">{children}</button>;
}

function ColorPicker({ value, top, left = 8, onChange, onClose }: { value: string; top: number; left?: number; onChange: (value: string) => void; onClose: () => void }) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerTop = Math.max(8, Math.min(top - 36, window.innerHeight - 360));
  const colorKind = detectColorKind(value) ?? "hex";

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!pickerRef.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key, true); };
  }, [onClose]);

  return <div className="desktop-color-picker web-picker" onPointerDown={(event) => event.stopPropagation()} ref={pickerRef} style={{ left, top: pickerTop }}>
    <ThemeColorPicker defaultValue={toHex(value) ?? "#000000"} onChange={(hex) => onChange(serializeToKind(hex, colorKind))} />
  </div>;
}

function FlexGlyph({ name }: { name: "justify-start" | "justify-center" | "justify-end" | "justify-between" | "justify-around" | "align-start" | "align-center" | "align-end" | "stretch" | "baseline" }) {
  const paths: Record<typeof name, ReactNode> = {
    "justify-start": <><rect height="6" rx="2" width="14" x="5" y="16" /><rect height="6" rx="2" width="10" x="7" y="6" /><path d="M2 2h20" /></>,
    "justify-center": <><rect height="6" rx="2" width="14" x="5" y="16" /><rect height="6" rx="2" width="10" x="7" y="2" /><path d="M2 12h20" /></>,
    "justify-end": <><rect height="6" rx="2" width="14" x="5" y="12" /><rect height="6" rx="2" width="10" x="7" y="2" /><path d="M2 22h20" /></>,
    "justify-between": <><rect height="6" rx="2" width="14" x="5" y="15" /><rect height="6" rx="2" width="10" x="7" y="3" /><path d="M2 21h20" /><path d="M2 3h20" /></>,
    "justify-around": <><rect height="6" rx="2" width="10" x="7" y="9" /><path d="M22 20H2" /><path d="M22 4H2" /></>,
    "align-start": <><rect height="6" rx="2" width="9" x="6" y="14" /><rect height="6" rx="2" width="16" x="6" y="4" /><path d="M2 2v20" /></>,
    "align-center": <><path d="M12 2v20" /><path d="M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4" /><path d="M16 10h4a2 2 0 0 0 2-2V6c0-1.1.9-2 2-2h-4" /><path d="M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1" /><path d="M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1" /></>,
    "align-end": <><rect height="6" rx="2" width="16" x="2" y="4" /><rect height="6" rx="2" width="9" x="9" y="14" /><path d="M22 22V2" /></>,
    stretch: <><rect height="6" rx="2" width="20" x="2" y="4" /><rect height="6" rx="2" width="20" x="2" y="14" /></>,
    baseline: <><path d="M4 20h16" /><path d="m6 16 6-12 6 12" /><path d="M8 12h8" /></>,
  };
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">{paths[name]}</svg>;
}

export function App() {
  const [status, setStatus] = useState("Connecting preview");
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [workspaceSummary, setWorkspaceSummary] = useState<WorkspaceSummary | null>(null);
  const [selection, setSelection] = useState<ComponentInfo | null>(null);
  const [theme, setTheme] = useState<ThemePayload>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [themeEdits, setThemeEdits] = useState<Record<string, string>>({});
  const [activeProposal, setActiveProposal] = useState<ThemeProposal | null>(null);
  const [pendingChanges, setPendingChanges] = useState<ThemeProposal[]>([]);
  const [lastAppliedChange, setLastAppliedChange] = useState<ThemeProposal | null>(null);
  const [recoveryHistory, setRecoveryHistory] = useState<RecoveryEntry[]>([]);
  const [changesOpen, setChangesOpen] = useState(false);
  const [activeColor, setActiveColor] = useState<{ name: string; value: string; top: number } | null>(null);
  const [themePalette, setThemePalette] = useState<{ name: string; anchor: HTMLElement } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [themeStatus, setThemeStatus] = useState("");
  const [variantBreakpoint, setVariantBreakpoint] = useState("");
  const [variantDark, setVariantDark] = useState(false);
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, string>>({});
  const [styleUpdates, setStyleUpdates] = useState<Record<string, TailwindProposalUpdate>>({});
  const [classDraft, setClassDraft] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const sidebarDrag = useRef(false);

  useEffect(() => {
    void window.themelabDesktop.getWorkspaceRoot().then((root) => setWorkspaceName(root?.split("/").at(-1) ?? null));
    refreshWorkspaceSummary();
    void window.themelabDesktop.listChanges().then((changes) => {
      setPendingChanges(changes);
      setActiveProposal(changes.at(-1) ?? null);
    });
    void window.themelabDesktop.listChangeHistory().then((history) => {
      if (Array.isArray(history)) setRecoveryHistory(history);
    });
    const removeBoundsListener = window.themelabDesktop.onRequestPreviewBounds(() => requestAnimationFrame(sendPreviewBounds));
    const removeStatusListener = window.themelabDesktop.onPreviewStatus((event) => setStatus(event.status === "error" ? event.message ?? "Preview error" : "Preview connected"));
    const removeSelectionListener = window.themelabDesktop.onPreviewSelection(setSelection);
    const removeThemeListener = window.themelabDesktop.onPreviewTheme(setTheme);
    return () => { removeBoundsListener(); removeStatusListener(); removeSelectionListener(); removeThemeListener(); };
  }, []);

  const chooseWorkspace = () => {
    void window.themelabDesktop.chooseWorkspace().then((root) => {
      if (!root) return;
      setWorkspaceName(root.split("/").at(-1) ?? root);
      setStatus("Starting preview");
      void window.themelabDesktop.startWorkspace().then((result) => {
        setStatus(result.error ?? "Connecting preview");
        if (!result.error) {
          setPendingChanges([]);
          setActiveProposal(null);
          setLastAppliedChange(null);
          setWorkspaceSummary(result.workspace ?? null);
          refreshRecoveryHistory();
        }
      });
    });
  };

  const refreshRecoveryHistory = () => {
    void window.themelabDesktop.listChangeHistory().then((history) => {
      if (Array.isArray(history)) setRecoveryHistory(history);
    });
  };
  function refreshWorkspaceSummary() {
    void window.themelabDesktop.getWorkspaceSummary().then(setWorkspaceSummary);
  }

  function sendPreviewBounds() {
    const slot = document.getElementById("preview-slot");
    if (!slot) return;
    const rect = slot.getBoundingClientRect();
    // The slot already has the top and bottom insets for the native chrome.
    // Send its exact compositor bounds; subtracting the action-bar gutter a
    // second time leaves a visible strip of the placeholder canvas underneath
    // the native WebContentsView.
    window.themelabDesktop.setPreviewBounds({ x: rect.x, y: rect.y, width: rect.width, height: Math.max(1, rect.height) });
  }

  useEffect(() => {
    const slot = document.getElementById("preview-slot");
    if (!slot) return;
    const observer = new ResizeObserver(sendPreviewBounds);
    observer.observe(slot);
    const firstFrame = requestAnimationFrame(sendPreviewBounds);
    // The native WebContentsView must receive a second measurement after CSS,
    // fonts, and the Electron frame have settled; otherwise it can cover the
    // floating action bar's reserved gutter on first launch.
    const afterLayout = window.setTimeout(sendPreviewBounds, 120);
    const afterPaint = window.setTimeout(sendPreviewBounds, 700);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(firstFrame);
      window.clearTimeout(afterLayout);
      window.clearTimeout(afterPaint);
    };
  }, [inspectorOpen, sidebarWidth, themeOpen]);

  const selectionKey = selection ? `${selection.filePath}:${selection.lineNumber}:${selection.columnNumber}` : "";
  useEffect(() => {
    setPreviewOverrides({});
    setStyleUpdates({});
    setClassDraft(selection?.className ?? "");
  }, [selectionKey, selection?.className]);
  useEffect(() => { if (selection) setInspectorOpen(true); }, [selection]);

  const previewStyle = (property: string, value: string) => {
    if (!selection || !value.trim()) return;
    setPreviewOverrides((current) => ({ ...current, [property]: value }));
    const descriptor = ALL_DESCRIPTORS.find((entry) => entry.cssProperty === property);
    const enumValue = descriptor?.enumValues?.find((entry) => entry.value === value);
    if (descriptor && enumValue) {
      // Match the overlay/CLI canonical order so a desktop proposal has the
      // same stable class spelling as an overlay edit (dark:md:bg-*).
      const variant = [variantDark ? "dark" : "", variantBreakpoint].filter(Boolean).join(":") || undefined;
      setStyleUpdates((current) => ({ ...current, [property]: { tailwindPrefix: descriptor.tailwindPrefix, tailwindToken: enumValue.tailwindValue, value, relatedPrefixes: descriptor.relatedPrefixes, classPattern: descriptor.classPattern, standalone: descriptor.standalone, variant } }));
    }
    void window.themelabDesktop.applyPreviewStyle(property, value).then((next) => next && setSelection(next));
  };
  const bindPreviewToken = (property: string, token: string) => {
    const descriptor = ALL_DESCRIPTORS.find((entry) => entry.cssProperty === property);
    if (descriptor) setStyleUpdates((current) => ({ ...current, [property]: { tailwindPrefix: descriptor.tailwindPrefix, tailwindToken: token, value: `var(--${token})`, relatedPrefixes: descriptor.relatedPrefixes, classPattern: descriptor.classPattern, standalone: descriptor.standalone } }));
    void window.themelabDesktop.bindPreviewToken(property, token);
  };
  const pickPreviewTailwind = (property: string, token: string, css: string) => {
    const key = property === "background-color" ? "backgroundColor" : property;
    const descriptor = ALL_DESCRIPTORS.find((entry) => entry.cssProperty === property);
    if (descriptor) setStyleUpdates((current) => ({ ...current, [property]: { tailwindPrefix: descriptor.tailwindPrefix, tailwindToken: token, value: css, relatedPrefixes: descriptor.relatedPrefixes, classPattern: descriptor.classPattern, standalone: descriptor.standalone } }));
    void window.themelabDesktop.pickPreviewTailwind(key, token, css);
  };
  const navigatePreview = (direction: "up" | "down" | "left" | "right") => {
    void window.themelabDesktop.navigatePreview(direction);
  };
  const movePreview = (direction: "up" | "down") => {
    void window.themelabDesktop.movePreview(direction);
  };
  const setPreviewVariant = (breakpoint: string, dark: boolean) => {
    setVariantBreakpoint(breakpoint);
    setVariantDark(dark);
    void window.themelabDesktop.setPreviewVariant(breakpoint, dark);
  };
  const discardPreview = () => void window.themelabDesktop.clearPreviewStyles().then((next) => { setPreviewOverrides({}); setStyleUpdates({}); if (next) setSelection(next); });
  const styleValue = (property: string, key: keyof ComponentStyleSnapshot) => previewOverrides[property] ?? selection?.computedStyle?.[key] ?? "";
  const selectStyle = (property: string, value: string) => previewStyle(property, value);
  const previewChangeCount = Object.keys(previewOverrides).length;
  const reviewableStyleCount = Object.keys(styleUpdates).length;
  const beginSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    sidebarDrag.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!sidebarDrag.current) return;
      const next = window.innerWidth - event.clientX;
      setSidebarWidth(Math.max(300, Math.min(460, next)));
    };
    const onUp = () => { sidebarDrag.current = false; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);
  const themeEntries = useMemo(() => Object.entries(theme?.theme[themeMode] ?? {}), [theme, themeMode]);
  const activeThemeProposal = activeProposal?.origin === "theme" ? activeProposal : null;
  const paddingSides = expandBoxSides(styleValue("padding", "padding"));
  const marginSides = expandBoxSides(styleValue("margin", "margin"));
  const themeValue = (name: string, committed: string) => themeEdits[`${themeMode}:${name}`] ?? committed;
  const setMode = (mode: "light" | "dark") => {
    setThemeMode(mode);
    setActiveColor(null);
    setThemePalette(null);
    void window.themelabDesktop.setPreviewThemeMode(mode);
  };
  const stageThemeValue = (name: string, value: string) => {
    setThemeEdits((current) => ({ ...current, [`${themeMode}:${name}`]: value }));
    void window.themelabDesktop.applyPreviewTheme(themeMode, name, value);
  };
  const stagePendingChange = (proposal: ThemeProposal) => {
    setPendingChanges((current) => [...current.filter((change) => change.id !== proposal.id), proposal]);
    setActiveProposal(proposal);
    setChangesOpen(true);
  };
  const resetThemeDraft = () => {
    setThemeEdits({});
    setActiveColor(null);
    void window.themelabDesktop.resetPreviewTheme();
  };
  const discardActiveChange = () => {
    if (!activeProposal) return;
    void window.themelabDesktop.discardChange(activeProposal.id);
    const next = pendingChanges.filter((change) => change.id !== activeProposal.id);
    setPendingChanges(next);
    setActiveProposal(next.at(-1) ?? null);
    if (activeProposal.origin === "theme") {
      resetThemeDraft();
    } else {
      void window.themelabDesktop.clearPreviewStyles();
      setPreviewOverrides({});
      setStyleUpdates({});
    }
  };
  const proposeTheme = () => {
    void window.themelabDesktop.proposeTheme(themeEdits).then((proposal) => {
      if (!proposal) {
        setThemeStatus("Could not prepare a source change. Check that the detected theme file is inside this workspace.");
        return;
      }
      stagePendingChange(proposal);
      setThemeStatus(`Review ${proposal.files.length} file before applying.`);
    });
  };
  const applyActiveChange = () => {
    if (!activeProposal) return;
    void window.themelabDesktop.applyChange(activeProposal.id).then((result) => {
      if (!result) {
        setThemeStatus("The pending proposal is no longer available.");
        return;
      }
      if (result.error) {
        setThemeStatus(result.error);
        return;
      }
      const next = pendingChanges.filter((change) => change.id !== activeProposal.id);
      setPendingChanges(next);
      setActiveProposal(next.at(-1) ?? null);
      setChangesOpen(false);
      if (activeProposal.origin === "theme") {
        setThemeEdits({});
        void window.themelabDesktop.resetPreviewTheme();
      } else {
        void window.themelabDesktop.clearPreviewStyles();
        setPreviewOverrides({});
        setStyleUpdates({});
      }
      setThemeStatus(`Applied safely. Recovery copy: ${result.recoveryPath}`);
      refreshRecoveryHistory();
      refreshWorkspaceSummary();
    });
  };
  const undoLastChange = () => {
    if (!lastAppliedChange) return;
    void window.themelabDesktop.undoChange(lastAppliedChange.id).then((result) => {
      if (!result) {
        setThemeStatus("The applied change is no longer available for undo.");
        return;
      }
      if (result.error) {
        setThemeStatus(result.error);
        return;
      }
      setThemeStatus(`Undid ${lastAppliedChange.label}.`);
      setLastAppliedChange(null);
      refreshRecoveryHistory();
      refreshWorkspaceSummary();
    });
  };
  const undoRecoveryChange = (entry: RecoveryEntry) => {
    void window.themelabDesktop.undoChange(entry.proposalId).then((result) => {
      if (!result) {
        setThemeStatus("The recovery record is no longer available.");
        return;
      }
      if (result.error) {
        setThemeStatus(result.error);
        refreshRecoveryHistory();
        return;
      }
      setThemeStatus(`Undid ${entry.label}.`);
      setLastAppliedChange(null);
      refreshRecoveryHistory();
      refreshWorkspaceSummary();
    });
  };
  const proposeStyleChanges = () => {
    if (!selection || !Object.keys(styleUpdates).length) return;
    void window.themelabDesktop.proposeTailwindChanges(selection, Object.values(styleUpdates)).then((proposal) => {
      if (!proposal || proposal.error || !proposal.id || !proposal.diff || !proposal.files) {
        setThemeStatus(proposal?.error ?? "Could not prepare Tailwind changes.");
        return;
      }
      stagePendingChange({ id: proposal.id, label: proposal.label ?? "Update component styles", createdAt: proposal.createdAt ?? Date.now(), origin: proposal.origin ?? "other", operation: proposal.operation ?? null, selectionKey: proposal.selectionKey ?? null, diff: proposal.diff, files: proposal.files });
    });
  };
  const proposeClassChange = () => {
    if (!selection || !classDraft.trim()) return;
    void window.themelabDesktop.proposeClassChange(selection, classDraft.trim()).then((proposal) => {
      if (!proposal || proposal.error || !proposal.id || !proposal.diff || !proposal.files) {
        setThemeStatus(proposal?.error ?? "Could not prepare a component class change.");
        return;
      }
      stagePendingChange({ id: proposal.id, label: proposal.label ?? "Update component classes", createdAt: proposal.createdAt ?? Date.now(), origin: proposal.origin ?? "other", operation: proposal.operation ?? null, selectionKey: proposal.selectionKey ?? null, diff: proposal.diff, files: proposal.files });
    });
  };
  // The existing footer retains its compact layout; invoking Apply now prepares
  // a proposal. The next action is intentionally the explicit apply IPC above.
  const commitTheme = proposeTheme;
  const applyPastedTheme = () => {
    void window.themelabDesktop.pasteTheme(pasteDraft).then((result) => {
      if (!result) {
        setThemeStatus("Couldn't parse — paste CSS or JSON from ThemeLab Studio.");
        return;
      }
      if (result.applied === 0) {
        setThemeStatus("No matching tokens found in this project's theme.");
        return;
      }
      setPasteDraft("");
      setThemeStatus(`Applied ${result.applied} token${result.applied === 1 ? "" : "s"}${result.skipped ? `, skipped ${result.skipped}` : ""}. Hit Apply to save.`);
    });
  };

  return (
    <div className="overlay-desktop-shell">
      <header className="overlay-desktop-header">
        <Logo />
        <span className="header-separator" />
        <span className="desktop-status"><i className={status === "Preview connected" ? "online" : ""} />{status}</span>
        <button className="header-project" onClick={chooseWorkspace} title={workspaceName ? `Change project (current: ${workspaceName})` : "Choose a React project"} type="button">{workspaceName ?? "Open project"}</button>
        <div className="header-spacer" />
        <button aria-pressed={changesOpen} className="header-action" onClick={() => setChangesOpen((open) => !open)} type="button">Changes{pendingChanges.length ? ` (${pendingChanges.length})` : ""}</button>
        <button className="header-action" type="button"><SparkleIcon size={15} weight="bold" /> Agent</button>
        <button className="header-action primary" disabled={!reviewableStyleCount} onClick={proposeStyleChanges} type="button"><CheckIcon size={15} weight="bold" /> Review</button>
      </header>

      <div className={`overlay-desktop-body${inspectorOpen ? "" : " inspector-closed"}`} style={{ "--desktop-inspector-width": `${sidebarWidth}px` } as CSSProperties}>
        <main className={`preview-stage${themeOpen ? " theme-open" : ""}`}>
          <div className={`preview-canvas${themeOpen ? " theme-open" : ""}`} id="preview-slot"><div className="preview-loading">Loading proxied app</div></div>

          {themeOpen ? <aside className="native-theme-dock">
            <div className="theme-dock-heading"><strong>Theme</strong><div className="theme-mode-switch"><button className={themeMode === "light" ? "active" : ""} onClick={() => setMode("light")} type="button">Light</button><button className={themeMode === "dark" ? "active" : ""} onClick={() => setMode("dark")} type="button">Dark</button></div><button aria-label="Collapse Theme" onClick={() => { setActiveColor(null); setThemePalette(null); setThemeOpen(false); }} type="button">×</button></div>
            <div className="theme-actions"><div><button onClick={() => void window.themelabDesktop.openThemeEditor()} type="button">↗ Open in editor</button><button onClick={() => { setPasteOpen((open) => !open); setThemeStatus(""); }} type="button">{pasteOpen ? "Close paste" : "Paste theme"}</button></div><span>Format: {theme?.source ? "CSS variables" : "Detected"}</span><small title={theme?.source?.filePath}>{theme?.source?.filePath ?? "No theme source"}</small>{pasteOpen ? <div className="theme-paste-box"><textarea onChange={(event) => setPasteDraft(event.target.value)} placeholder="Paste the studio export — shadcn CSS or JSON" rows={5} spellCheck={false} value={pasteDraft} /><button onClick={applyPastedTheme} type="button">Apply pasted</button></div> : null}{themeStatus ? <small className="theme-status">{themeStatus}</small> : null}</div>
            <div className="theme-token-list">{themeEntries.length ? themeEntries.map(([name, committed]) => { const value = themeValue(name, committed); const renderable = toRenderableCss(value); return <div className="theme-token" key={name}><button aria-label={`Edit ${name}`} className="theme-token-swatch" disabled={!renderable} onClick={(event) => { const row = event.currentTarget.closest(".theme-token") as HTMLElement | null; setThemePalette(null); setActiveColor({ name, value, top: row?.offsetTop ?? 0 }); }} style={{ background: renderable ?? "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px" }} type="button" /><span title={name}>{name}</span><input aria-label={name} onChange={(event) => stageThemeValue(name, event.target.value)} title={value} value={value} /><button aria-label={`Pick a Tailwind color for ${name}`} className="theme-tailwind-button" onClick={(event) => { setActiveColor(null); setThemePalette((current) => current?.name === name ? null : { name, anchor: event.currentTarget }); }} type="button"><TailwindIcon /></button>{activeColor?.name === name ? <ColorPicker onChange={(next) => stageThemeValue(name, next)} onClose={() => setActiveColor(null)} top={activeColor.top} value={value} /> : null}</div>; }) : <p>No theme tokens found.</p>}</div>
            {themePalette ? <TailwindPalette anchor={themePalette.anchor} inThemeDock onClose={() => setThemePalette(null)} onPick={(_token, css) => stageThemeValue(themePalette.name, css)} /> : null}
            {activeThemeProposal ? <section className="theme-change-review"><strong>Pending change</strong><span>{activeThemeProposal.files.join(", ")}</span><pre>{activeThemeProposal.diff}</pre><div className="theme-footer"><button onClick={discardActiveChange} type="button">Discard</button><button onClick={applyActiveChange} type="button">Apply change</button></div></section> : <div className="theme-footer"><button disabled={!Object.keys(themeEdits).length} onClick={resetThemeDraft} type="button">Reset</button><button disabled={!Object.keys(themeEdits).length} onClick={commitTheme} type="button">Review changes</button></div>}
          </aside> : null}

          {changesOpen ? <section aria-label="Pending changes" className="changes-panel">
            <div className="changes-panel-header"><div><strong>Changes</strong><span>{pendingChanges.length ? `${pendingChanges.length} pending review${pendingChanges.length === 1 ? "" : "s"}` : recoveryHistory.length ? `${recoveryHistory.length} recorded change${recoveryHistory.length === 1 ? "" : "s"}` : "No pending changes"}</span>{workspaceSummary?.git.available ? <span className="changes-git" title={workspaceSummary.git.root ?? undefined}>Git {workspaceSummary.git.branch ?? "detached"}{workspaceSummary.git.changedFiles ? ` · ${workspaceSummary.git.changedFiles} local` : " · clean"}</span> : null}</div><button aria-label="Close changes" onClick={() => setChangesOpen(false)} type="button">×</button></div>
            {activeProposal ? <><div className="changes-tabs">{pendingChanges.map((change) => <button aria-pressed={change.id === activeProposal.id} key={change.id} onClick={() => setActiveProposal(change)} type="button">{change.label}</button>)}</div><div className="changes-file"><code>{activeProposal.origin}{activeProposal.operation ? ` · ${activeProposal.operation}` : ""}</code>{activeProposal.files.map((file) => <code key={file}>{file}</code>)}</div><pre>{activeProposal.diff}</pre><div className="changes-panel-actions"><button onClick={discardActiveChange} type="button">Discard</button><button onClick={applyActiveChange} type="button">Apply change</button></div></> : <div className="changes-history">{lastAppliedChange ? <div className="changes-history-row"><span>Applied: {lastAppliedChange.label}</span><button onClick={undoLastChange} type="button">Undo last change</button></div> : null}{recoveryHistory.map((entry) => <div className="changes-history-row" key={entry.proposalId}><div><strong>{entry.label}</strong><span>{entry.origin}{entry.operation ? ` · ${entry.operation}` : ""} · {entry.files.join(", ")}</span></div><span className={`change-status ${entry.status}`}>{entry.status === "undoable" ? "Undo available" : entry.status === "undone" ? "Undone" : "Source changed"}</span>{entry.status === "undoable" ? <button onClick={() => undoRecoveryChange(entry)} type="button">Undo</button> : null}</div>)}{!lastAppliedChange && !recoveryHistory.length ? <p className="changes-empty">Visual edits will appear here as reviewable source patches.</p> : null}</div>}
          </section> : null}

          <div className="native-bottom-bar">
            <div className="bottom-tools" aria-label="Overlay tools">
              <ToolButton active label="Select"><OverlayIcon name="pointer" /></ToolButton>
              <ToolButton label="Canvas undo" onClick={() => void window.themelabDesktop.canvasUndoPreview()}><OverlayIcon name="undo" /></ToolButton>
              <ToolButton label="History & Logs" onClick={() => void window.themelabDesktop.togglePreviewHistory()}><OverlayIcon name="logs" /></ToolButton>
              <ToolButton label="Reset canvas" onClick={() => void window.themelabDesktop.resetPreview()}><OverlayIcon name="reset" /></ToolButton>
              <ToolButton active={themeOpen} label="Theme" onClick={() => setThemeOpen((open) => !open)}><OverlayIcon name="theme" /></ToolButton>
              <ToolButton label="Keyboard shortcuts" onClick={() => void window.themelabDesktop.togglePreviewShortcuts()}><OverlayIcon name="help" /></ToolButton>
              <ToolButton label="Settings" onClick={() => void window.themelabDesktop.togglePreviewSettings()}><OverlayIcon name="settings" /></ToolButton>
            </div>
            <span className="bottom-divider" />
            <div className="bottom-selection">{selection ? <><code>&lt;{selection.tagName}&gt;</code><strong>{selection.componentName}</strong><span>{selection.filePath}:{selection.lineNumber}</span></> : "No selection"}</div>
            <span className="bottom-divider" />
            <ToolButton disabled label="Undo reorder" onClick={() => void window.themelabDesktop.undoPreview()}><OverlayIcon name="undo" /></ToolButton>
            <span className="bottom-divider" />
            {previewChangeCount ? <button className="bottom-secondary" onClick={discardPreview} type="button">Discard preview</button> : null}
            <button className="bottom-confirm" disabled={!reviewableStyleCount} onClick={proposeStyleChanges} type="button">Review{reviewableStyleCount ? ` (${reviewableStyleCount})` : ""}</button>
            <button aria-label="Agent support is not connected yet" className="bottom-ai" disabled title="Agent support is not connected yet" type="button"><SparkleIcon size={16} weight="fill" /></button>
            <ToolButton label="Close ThemeLab" onClick={() => void window.themelabDesktop.closePreview()}><OverlayIcon name="close" /></ToolButton>
          </div>
        </main>

        <aside className="native-property-sidebar">
          <button aria-label="Resize inspector" className="property-resize-handle" onPointerDown={beginSidebarResize} type="button" />
          <div className="property-header"><div><p>{selection ? `<${selection.componentName}>` : "No selection"}</p><span>{selection ? `${selection.filePath}:${selection.lineNumber}` : "Click an element in the preview"}</span></div><button aria-label="Collapse inspector" onClick={() => setInspectorOpen(false)} type="button"><svg aria-hidden="true" fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 12 12" width="12"><polyline points="8,2 4,6 8,10" /></svg></button></div>
          <div className="property-variants"><div className="property-variant-seg">{[["", "Base"], ["sm", "sm"], ["md", "md"], ["lg", "lg"], ["xl", "xl"], ["2xl", "2xl"]].map(([breakpoint, label]) => <button className={variantBreakpoint === breakpoint ? "active" : ""} key={breakpoint} onClick={() => setPreviewVariant(breakpoint, variantDark)} type="button">{label}</button>)}</div><button className="dark-mode" onClick={() => setPreviewVariant(variantBreakpoint, !variantDark)} type="button">◐ Dark</button></div>
          <div className="property-nav"><button onClick={() => navigatePreview("left")} type="button">←</button><button onClick={() => navigatePreview("up")} type="button">↑</button><button onClick={() => navigatePreview("down")} type="button">↓</button><button onClick={() => navigatePreview("right")} type="button">→</button></div>
          <div className="property-move"><button onClick={() => movePreview("up")} type="button">↑ Move up <span>[</span></button><button onClick={() => movePreview("down")} type="button">↓ Move down <span>]</span></button></div>
          <div className="property-scroll">
            <OverlaySection title="Source">
              <label className="source-class-control"><span>className</span><input disabled={!selection} onChange={(event) => setClassDraft(event.target.value)} spellCheck={false} value={classDraft} /><button disabled={!selection || !classDraft.trim()} onClick={proposeClassChange} type="button">Review change</button></label>
            </OverlaySection>
            <OverlaySection title="Layout">
              <div className="overlay-option-row"><span>Display</span><div className="native-segments"><Segment active={styleValue("display", "display") === "block"} disabled={!selection} onClick={() => selectStyle("display", "block")}>Block</Segment><Segment active={styleValue("display", "display") === "flex"} disabled={!selection} onClick={() => selectStyle("display", "flex")}>Flex</Segment><Segment active={styleValue("display", "display") === "grid"} disabled={!selection} onClick={() => selectStyle("display", "grid")}>Grid</Segment><Segment active={styleValue("display", "display") === "inline-flex"} disabled={!selection} onClick={() => selectStyle("display", "inline-flex")}>Inline Flex</Segment><Segment active={styleValue("display", "display") === "none"} disabled={!selection} onClick={() => selectStyle("display", "none")}>None</Segment></div></div>
              <div className="overlay-option-row"><span>Direction</span><div className="native-segments icon-segments"><Segment active={styleValue("flex-direction", "flexDirection") === "row"} disabled={!selection} onClick={() => selectStyle("flex-direction", "row")}>→</Segment><Segment active={styleValue("flex-direction", "flexDirection") === "column"} disabled={!selection} onClick={() => selectStyle("flex-direction", "column")}>↓</Segment><Segment active={styleValue("flex-direction", "flexDirection") === "row-reverse"} disabled={!selection} onClick={() => selectStyle("flex-direction", "row-reverse")}>←</Segment><Segment active={styleValue("flex-direction", "flexDirection") === "column-reverse"} disabled={!selection} onClick={() => selectStyle("flex-direction", "column-reverse")}>↑</Segment></div></div>
              <div className="overlay-option-row stack"><span>justify-content: <b>{styleValue("justify-content", "justifyContent") || "normal"}</b></span><div className="native-segments icon-segments"><Segment active={styleValue("justify-content", "justifyContent") === "flex-start"} disabled={!selection} onClick={() => selectStyle("justify-content", "flex-start")}><FlexGlyph name="justify-start" /></Segment><Segment active={styleValue("justify-content", "justifyContent") === "center"} disabled={!selection} onClick={() => selectStyle("justify-content", "center")}><FlexGlyph name="justify-center" /></Segment><Segment active={styleValue("justify-content", "justifyContent") === "flex-end"} disabled={!selection} onClick={() => selectStyle("justify-content", "flex-end")}><FlexGlyph name="justify-end" /></Segment><Segment active={styleValue("justify-content", "justifyContent") === "space-between"} disabled={!selection} onClick={() => selectStyle("justify-content", "space-between")}><FlexGlyph name="justify-between" /></Segment><Segment active={styleValue("justify-content", "justifyContent") === "space-around"} disabled={!selection} onClick={() => selectStyle("justify-content", "space-around")}><FlexGlyph name="justify-around" /></Segment></div></div>
              <div className="overlay-option-row stack"><span>align-items: <b>{styleValue("align-items", "alignItems") || "normal"}</b></span><div className="native-segments icon-segments"><Segment active={styleValue("align-items", "alignItems") === "flex-start"} disabled={!selection} onClick={() => selectStyle("align-items", "flex-start")}><FlexGlyph name="align-start" /></Segment><Segment active={styleValue("align-items", "alignItems") === "center"} disabled={!selection} onClick={() => selectStyle("align-items", "center")}><FlexGlyph name="align-center" /></Segment><Segment active={styleValue("align-items", "alignItems") === "flex-end"} disabled={!selection} onClick={() => selectStyle("align-items", "flex-end")}><FlexGlyph name="align-end" /></Segment><Segment active={styleValue("align-items", "alignItems") === "stretch"} disabled={!selection} onClick={() => selectStyle("align-items", "stretch")}><FlexGlyph name="stretch" /></Segment><Segment active={styleValue("align-items", "alignItems") === "baseline"} disabled={!selection} onClick={() => selectStyle("align-items", "baseline")}><FlexGlyph name="baseline" /></Segment></div></div>
              <StyleControl disabled={!selection} label="Gap" onChange={(value) => previewStyle("gap", value)} value={styleValue("gap", "gap")} />
            </OverlaySection>
            <OverlaySection title="Spacing">
              <div className="box-model"><span className="box-model-label margin-label">MARGIN</span><span className="box-model-value top">{marginSides[0]}</span><span className="box-model-value left">{marginSides[3]}</span><span className="box-model-value right">{marginSides[1]}</span><span className="box-model-value bottom">{marginSides[2]}</span><div className="box-model-padding"><span className="box-model-label">PADDING</span><span className="box-model-value pad-top">{paddingSides[0]}</span><span className="box-model-value pad-left">{paddingSides[3]}</span><span className="box-model-value pad-right">{paddingSides[1]}</span><span className="box-model-value pad-bottom">{paddingSides[2]}</span><span className="box-model-content">content</span></div></div>
              <StyleControl disabled={!selection} label="Padding" onChange={(value) => previewStyle("padding", value)} value={styleValue("padding", "padding")} />
              <StyleControl disabled={!selection} label="Margin" onChange={(value) => previewStyle("margin", value)} value={styleValue("margin", "margin")} />
            </OverlaySection>
            <OverlaySection title="Size"><div className="native-size-grid"><StyleControl disabled={!selection} label="W" onChange={(value) => previewStyle("width", value)} value={styleValue("width", "width")} /><StyleControl disabled={!selection} label="H" onChange={(value) => previewStyle("height", value)} value={styleValue("height", "height")} /><StyleControl disabled={!selection} label="Min W" onChange={(value) => previewStyle("min-width", value)} value={styleValue("min-width", "minWidth")} /><StyleControl disabled={!selection} label="Min H" onChange={(value) => previewStyle("min-height", value)} value={styleValue("min-height", "minHeight")} /><StyleControl disabled={!selection} label="Max W" onChange={(value) => previewStyle("max-width", value)} value={styleValue("max-width", "maxWidth")} /><StyleControl disabled={!selection} label="Max H" onChange={(value) => previewStyle("max-height", value)} value={styleValue("max-height", "maxHeight")} /></div></OverlaySection>
            <OverlaySection title="Typography">
              <StyleControl disabled={!selection} label="Size" onChange={(value) => previewStyle("font-size", value)} value={styleValue("font-size", "fontSize")} />
              <div className="overlay-option-row"><span>Weight</span><div className="native-segments">{["300", "400", "500", "600", "700"].map((weight) => <Segment active={styleValue("font-weight", "fontWeight") === weight} disabled={!selection} key={weight} onClick={() => selectStyle("font-weight", weight)}>{weight}</Segment>)}</div></div>
              <div className="overlay-option-row"><span>Case</span><div className="native-segments"><Segment active={styleValue("text-transform", "textTransform") === "none"} disabled={!selection} onClick={() => selectStyle("text-transform", "none")}>Aa</Segment><Segment active={styleValue("text-transform", "textTransform") === "uppercase"} disabled={!selection} onClick={() => selectStyle("text-transform", "uppercase")}>AA</Segment><Segment active={styleValue("text-transform", "textTransform") === "lowercase"} disabled={!selection} onClick={() => selectStyle("text-transform", "lowercase")}>aa</Segment><Segment active={styleValue("text-transform", "textTransform") === "capitalize"} disabled={!selection} onClick={() => selectStyle("text-transform", "capitalize")}>Title</Segment></div></div>
              <StyleControl disabled={!selection} label="Height" onChange={(value) => previewStyle("line-height", value)} value={styleValue("line-height", "lineHeight")} />
              <StyleControl disabled={!selection} label="Spacing" onChange={(value) => previewStyle("letter-spacing", value)} value={styleValue("letter-spacing", "letterSpacing")} />
              <div className="overlay-option-row"><span>Align</span><div className="native-segments"><Segment active={styleValue("text-align", "textAlign") === "left"} disabled={!selection} onClick={() => selectStyle("text-align", "left")}>Left</Segment><Segment active={styleValue("text-align", "textAlign") === "center"} disabled={!selection} onClick={() => selectStyle("text-align", "center")}>Center</Segment><Segment active={styleValue("text-align", "textAlign") === "right"} disabled={!selection} onClick={() => selectStyle("text-align", "right")}>Right</Segment><Segment active={styleValue("text-align", "textAlign") === "justify"} disabled={!selection} onClick={() => selectStyle("text-align", "justify")}>Justify</Segment></div></div>
            </OverlaySection>
            <OverlaySection title="Appearance">
              <ColorStyleControl disabled={!selection} label="Color" onBindToken={bindPreviewToken} onPickTailwind={pickPreviewTailwind} onPreview={(value) => previewStyle("color", value)} property="color" selection={selection} themeEntries={themeEntries} value={styleValue("color", "color")} />
              <ColorStyleControl disabled={!selection} label="Background" onBindToken={bindPreviewToken} onPickTailwind={pickPreviewTailwind} onPreview={(value) => previewStyle("background-color", value)} property="background-color" selection={selection} themeEntries={themeEntries} value={styleValue("background-color", "backgroundColor")} />
              <StyleControl disabled={!selection} label="Radius" onChange={(value) => previewStyle("border-radius", value)} value={styleValue("border-radius", "borderRadius")} />
              <StyleControl disabled={!selection} label="Opacity" onChange={(value) => previewStyle("opacity", value)} value={styleValue("opacity", "opacity")} />
            </OverlaySection>
          </div>
        </aside>
      </div>
    </div>
  );
}

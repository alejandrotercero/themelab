// packages/overlay/src/design-tokens.ts

// --- Colors ---
// Dark navy theme (per Figma node 115:322), applied across the whole overlay.
// Surfaces/text/borders are navy; `accent`/`danger` stay the brand colors.
export const COLORS = {
  bgPrimary: "#12121a",
  bgSecondary: "#1d222d",
  bgTertiary: "#262d3b",
  border: "#333950",
  borderStrong: "#43506d",
  textPrimary: "#d1cdcd",
  textSecondary: "#8b8b95",
  textTertiary: "#5f6470",
  accent: "#ec003f",
  accentHover: "#c40034",
  accentSoft: "rgba(236,0,63,0.12)",
  accentMedium: "rgba(236,0,63,0.22)",
  danger: "#e5484d",
  dangerSoft: "rgba(229,72,77,0.14)",
  textOnAccent: "#ffffff",
  marginBoxBg: "rgba(255,200,100,0.15)",
  marginBoxBorder: "rgba(200,150,0,0.4)",
  paddingBoxBg: "rgba(100,180,255,0.12)",
  paddingBoxBorder: "rgba(50,120,200,0.35)",
  focusRing: "rgba(236,0,63,0.3)",
} as const;

// --- Shadows ---
export const SHADOWS = {
  sm: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  md: "0 4px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)",
  lg: "0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)",
} as const;

// --- Border Radius ---
export const RADII = {
  xs: "4px",
  sm: "6px",
  md: "10px",
  lg: "14px",
} as const;

// --- Transitions ---
export const TRANSITIONS = {
  fast: "100ms ease",      // color/opacity hover
  medium: "150ms ease",    // fade in/out panels
  settle: "200ms ease",    // move shadow on drop, panel entrance
} as const;

// --- Property panel palette (dark navy, per Figma node 115:322) ---
// Scoped to the property sidebar only — the rest of the overlay keeps COLORS.
export const PANEL = {
  bg: "#12121a",
  surface: "#1d222d",        // section header bars + input chips
  border: "#333950",         // input chip border
  text: "#d1cdcd",           // labels + values
  textDim: "#8b8b95",        // secondary / file path
  textGhost: "#333040",      // disabled value (e.g. unset "flex")
  accent: "#4d679e",         // var / bound-token blue
  btnBg: "#333950",          // active arrow/move button
  btnBorder: "#43506d",
  btnBgInactive: "#1d222d",  // disabled button
  focusRing: "rgba(77,103,158,0.4)",
} as const;

// --- Typography ---
// The whole overlay uses Google Sans Code (mono) for the code-tool aesthetic.
export const FONT_MONO =
  "'Google Sans Code', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export const FONT_FAMILY = FONT_MONO;

let panelFontInjected = false;
/** Injects the Google Sans Code stylesheet once (font-face is global, so it
 *  reaches the shadow DOM). Safe to call on every panel creation. */
export function ensurePanelFont(): void {
  if (panelFontInjected) return;
  panelFontInjected = true;
  try {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Google+Sans+Code:wght@400;500&display=swap";
    document.head.appendChild(link);
  } catch {
    // document.head unavailable — fall back to the monospace stack
  }
}

// --- Cursor SVG Generators ---

/** Color tool cursor: eyedropper */
export function colorCursorSvg(): string {
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='${COLORS.accent}' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M2 22l1-1h3l9-9'/><path d='M13 7l-1.3-1.3a1 1 0 0 0-1.4 0L9 7'/><path d='M16 10l1.3 1.3a1 1 0 0 1 0 1.4L16 14'/><path d='m9 7 6 6'/><path d='M20 2a2.83 2.83 0 0 1 0 4L16 10'/></svg>`)}") 2 22, pointer`;
}

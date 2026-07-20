// Flex-alignment icons from Lucide (ISC-licensed, lucide-static v1.17.0).
// Each entry is the inner markup of the icon; we wrap it in a stroke-styled
// <svg> at render time so it inherits the button's active/inactive color.
//
// The icon ORIENTATION follows flex-direction, like Chrome DevTools: in a row
// the main axis is horizontal (justify uses horizontal icons, align-items the
// cross/vertical ones); in a column the axes swap, so the icons rotate too.

type AlignProperty = "justify-content" | "align-items";
type Axis = "row" | "column";

// Raw inner markup, keyed by Lucide icon name.
const ICONS: Record<string, string> = {
  "align-horizontal-justify-start": `<rect width="6" height="14" x="6" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M2 2v20"/>`,
  "align-horizontal-justify-center": `<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M12 2v20"/>`,
  "align-horizontal-justify-end": `<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="12" y="7" rx="2"/><path d="M22 2v20"/>`,
  "align-horizontal-space-between": `<rect width="6" height="14" x="3" y="5" rx="2"/><rect width="6" height="10" x="15" y="7" rx="2"/><path d="M3 2v20"/><path d="M21 2v20"/>`,
  "align-horizontal-space-around": `<rect width="6" height="10" x="9" y="7" rx="2"/><path d="M4 22V2"/><path d="M20 22V2"/>`,
  "align-horizontal-distribute-center": `<rect width="6" height="14" x="4" y="5" rx="2"/><rect width="6" height="10" x="14" y="7" rx="2"/><path d="M17 22v-5"/><path d="M17 7V2"/><path d="M7 22v-3"/><path d="M7 5V2"/>`,
  "align-vertical-justify-start": `<rect width="14" height="6" x="5" y="16" rx="2"/><rect width="10" height="6" x="7" y="6" rx="2"/><path d="M2 2h20"/>`,
  "align-vertical-justify-center": `<rect width="14" height="6" x="5" y="16" rx="2"/><rect width="10" height="6" x="7" y="2" rx="2"/><path d="M2 12h20"/>`,
  "align-vertical-justify-end": `<rect width="14" height="6" x="5" y="12" rx="2"/><rect width="10" height="6" x="7" y="2" rx="2"/><path d="M2 22h20"/>`,
  "align-vertical-space-between": `<rect width="14" height="6" x="5" y="15" rx="2"/><rect width="10" height="6" x="7" y="3" rx="2"/><path d="M2 21h20"/><path d="M2 3h20"/>`,
  "align-vertical-space-around": `<rect width="10" height="6" x="7" y="9" rx="2"/><path d="M22 20H2"/><path d="M22 4H2"/>`,
  "align-vertical-distribute-center": `<path d="M22 17h-3"/><path d="M22 7h-5"/><path d="M5 17H2"/><path d="M7 7H2"/><rect x="5" y="14" width="14" height="6" rx="2"/><rect x="7" y="4" width="10" height="6" rx="2"/>`,
  "align-start-horizontal": `<rect width="6" height="16" x="4" y="6" rx="2"/><rect width="6" height="9" x="14" y="6" rx="2"/><path d="M22 2H2"/>`,
  "align-center-horizontal": `<path d="M2 12h20"/><path d="M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/><path d="M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/><path d="M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1"/><path d="M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1"/>`,
  "align-end-horizontal": `<rect width="6" height="16" x="4" y="2" rx="2"/><rect width="6" height="9" x="14" y="9" rx="2"/><path d="M22 22H2"/>`,
  "align-start-vertical": `<rect width="9" height="6" x="6" y="14" rx="2"/><rect width="16" height="6" x="6" y="4" rx="2"/><path d="M2 2v20"/>`,
  "align-center-vertical": `<path d="M12 2v20"/><path d="M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4"/><path d="M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4"/><path d="M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1"/><path d="M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1"/>`,
  "align-end-vertical": `<rect width="16" height="6" x="2" y="4" rx="2"/><rect width="9" height="6" x="9" y="14" rx="2"/><path d="M22 22V2"/>`,
  "stretch-horizontal": `<rect width="20" height="6" x="2" y="4" rx="2"/><rect width="20" height="6" x="2" y="14" rx="2"/>`,
  "stretch-vertical": `<rect width="6" height="20" x="4" y="2" rx="2"/><rect width="6" height="20" x="14" y="2" rx="2"/>`,
  baseline: `<path d="M4 20h16"/><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/>`,
};

// (property → axis → css-value → Lucide icon name).
// justify acts on the MAIN axis, align-items on the CROSS axis, so for the same
// flex-direction they pull from opposite orientations.
const MAP: Record<AlignProperty, Record<Axis, Record<string, string>>> = {
  "justify-content": {
    row: {
      "flex-start": "align-horizontal-justify-start",
      start: "align-horizontal-justify-start",
      normal: "align-horizontal-justify-start",
      center: "align-horizontal-justify-center",
      "flex-end": "align-horizontal-justify-end",
      end: "align-horizontal-justify-end",
      "space-between": "align-horizontal-space-between",
      "space-around": "align-horizontal-space-around",
      "space-evenly": "align-horizontal-distribute-center",
      stretch: "stretch-horizontal",
    },
    column: {
      "flex-start": "align-vertical-justify-start",
      start: "align-vertical-justify-start",
      normal: "align-vertical-justify-start",
      center: "align-vertical-justify-center",
      "flex-end": "align-vertical-justify-end",
      end: "align-vertical-justify-end",
      "space-between": "align-vertical-space-between",
      "space-around": "align-vertical-space-around",
      "space-evenly": "align-vertical-distribute-center",
      stretch: "stretch-vertical",
    },
  },
  "align-items": {
    // Row: cross axis is vertical → items align top/center/bottom.
    row: {
      "flex-start": "align-start-horizontal",
      start: "align-start-horizontal",
      normal: "align-start-horizontal",
      center: "align-center-horizontal",
      "flex-end": "align-end-horizontal",
      end: "align-end-horizontal",
      stretch: "stretch-vertical",
      baseline: "baseline",
    },
    // Column: cross axis is horizontal → items align left/center/right.
    column: {
      "flex-start": "align-start-vertical",
      start: "align-start-vertical",
      normal: "align-start-vertical",
      center: "align-center-vertical",
      "flex-end": "align-end-vertical",
      end: "align-end-vertical",
      stretch: "stretch-horizontal",
      baseline: "baseline",
    },
  },
};

function svg(inner: string): string {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Returns the SVG markup for a (property, css-value) pair, oriented for the
 *  given flex-direction (`row`/`row-reverse` → row, `column*` → column). */
export function alignIcon(
  property: string,
  value: string,
  flexDirection = "row"
): string {
  const axis: Axis = flexDirection.startsWith("column") ? "column" : "row";
  const name = MAP[property as AlignProperty]?.[axis]?.[value];
  const inner = name ? ICONS[name] : null;
  return svg(
    inner ?? `<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>`
  );
}

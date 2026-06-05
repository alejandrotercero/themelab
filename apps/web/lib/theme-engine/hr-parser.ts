// Parse a Hundred Rabbits theme SVG into its 9 named color slots.
// HR themes encode color as SVG element `id` → `fill` (background rect, f_*/b_*
// circles, optional tape_* descs). Drag-drop or paste both land here.

import { HR_SLOTS, type HrSlot, type HrTheme } from "./types";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parse an HR theme SVG string. Tolerant of missing slots and of the `0`
 * sentinel some themes use (e.g. `tape_style` fill='0'). Uses the browser
 * DOMParser, so call from client code only.
 */
export function parseHrSvg(svg: string): HrTheme {
  const slots: Partial<Record<HrSlot, string>> = {};
  const tape: Record<string, string> = {};
  let author: string | undefined;

  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Could not parse SVG — is this a Hundred Rabbits theme file?");
  }

  for (const el of Array.from(doc.querySelectorAll("[id]"))) {
    const id = el.getAttribute("id") ?? "";
    const fill = (el.getAttribute("fill") ?? "").trim();
    if (id.startsWith("tape_")) {
      if (HEX.test(fill)) tape[id] = normalizeHex(fill);
      continue;
    }
    if ((HR_SLOTS as readonly string[]).includes(id) && HEX.test(fill)) {
      slots[id as HrSlot] = normalizeHex(fill);
    }
  }

  // Author lives in an SVG comment: `<!-- Author: Aeriform -->`.
  const m = svg.match(/Author:\s*([^\n>-]+)/i);
  if (m) author = m[1].trim();

  if (Object.keys(slots).length === 0) {
    throw new Error("No Hundred Rabbits color slots found (expected ids like background, f_high, b_inv).");
  }

  return { slots, tape, author };
}

/** Expand `#abc` → `#aabbcc` and lowercase. */
function normalizeHex(hex: string): string {
  let h = hex.toLowerCase();
  if (h.length === 4) {
    h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h;
}

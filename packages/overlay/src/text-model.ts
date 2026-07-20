export function normalizeVisibleText(value: string): string {
  return value.replaceAll("\u00A0", " ");
}

// This function is specifically named "visible" text and intentionally prefers
// `innerText` (which respects rendering — CSS visibility/display, text-transform)
// over `textContent` (which returns raw, possibly-hidden text). Switching to
// textContent would defeat its purpose; textContent is only a fallback for
// environments where innerText isn't implemented (e.g. jsdom in tests).
export function getElementVisibleText(
  element: Pick<HTMLElement, "innerText" | "textContent">
): string {
  const raw =
    // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- see comment above
    typeof element.innerText === "string"
      ? // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- see comment above
        element.innerText
      : (element.textContent ?? "");
  return normalizeVisibleText(raw);
}

export function getRangeVisibleText(range: Pick<Range, "toString">): string {
  return normalizeVisibleText(range.toString());
}

// packages/overlay/src/utils/active-element.ts
//
// Focus detection that works through Shadow DOM. The overlay UI lives inside a
// shadow root (`#react-rewrite-root`), so `document.activeElement` reports the
// shadow *host*, not the input the user is actually typing in. Without this,
// every global shortcut (Delete, arrows, spacebar-pan) fires while the user is
// editing an overlay field.

/** Resolve the truly-focused element, descending through nested shadow roots. */
export function getDeepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

/** A text-bearing input the user can type into (text/number/search/email/url/tel/password). */
export function isTextInput(el: Element | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  const t = el.type;
  return (
    t === "text" || t === "number" || t === "search" || t === "email" ||
    t === "url" || t === "tel" || t === "password"
  );
}

/** True when the focused element captures text/navigation keys (input, textarea,
 *  or contentEditable) — on the page or inside the overlay's shadow DOM. */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/** True when focus is in an editable field anywhere (resolves through shadow DOM). */
export function isEditableFocused(): boolean {
  return isEditableElement(getDeepActiveElement());
}

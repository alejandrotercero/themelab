// Scoped CSS-variable injection for the live preview: write theme tokens onto a
// single element's inline style (and toggle a local `.dark` class) so only that
// subtree re-themes — the editor chrome around it is untouched.
//
// Adapted from tweakcn (https://github.com/jnsahaj/tweakcn), Apache-2.0 —
// utils/apply-style-to-element.ts. See apps/web/NOTICE.

export function applyVars(
  el: HTMLElement,
  vars: Record<string, string>,
  opts: { dark: boolean; radius?: string },
): void {
  for (const [name, value] of Object.entries(vars)) {
    el.style.setProperty(`--${name}`, value);
  }
  if (opts.radius != null) el.style.setProperty("--radius", opts.radius);
  el.classList.toggle("dark", opts.dark);
}

/** Remove every token this tool may have set from an element's inline style. */
export function clearVars(el: HTMLElement, tokens: readonly string[]): void {
  for (const token of tokens) el.style.removeProperty(`--${token}`);
  el.style.removeProperty("--radius");
  el.classList.remove("dark");
}

/** The overlay-skin variables, so "apply to page" can re-skin the chrome too. */
export const OV_SKIN_KEYS = [
  "ov-bg", "ov-surface", "ov-surface-2", "ov-border", "ov-border-strong",
  "ov-text", "ov-text-dim", "ov-text-ghost", "ov-accent", "ov-accent-hover",
  "ov-accent-soft", "ov-danger", "ov-danger-soft",
] as const;

/** Derive overlay-skin values from a themed token map (for "apply to page"), so
 *  the whole tool — chrome included — adopts the generated theme. */
export function ovSkinVars(v: Record<string, string>): Record<string, string> {
  const pick = (...keys: string[]) => keys.map((k) => v[k]).find(Boolean) ?? "";
  return {
    "ov-bg": pick("background"),
    "ov-surface": pick("card", "background"),
    "ov-surface-2": pick("secondary", "muted", "card"),
    "ov-border": pick("border"),
    "ov-border-strong": pick("border"),
    "ov-text": pick("foreground"),
    "ov-text-dim": pick("muted-foreground", "foreground"),
    "ov-text-ghost": pick("muted-foreground", "foreground"),
    "ov-accent": pick("primary"),
    "ov-accent-hover": pick("primary"),
    "ov-accent-soft": pick("accent", "secondary"),
    "ov-danger": pick("destructive"),
    "ov-danger-soft": pick("destructive"),
  };
}

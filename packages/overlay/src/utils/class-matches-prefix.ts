/**
 * Check if a Tailwind class matches a given prefix.
 * Handles standalone classes (flex, hidden, relative), prefixed classes
 * (bg-red-500), and skips variant-prefixed classes (hover:bg-blue-700).
 *
 * Duplicated from transform.ts — kept in sync manually.
 */
export function classMatchesPrefix(cls: string, prefix: string): boolean {
  // Skip variant-prefixed classes (e.g. hover:bg-blue-700, dark:bg-gray-900)
  if (cls.includes(":")) return false;
  // Exact match for standalone classes like "rounded"
  if (cls === prefix) return true;
  // prefix- followed by something
  return cls.startsWith(`${prefix}-`);
}

/** Tailwind's default responsive breakpoints, largest first, with min-widths (px). */
const BREAKPOINTS: ReadonlyArray<readonly [string, number]> = [
  ["2xl", 1536],
  ["xl", 1280],
  ["lg", 1024],
  ["md", 768],
  ["sm", 640],
];

const BREAKPOINT_WIDTHS = new Map<string, number>(BREAKPOINTS);

/**
 * Split a class into its responsive breakpoint variant and the bare utility.
 * - `md:mb-6` → { variant: "md", bare: "mb-6" }
 * - `mb-6`    → { variant: "",   bare: "mb-6" }
 * - `hover:bg-x`, `dark:md:p-2` → { variant: null } (non-responsive / stacked — not viewport-editable)
 */
export function splitResponsiveVariant(cls: string): { variant: string | null; bare: string } {
  const colon = cls.indexOf(":");
  if (colon === -1) return { variant: "", bare: cls };
  const prefix = cls.slice(0, colon);
  const rest = cls.slice(colon + 1);
  // Only a single, purely-responsive prefix is viewport-editable.
  if (BREAKPOINT_WIDTHS.has(prefix) && !rest.includes(":")) {
    return { variant: prefix, bare: rest };
  }
  return { variant: null, bare: cls };
}

/**
 * Given an element's classes and a predicate that matches the bare utility for a
 * property (prefix or classPattern), return the responsive variant that *wins*
 * at `viewportWidth` — i.e. the largest breakpoint ≤ width among the classes the
 * element actually declares for that property. Returns "" (base) when only the
 * base class applies or none match. This is what makes an edit target `md:mb-6`
 * instead of the overridden base `mb-0`.
 */
export function pickWinningVariant(
  classes: string[],
  matchesBare: (bare: string) => boolean,
  viewportWidth: number,
): string {
  let bestVariant = "";
  let bestWidth = -1;
  for (const cls of classes) {
    const { variant, bare } = splitResponsiveVariant(cls);
    if (variant === null) continue; // state/stacked variant — not viewport-editable
    if (!matchesBare(bare)) continue;
    const minWidth = variant === "" ? 0 : (BREAKPOINT_WIDTHS.get(variant) ?? Infinity);
    if (minWidth <= viewportWidth && minWidth > bestWidth) {
      bestWidth = minWidth;
      bestVariant = variant;
    }
  }
  return bestVariant;
}

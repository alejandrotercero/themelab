/**
 * Check if a Tailwind class matches a given prefix.
 * Handles standalone classes (flex, hidden, relative), prefixed classes
 * (bg-red-500), and skips variant-prefixed classes (hover:bg-blue-700).
 *
 * Duplicated from transform.ts — kept in sync manually.
 */
export function classMatchesPrefix(cls: string, prefix: string): boolean {
  // Skip variant-prefixed classes (e.g. hover:bg-blue-700, dark:bg-gray-900)
  if (cls.includes(":")) {
    return false;
  }
  // Exact match for standalone classes like "rounded"
  if (cls === prefix) {
    return true;
  }
  // prefix- followed by something
  return cls.startsWith(`${prefix}-`);
}

/** Tailwind's default responsive breakpoints, largest first, with min-widths (px). */
const BREAKPOINTS: readonly (readonly [string, number])[] = [
  ["2xl", 1536],
  ["xl", 1280],
  ["lg", 1024],
  ["md", 768],
  ["sm", 640],
];

let BREAKPOINT_WIDTHS = new Map<string, number>(BREAKPOINTS);

/**
 * Split a class into its responsive breakpoint variant and the bare utility.
 * - `md:mb-6` → { variant: "md", bare: "mb-6" }
 * - `mb-6`    → { variant: "",   bare: "mb-6" }
 * - `hover:bg-x`, `dark:md:p-2` → { variant: null } (non-responsive / stacked — not viewport-editable)
 */
export function splitResponsiveVariant(cls: string): {
  variant: string | null;
  bare: string;
} {
  const colon = cls.indexOf(":");
  if (colon === -1) {
    return { variant: "", bare: cls };
  }
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
  viewportWidth: number
): string {
  let bestVariant = "";
  let bestWidth = -1;
  for (const cls of classes) {
    const { variant, bare } = splitResponsiveVariant(cls);
    if (variant === null) {
      continue;
    } // state/stacked variant — not viewport-editable
    if (!matchesBare(bare)) {
      continue;
    }
    const minWidth =
      variant === "" ? 0 : (BREAKPOINT_WIDTHS.get(variant) ?? Infinity);
    if (minWidth <= viewportWidth && minWidth > bestWidth) {
      bestWidth = minWidth;
      bestVariant = variant;
    }
  }
  return bestVariant;
}

// ── Order-independent variant set matching (mirrors packages/cli/src/transform.ts) ─

/**
 * Allow the CLI to override the hardcoded breakpoints with the project's actual
 * `screens`. Called from variant-target.ts when metadata arrives. Values are
 * already pixel min-widths.
 */
export function setProjectScreens(
  screens: { name: string; minWidth: number }[]
): void {
  BREAKPOINT_WIDTHS = new Map(screens.map((s) => [s.name, s.minWidth]));
}

/**
 * Split a class into variant tokens + bare utility, ignoring `:` inside
 * arbitrary values (`bg-[url(http://x)]`). The last colon-segment is the utility.
 *   "dark:md:bg-red-500" → { variants: ["dark","md"], utility: "bg-red-500" }
 *   "bg-[url(http://x)]"  → { variants: [],            utility: "bg-[url(http://x)]" }
 */
export function decomposeClass(cls: string): {
  variants: string[];
  utility: string;
} {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i += 1) {
    const ch = cls[i];
    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (ch === ":" && depth === 0) {
      segments.push(cls.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(cls.slice(start));
  const utility = segments.pop() ?? "";
  return { variants: segments, utility };
}

function sameVariantSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setB = new Set(b);
  return a.every((t) => setB.has(t));
}

/**
 * Find the declared class for a specific variant-token set + bare-utility predicate.
 * Order-independent: `dark:md:bg-x` matches variant tokens ["md","dark"].
 * Returns the full matching class string, or "" if none is declared.
 *
 * Used to read the *displayed* value for the active target (e.g. show the
 * `dark:bg-*` value while Dark is active), even when off-viewport.
 */
export function findClassForVariant(
  classes: string[],
  matchesBare: (bare: string) => boolean,
  variantTokens: string[]
): string {
  for (const cls of classes) {
    const { variants, utility } = decomposeClass(cls);
    if (!sameVariantSet(variants, variantTokens)) {
      continue;
    }
    if (matchesBare(utility)) {
      return cls;
    }
  }
  return "";
}

/**
 * Count distinct responsive breakpoints the element declares classes for, across
 * all its utilities. Used to decide whether to surface "Optimize for mobile"
 * (only meaningful when ≥2 breakpoints are present).
 */
export function countDistinctBreakpoints(classes: string[]): number {
  const found = new Set<string>();
  for (const cls of classes) {
    const { variants } = decomposeClass(cls);
    for (const v of variants) {
      if (BREAKPOINT_WIDTHS.has(v)) {
        found.add(v);
      }
    }
  }
  return found.size;
}

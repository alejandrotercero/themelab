import type { TailwindTokenMap } from "@themelab/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergedTokenMap {
  spacing: Map<string, string>;
  colors: Map<string, string>;
  fontSize: Map<string, string>;
  fontWeight: Map<string, string>;
  borderRadius: Map<string, string>;
  borderWidth: Map<string, string>;
  opacity: Map<string, string>;
  letterSpacing: Map<string, string>;
  lineHeight: Map<string, string>;
  spacingReverse: Map<string, string>;
  colorsReverse: Map<string, string>;
  fontSizeReverse: Map<string, string>;
  fontWeightReverse: Map<string, string>;
  borderRadiusReverse: Map<string, string>;
  borderWidthReverse: Map<string, string>;
  opacityReverse: Map<string, string>;
  letterSpacingReverse: Map<string, string>;
  lineHeightReverse: Map<string, string>;
}

export interface SnapPoint {
  numericValue: number;
  token: string | null;
  cssValue: string;
}

// ---------------------------------------------------------------------------
// Color normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes any CSS color value to a hex string using the canvas 2D context.
 * This ensures that values like `oklch(0.7 0.15 230)` are converted to the
 * same hex representation that `getComputedStyle` returns for elements, making
 * reverse-map lookups work regardless of the original color format.
 */
function normalizeColorToHex(cssValue: string): string {
  const v = cssValue.trim().toLowerCase();
  if (v === "transparent") {
    return "transparent";
  }
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) {
    return v;
  }
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) {
    return cssValue; // fallback to original
  }
  ctx.fillStyle = "#000000";
  ctx.fillStyle = v;
  const result = ctx.fillStyle;
  if (result.startsWith("#")) {
    return result;
  }
  const m = result.match(/rgba?\((?<r>\d+),\s*(?<g>\d+),\s*(?<b>\d+)/);
  if (m?.groups) {
    const r = Math.trunc(Number(m.groups.r));
    const g = Math.trunc(Number(m.groups.g));
    const b = Math.trunc(Number(m.groups.b));
    // oxlint-disable-next-line no-bitwise -- intentional bit-packing of RGB channels into a hex string
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
  return cssValue; // fallback to original
}

// ---------------------------------------------------------------------------
// CSS custom property reading
// ---------------------------------------------------------------------------

function addToken(
  record: Record<string, string>,
  reverseRecord: Record<string, string>,
  token: string,
  value: string
): void {
  record[token] = value;
  reverseRecord[value] = token;
}

/** Extract the named `token` capture from a `--prefix-{token}` property match. */
function matchTokenName(prop: string, re: RegExp): string | null {
  return re.exec(prop)?.groups?.token ?? null;
}

/**
 * Reads Tailwind-shaped CSS custom properties from the document root and
 * returns a partial TailwindTokenMap-like Record structure.
 *
 * Guards against environments where `document` is not available (e.g. tests).
 */
export function readCSSCustomProperties(): Partial<TailwindTokenMap> {
  if (typeof document === "undefined") {
    return {};
  }

  const style = getComputedStyle(document.documentElement);
  const propertyNames = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules];
      } catch {
        return [];
      }
    })
    .filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText === ":root"
    )
    .flatMap((rule) => [...rule.style])
    .filter((prop) => prop.startsWith("--"));

  const spacing: Record<string, string> = {};
  const colors: Record<string, string> = {};
  const fontSize: Record<string, string> = {};
  const fontWeight: Record<string, string> = {};
  const borderRadius: Record<string, string> = {};
  const borderWidth: Record<string, string> = {};
  const opacity: Record<string, string> = {};
  const letterSpacing: Record<string, string> = {};
  const lineHeight: Record<string, string> = {};

  const spacingReverse: Record<string, string> = {};
  const colorsReverse: Record<string, string> = {};
  const fontSizeReverse: Record<string, string> = {};
  const fontWeightReverse: Record<string, string> = {};
  const borderRadiusReverse: Record<string, string> = {};
  const borderWidthReverse: Record<string, string> = {};
  const opacityReverse: Record<string, string> = {};
  const letterSpacingReverse: Record<string, string> = {};
  const lineHeightReverse: Record<string, string> = {};

  for (const prop of propertyNames) {
    const value = style.getPropertyValue(prop).trim();
    if (!value) {
      continue;
    }

    // --spacing-{token}
    const spacingToken = matchTokenName(prop, /^--spacing-(?<token>.+)$/);
    if (spacingToken !== null) {
      addToken(spacing, spacingReverse, spacingToken, value);
      continue;
    }

    // --color-{token}
    const colorToken = matchTokenName(prop, /^--color-(?<token>.+)$/);
    if (colorToken !== null) {
      colors[colorToken] = value;
      colorsReverse[normalizeColorToHex(value)] = colorToken;
      continue;
    }

    // --font-size-{token}
    const fontSizeToken = matchTokenName(prop, /^--font-size-(?<token>.+)$/);
    if (fontSizeToken !== null) {
      addToken(fontSize, fontSizeReverse, fontSizeToken, value);
      continue;
    }

    // --font-weight-{token}
    const fontWeightToken = matchTokenName(
      prop,
      /^--font-weight-(?<token>.+)$/
    );
    if (fontWeightToken !== null) {
      addToken(fontWeight, fontWeightReverse, fontWeightToken, value);
      continue;
    }

    // --radius-{token}
    const radiusToken = matchTokenName(prop, /^--radius-(?<token>.+)$/);
    if (radiusToken !== null) {
      addToken(borderRadius, borderRadiusReverse, radiusToken, value);
      continue;
    }

    // --border-{token} (excluding --border-* that map to other scales)
    const borderToken = matchTokenName(prop, /^--border-(?<token>.+)$/);
    if (borderToken !== null) {
      addToken(borderWidth, borderWidthReverse, borderToken, value);
      continue;
    }

    // --opacity-{token}
    const opacityToken = matchTokenName(prop, /^--opacity-(?<token>.+)$/);
    if (opacityToken !== null) {
      addToken(opacity, opacityReverse, opacityToken, value);
      continue;
    }

    // --tracking-{token}
    const trackingToken = matchTokenName(prop, /^--tracking-(?<token>.+)$/);
    if (trackingToken !== null) {
      addToken(letterSpacing, letterSpacingReverse, trackingToken, value);
      continue;
    }

    // --leading-{token}
    const leadingToken = matchTokenName(prop, /^--leading-(?<token>.+)$/);
    if (leadingToken !== null) {
      addToken(lineHeight, lineHeightReverse, leadingToken, value);
      continue;
    }
  }

  return {
    spacing,
    colors,
    fontSize,
    fontWeight,
    borderRadius,
    borderWidth,
    opacity,
    letterSpacing,
    lineHeight,
    spacingReverse,
    colorsReverse,
    fontSizeReverse,
    fontWeightReverse,
    borderRadiusReverse,
    borderWidthReverse,
    opacityReverse,
    letterSpacingReverse,
    lineHeightReverse,
  };
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

const SCALE_KEYS = [
  "spacing",
  "colors",
  "fontSize",
  "fontWeight",
  "borderRadius",
  "borderWidth",
  "opacity",
  "letterSpacing",
  "lineHeight",
  "spacingReverse",
  "colorsReverse",
  "fontSizeReverse",
  "fontWeightReverse",
  "borderRadiusReverse",
  "borderWidthReverse",
  "opacityReverse",
  "letterSpacingReverse",
  "lineHeightReverse",
] as const;

/**
 * Merges browser-read tokens and CLI-supplied tokens into a Map-based
 * structure. CLI values win on conflict.
 */
export function mergeTokenMaps(
  browserTokens: Partial<TailwindTokenMap>,
  cliTokens: Partial<TailwindTokenMap>
): MergedTokenMap {
  const result = {} as MergedTokenMap;

  for (const key of SCALE_KEYS) {
    const browserRecord = browserTokens[key] ?? {};
    const cliRecord = cliTokens[key] ?? {};
    // CLI entries are spread last so they override browser entries
    result[key] = new Map([
      ...Object.entries(browserRecord),
      ...Object.entries(cliRecord),
    ]) as Map<string, string>;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Token lookup
// ---------------------------------------------------------------------------

/**
 * Looks up a CSS value in a reverse Map.
 * Returns the token name (e.g. "4") or null if not found.
 */
export function resolveTokenForValue(
  cssValue: string,
  reverseMap: Map<string, string>
): string | null {
  return reverseMap.get(cssValue) ?? null;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let cliTokens: TailwindTokenMap | null = null;
let mergedMap: MergedTokenMap | null = null;

/**
 * Store CLI-supplied tokens. Invalidates the cached merged map so it will be
 * recomputed on next access.
 */
export function setCliTokens(tokens: TailwindTokenMap): void {
  cliTokens = tokens;
  mergedMap = null;
}

/**
 * Returns the merged token map, computing it lazily if needed.
 */
export function getTokenMap(): MergedTokenMap {
  if (mergedMap !== null) {
    return mergedMap;
  }

  const browserTokens = readCSSCustomProperties();
  mergedMap = mergeTokenMaps(browserTokens, cliTokens ?? {});
  return mergedMap;
}

// ---------------------------------------------------------------------------
// Snap points
// ---------------------------------------------------------------------------

/**
 * Returns sorted snap points from a scale Map. The current arbitrary value is
 * included if it is not already present in the scale.
 */
export function getSnapPoints(
  scaleName: keyof MergedTokenMap,
  currentValue: string,
  tokenMap?: MergedTokenMap
): SnapPoint[] {
  const map = tokenMap ?? getTokenMap();
  const scale = map[scaleName];

  const points: SnapPoint[] = [];

  for (const [token, cssValue] of scale.entries()) {
    const num = Number(cssValue);
    if (!Number.isNaN(num)) {
      points.push({ numericValue: num, token, cssValue });
    }
  }

  // If the currentValue is not already represented in the scale, add it as a
  // token-less arbitrary snap point.
  const currentNum = Number(currentValue);
  if (!Number.isNaN(currentNum)) {
    const alreadyPresent = points.some((p) => p.cssValue === currentValue);
    if (!alreadyPresent) {
      points.push({
        numericValue: currentNum,
        token: null,
        cssValue: currentValue,
      });
    }
  }

  points.sort((a, b) => a.numericValue - b.numericValue);

  return points;
}

/**
 * Returns custom/overridden project colors from the CLI-supplied Tailwind config.
 * Filters to colors with non-standard token names (not part of Tailwind's default palette).
 * Returns array of { token, hex } suitable for color picker swatches.
 */
export function getProjectColors(): { token: string; hex: string }[] {
  if (!cliTokens?.colors) {
    return [];
  }

  const colors: { token: string; hex: string }[] = [];
  for (const [token, hex] of Object.entries(cliTokens.colors)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
      continue;
    }
    // Standard Tailwind tokens match pattern: colorFamily-shade (e.g., "blue-500")
    // Custom tokens often don't (e.g., "brand", "primary", "accent-foreground")
    const isStandardPattern =
      /^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/.test(
        token
      );
    if (
      !isStandardPattern &&
      token !== "white" &&
      token !== "black" &&
      token !== "transparent"
    ) {
      colors.push({ token, hex });
    }
  }
  return colors;
}

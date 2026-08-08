// Public surface of the HR → shadcn theme engine.

export * from "./types"
export { parseHrSvg } from "./hr-parser"
export { analyze, MIN_UNIQUE_LEVELS, MIN_RANGE } from "./validate"
export {
  hrToThemeStyles,
  paletteToThemeStyles,
  paletteToScales,
  mindfulToThemeStyles,
  analyzeMindful,
  THEME_TOKENS,
  type MindfulColors,
  type MindfulReport,
  type MindfulMeasure,
} from "./transpile"
export { MINDFUL_PRESETS, type MindfulPreset } from "./mindful-presets"
export {
  themeStylesToCss,
  themeToJson,
  themeStylesToJson,
  type CssOptions,
} from "./css"
export { PRESETS, type Preset } from "./presets"
export {
  lStar,
  toOklch,
  oklchCss,
  oklchToHex,
  reformat,
  contrastRatio,
  COLOR_FORMATS,
  type ColorFormat,
} from "./oklch"
export {
  buildScale,
  scaleToCss,
  scalesToThemeStyles,
  TAILWIND_STOPS,
  type Scale,
  type ScaleStop,
} from "./scale"
export {
  radixThemeStyles,
  radixScales,
  type RadixInputs,
  type RadixModeColors,
  type Appearance,
} from "./radix"
export { scalesToFigmaSvg, type FigmaSvgOptions } from "./figma"
export {
  themeStylesToDesignMd,
  sanitizeThemeName,
  sanitizeThemeDescription,
  type DesignMdOptions,
} from "./design-md"

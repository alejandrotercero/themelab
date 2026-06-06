// Public surface of the HR → shadcn theme engine.

export * from "./types";
export { parseHrSvg } from "./hr-parser";
export { analyze, MIN_UNIQUE_LEVELS, MIN_RANGE } from "./validate";
export { hrToThemeStyles, paletteToThemeStyles, paletteToScales, THEME_TOKENS } from "./transpile";
export { themeStylesToCss, themeToJson, themeStylesToJson, type CssOptions } from "./css";
export { PRESETS, type Preset } from "./presets";
export { lStar, toOklch, oklchCss, oklchToHex, reformat, COLOR_FORMATS, type ColorFormat } from "./oklch";
export { buildScale, scaleToCss, scalesToThemeStyles, TAILWIND_STOPS, type Scale, type ScaleStop } from "./scale";
export { radixThemeStyles, radixScales, type RadixInputs, type RadixModeColors, type Appearance } from "./radix";

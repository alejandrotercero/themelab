import { describe, expect, it } from "vitest";
import {
  TAILWIND_STOPS,
  buildScale,
  scalesToThemeStyles,
  scaleToCss,
} from "../scale.js";
import { toOklch } from "../oklch.js";

describe("buildScale", () => {
  it("returns 11 stops matching TAILWIND_STOPS", () => {
    const scale = buildScale("#3b82f6");
    expect(scale).toHaveLength(11);
    const stops = scale.map((s) => s.stop);
    expect(stops).toEqual([...TAILWIND_STOPS]);
  });

  it("each value is an oklch(...) string", () => {
    const scale = buildScale("#3b82f6");
    for (const { value } of scale) {
      expect(value).toMatch(/^oklch\(/);
    }
  });

  it("neutral scale has lower chroma at stop 500 than chromatic scale of same anchor", () => {
    const anchor = "#3b82f6";
    const chromatic = buildScale(anchor);
    const neutral = buildScale(anchor, { neutral: true });

    const chromatic500 = chromatic.find((s) => s.stop === 500)!;
    const neutral500 = neutral.find((s) => s.stop === 500)!;

    const chromaticOklch = toOklch(chromatic500.value)!;
    const neutralOklch = toOklch(neutral500.value)!;

    expect(neutralOklch.c).toBeLessThan(chromaticOklch.c);
  });

  it("neutral scale clamps chroma to ≤ 0.02 at stop 500", () => {
    const neutral = buildScale("#3b82f6", { neutral: true });
    const stop500 = neutral.find((s) => s.stop === 500)!;
    const oklch = toOklch(stop500.value)!;
    // neutral: peak = min(c, 0.02); at 500 CHROMA_CURVE is 1.0 → c ≤ 0.02
    expect(oklch.c).toBeLessThanOrEqual(0.02);
  });
});

describe("scalesToThemeStyles", () => {
  const primary = buildScale("#3b82f6");
  const neutral = buildScale("#71717a", { neutral: true });
  const theme = scalesToThemeStyles(primary, neutral);

  it("has light and dark objects", () => {
    expect(theme.light).toBeDefined();
    expect(theme.dark).toBeDefined();
  });

  it("light.primary === primary[600].value", () => {
    const primary600 = primary.find((s) => s.stop === 600)!;
    expect(theme.light.primary).toBe(primary600.value);
  });

  it("dark.primary === primary[500].value", () => {
    const primary500 = primary.find((s) => s.stop === 500)!;
    expect(theme.dark.primary).toBe(primary500.value);
  });

  it("light.background === neutral[50].value", () => {
    const neutral50 = neutral.find((s) => s.stop === 50)!;
    expect(theme.light.background).toBe(neutral50.value);
  });

  it("dark.background === neutral[950].value", () => {
    const neutral950 = neutral.find((s) => s.stop === 950)!;
    expect(theme.dark.background).toBe(neutral950.value);
  });

  it("light.destructive === hardcoded red", () => {
    expect(theme.light.destructive).toBe("oklch(0.577 0.245 27.325)");
  });

  it("dark.destructive === hardcoded red", () => {
    expect(theme.dark.destructive).toBe("oklch(0.704 0.191 22.216)");
  });

  it("light has all 31 expected shadcn token keys", () => {
    const expectedKeys = [
      "background", "foreground",
      "card", "card-foreground",
      "popover", "popover-foreground",
      "primary", "primary-foreground",
      "secondary", "secondary-foreground",
      "muted", "muted-foreground",
      "accent", "accent-foreground",
      "destructive", "destructive-foreground",
      "border", "input", "ring",
      "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
      "sidebar", "sidebar-foreground",
      "sidebar-primary", "sidebar-primary-foreground",
      "sidebar-accent", "sidebar-accent-foreground",
      "sidebar-border", "sidebar-ring",
    ];
    for (const key of expectedKeys) {
      expect(theme.light).toHaveProperty(key);
    }
  });

  it("dark has all 31 expected shadcn token keys", () => {
    const expectedKeys = [
      "background", "foreground",
      "card", "card-foreground",
      "popover", "popover-foreground",
      "primary", "primary-foreground",
      "secondary", "secondary-foreground",
      "muted", "muted-foreground",
      "accent", "accent-foreground",
      "destructive", "destructive-foreground",
      "border", "input", "ring",
      "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
      "sidebar", "sidebar-foreground",
      "sidebar-primary", "sidebar-primary-foreground",
      "sidebar-accent", "sidebar-accent-foreground",
      "sidebar-border", "sidebar-ring",
    ];
    for (const key of expectedKeys) {
      expect(theme.dark).toHaveProperty(key);
    }
  });
});

describe("scaleToCss", () => {
  it("opens with @theme {", () => {
    const css = scaleToCss({ brand: buildScale("#3b82f6") });
    expect(css).toMatch(/^@theme \{/);
  });

  it("contains --color-brand-500:", () => {
    const css = scaleToCss({ brand: buildScale("#3b82f6") });
    expect(css).toContain("--color-brand-500:");
  });

  it("contains all 11 stops for the scale", () => {
    const css = scaleToCss({ brand: buildScale("#3b82f6") });
    for (const stop of TAILWIND_STOPS) {
      expect(css).toContain(`--color-brand-${stop}:`);
    }
  });
});

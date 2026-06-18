import { describe, expect, it } from "vitest";
import {
  hrToThemeStyles,
  paletteToThemeStyles,
  paletteToScales,
  THEME_TOKENS,
} from "../transpile.js";
import { toOklch } from "../oklch.js";
import type { HrTheme } from "../types.js";

// Real preset fixture from presets.ts — "Ablaze"
const ablazeTheme: HrTheme = {
  slots: {
    background: "#111111",
    f_high: "#ffffff",
    f_med: "#aaaaaa",
    f_low: "#555555",
    f_inv: "#000000",
    b_high: "#fc533e",
    b_med: "#666666",
    b_low: "#333333",
    b_inv: "#fc533e",
  },
  tape: {},
};

function allValuesParse(map: Record<string, string>): boolean {
  return Object.values(map).every((v) => toOklch(v) !== null);
}

describe("hrToThemeStyles — smoke test", () => {
  const result = hrToThemeStyles(ablazeTheme);

  it("returns non-empty light map", () => {
    expect(Object.keys(result.light).length).toBeGreaterThan(0);
  });

  it("returns non-empty dark map", () => {
    expect(Object.keys(result.dark).length).toBeGreaterThan(0);
  });

  it("all light values parse as oklch (toOklch !== null)", () => {
    expect(allValuesParse(result.light)).toBe(true);
  });

  it("all dark values parse as oklch (toOklch !== null)", () => {
    expect(allValuesParse(result.dark)).toBe(true);
  });

  it("contains all THEME_TOKENS keys in light", () => {
    for (const token of THEME_TOKENS) {
      expect(result.light).toHaveProperty(token);
    }
  });

  it("contains all THEME_TOKENS keys in dark", () => {
    for (const token of THEME_TOKENS) {
      expect(result.dark).toHaveProperty(token);
    }
  });
});

describe("paletteToThemeStyles — smoke test", () => {
  const result = paletteToThemeStyles("#3b82f6", "#71717a");

  it("returns non-empty light map", () => {
    expect(Object.keys(result.light).length).toBeGreaterThan(0);
  });

  it("returns non-empty dark map", () => {
    expect(Object.keys(result.dark).length).toBeGreaterThan(0);
  });

  it("all light values parse as oklch", () => {
    expect(allValuesParse(result.light)).toBe(true);
  });

  it("all dark values parse as oklch", () => {
    expect(allValuesParse(result.dark)).toBe(true);
  });

  it("contains all THEME_TOKENS keys in light", () => {
    for (const token of THEME_TOKENS) {
      expect(result.light).toHaveProperty(token);
    }
  });

  it("contains all THEME_TOKENS keys in dark", () => {
    for (const token of THEME_TOKENS) {
      expect(result.dark).toHaveProperty(token);
    }
  });
});

describe("paletteToScales — smoke test", () => {
  const { primary, neutral } = paletteToScales("#3b82f6", "#71717a");

  it("primary scale has 11 stops", () => {
    expect(primary).toHaveLength(11);
  });

  it("neutral scale has 11 stops", () => {
    expect(neutral).toHaveLength(11);
  });

  it("all primary values parse as oklch", () => {
    for (const { value } of primary) {
      expect(toOklch(value)).not.toBeNull();
    }
  });

  it("all neutral values parse as oklch", () => {
    for (const { value } of neutral) {
      expect(toOklch(value)).not.toBeNull();
    }
  });
});

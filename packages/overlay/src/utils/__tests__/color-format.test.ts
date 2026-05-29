import { describe, it, expect } from "vitest";
import {
  detectColorKind,
  isColor,
  toRenderableCss,
  toHex,
  serializeToKind,
} from "../color-format.js";

describe("detectColorKind", () => {
  it("detects shadcn HSL channel triples", () => {
    expect(detectColorKind("24 100% 98.04%")).toBe("hsl-triple");
    expect(detectColorKind("11.63 100% 68.63%")).toBe("hsl-triple");
  });
  it("detects RGB channel triples", () => {
    expect(detectColorKind("64 128 192")).toBe("rgb-triple");
  });
  it("detects functional + hex formats", () => {
    expect(detectColorKind("oklch(0.67 0.16 244)")).toBe("oklch");
    expect(detectColorKind("hsl(24 100% 98%)")).toBe("hsl");
    expect(detectColorKind("rgba(1 2 3 / 0.5)")).toBe("rgba");
    expect(detectColorKind("#abcdef")).toBe("hex");
  });
  it("rejects non-colors", () => {
    expect(detectColorKind("0.625rem")).toBeNull();
    expect(isColor("Inter, sans-serif")).toBe(false);
  });
});

describe("toRenderableCss", () => {
  it("wraps channel triples into valid CSS", () => {
    expect(toRenderableCss("24 100% 98.04%")).toBe("hsl(24 100% 98.04%)");
    expect(toRenderableCss("64 128 192")).toBe("rgb(64 128 192)");
  });
  it("passes functional/hex through unchanged", () => {
    expect(toRenderableCss("oklch(0.67 0.16 244)")).toBe("oklch(0.67 0.16 244)");
    expect(toRenderableCss("#fff")).toBe("#fff");
  });
});

describe("toHex", () => {
  it("normalizes any format to hex", () => {
    expect(toHex("0 0% 100%")).toBe("#ffffff");      // hsl triple white
    expect(toHex("0 0% 0%")).toBe("#000000");         // hsl triple black
    expect(toHex("255 0 0")).toBe("#ff0000");         // rgb triple red
    expect(toHex("#3b82f6")).toBe("#3b82f6");
  });
});

describe("serializeToKind round-trips (format preservation)", () => {
  it("keeps an hsl-triple theme as a triple", () => {
    const out = serializeToKind("#ffffff", "hsl-triple");
    expect(out).toBe("0 0% 100%");
    expect(detectColorKind(out)).toBe("hsl-triple");
  });

  it("keeps an rgb-triple theme as a triple", () => {
    expect(serializeToKind("#ff0000", "rgb-triple")).toBe("255 0 0");
  });

  it("keeps an oklch theme as oklch", () => {
    const out = serializeToKind("#ff0000", "oklch");
    expect(out.startsWith("oklch(")).toBe(true);
    expect(detectColorKind(out)).toBe("oklch");
  });

  it("keeps hsl()/rgb() functional formats", () => {
    expect(serializeToKind("#ffffff", "hsl")).toBe("hsl(0 0% 100%)");
    expect(serializeToKind("#ff0000", "rgb")).toBe("rgb(255 0 0)");
  });

  it("round-trips a triple → hex → triple stably", () => {
    const original = "11.63 100% 68.63%";
    const hex = toHex(original)!;
    const back = serializeToKind(hex, "hsl-triple");
    // Re-hex of the round-tripped value should match the original's hex.
    expect(toHex(back)).toBe(hex);
  });
});

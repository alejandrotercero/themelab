import { describe, it, expect } from "vitest";
import {
  classMatchesPrefix,
  splitResponsiveVariant,
  pickWinningVariant,
} from "../class-matches-prefix.js";

describe("splitResponsiveVariant", () => {
  it("returns base variant for unprefixed classes", () => {
    expect(splitResponsiveVariant("mb-6")).toEqual({ variant: "", bare: "mb-6" });
  });

  it("extracts responsive breakpoint variants", () => {
    expect(splitResponsiveVariant("md:mb-6")).toEqual({ variant: "md", bare: "mb-6" });
    expect(splitResponsiveVariant("2xl:p-8")).toEqual({ variant: "2xl", bare: "p-8" });
  });

  it("treats state and stacked variants as non-viewport-editable (null)", () => {
    expect(splitResponsiveVariant("hover:bg-blue-700").variant).toBeNull();
    expect(splitResponsiveVariant("dark:bg-gray-900").variant).toBeNull();
    expect(splitResponsiveVariant("dark:md:p-2").variant).toBeNull();
  });
});

describe("pickWinningVariant", () => {
  const matchesMb = (bare: string) => classMatchesPrefix(bare, "mb");

  it("picks the largest breakpoint <= viewport width", () => {
    const classes = ["mb-0", "md:mb-6"];
    // desktop (>= md): md:mb-6 wins → edit the md variant
    expect(pickWinningVariant(classes, matchesMb, 1440)).toBe("md");
    // mobile (< md): only base applies
    expect(pickWinningVariant(classes, matchesMb, 500)).toBe("");
  });

  it("returns base when only a base class is present", () => {
    expect(pickWinningVariant(["mb-4"], matchesMb, 1440)).toBe("");
  });

  it("returns base when the element declares no class for the property", () => {
    expect(pickWinningVariant(["flex", "text-sm"], matchesMb, 1440)).toBe("");
  });

  it("ignores state variants when choosing the winner", () => {
    // hover:mb-2 is not viewport-editable; md:mb-6 still wins at desktop
    expect(pickWinningVariant(["mb-0", "hover:mb-2", "md:mb-6"], matchesMb, 1440)).toBe("md");
  });

  it("chooses the highest applicable breakpoint among several", () => {
    const classes = ["mb-0", "sm:mb-2", "md:mb-4", "xl:mb-8"];
    expect(pickWinningVariant(classes, matchesMb, 1280)).toBe("xl"); // >= xl
    expect(pickWinningVariant(classes, matchesMb, 800)).toBe("md");  // md <= 800 < lg
    expect(pickWinningVariant(classes, matchesMb, 700)).toBe("sm");  // sm <= 700 < md
  });
});

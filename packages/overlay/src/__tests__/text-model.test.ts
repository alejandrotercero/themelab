import { describe, expect, it } from "vitest";

import {
  getElementVisibleText,
  getRangeVisibleText,
  normalizeVisibleText,
} from "../text-model.js";

describe("text-model", () => {
  it("normalizes non-breaking spaces to regular spaces", () => {
    expect(normalizeVisibleText("and enjoy\u00A0software")).toBe(
      "and enjoy software"
    );
  });

  it("prefers visible innerText over raw textContent", () => {
    const element = {
      innerText: "i study math at waterloo",
      textContent: "i studymathatwaterloo",
    } as HTMLElement;

    expect(getElementVisibleText(element)).toBe("i study math at waterloo");
  });

  it("normalizes range text using the same visible-text model", () => {
    const range = {
      toString: () => "message\u00A0me",
    } as Range;

    expect(getRangeVisibleText(range)).toBe("message me");
  });
});

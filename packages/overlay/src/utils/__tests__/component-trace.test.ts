import { describe, it, expect } from "vitest";

import { formatComponentTrace } from "../component-trace.js";
import type { TraceStackFrame } from "../component-trace.js";

const appFrame = (
  name: string,
  filePath: string,
  line = 10
): TraceStackFrame => ({
  componentName: name,
  filePath,
  lineNumber: line,
  columnNumber: 5,
  origin: "app",
  packageName: null,
});

const pkgFrame = (name: string, packageName: string): TraceStackFrame => ({
  componentName: name,
  filePath: "",
  lineNumber: 0,
  columnNumber: 0,
  origin: "package",
  packageName,
});

describe("formatComponentTrace", () => {
  it("renders an app frame with its location", () => {
    expect(
      formatComponentTrace([appFrame("Button", "src/Button.tsx", 12)])
    ).toBe("  in Button (at src/Button.tsx:12:5)");
  });

  it("renders a dependency frame by name + package, never a path", () => {
    const out = formatComponentTrace([
      pkgFrame("Tabs", "@radix-ui/react-tabs"),
    ]);
    expect(out).toBe("  in Tabs (@radix-ui/react-tabs)");
    expect(out).not.toContain("node_modules");
  });

  it("does not spend the line budget on a shared-UI frame", () => {
    // Budget is 3 high-signal app frames. A shared-UI frame interspersed is free,
    // so it doesn't count — letting a 4th line through within the same budget.
    const frames = [
      appFrame("Header", "src/features/Header.tsx"),
      appFrame("Card", "src/components/ui/card.tsx"), // shared-UI → free
      appFrame("Nav", "src/features/Nav.tsx"),
      appFrame("Menu", "src/features/Menu.tsx"),
      appFrame("Extra", "src/features/Extra.tsx"),
    ];
    const lines = formatComponentTrace(frames).split("\n");
    // Header(1) + Card(free) + Nav(2) + Menu(3) = 4 lines; Extra is over budget.
    expect(lines).toHaveLength(4);
    expect(lines.some((l) => l.includes("src/components/ui/card.tsx"))).toBe(
      true
    );
    expect(lines.some((l) => l.includes("Extra"))).toBe(false);
  });

  it("stops after the budget of high-signal app frames", () => {
    const frames = Array.from({ length: 6 }, (_, i) =>
      appFrame(`C${i}`, `src/features/C${i}.tsx`)
    );
    // Default budget is 3 high-signal app frames.
    expect(formatComponentTrace(frames).split("\n")).toHaveLength(3);
  });

  it("collapses consecutive frames from the same dependency", () => {
    const frames = [
      pkgFrame("DialogContent", "@radix-ui/react-dialog"),
      pkgFrame("DialogContent", "@radix-ui/react-dialog"),
      appFrame("Modal", "src/Modal.tsx"),
    ];
    const lines = formatComponentTrace(frames).split("\n");
    expect(
      lines.filter((l) => l.includes("@radix-ui/react-dialog"))
    ).toHaveLength(1);
  });

  it("returns empty string for an empty stack", () => {
    expect(formatComponentTrace([])).toBe("");
  });
});

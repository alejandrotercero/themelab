import * as fs from "node:fs";
import path from "node:path";

import { describe, it, expect, afterEach } from "vitest";

import { resolveTheme } from "../theme-resolver.js";
import { upsertCssVars, writeThemeVars } from "../theme-writer.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups) {
    c();
  }
  cleanups.length = 0;
});

describe("upsertCssVars", () => {
  it("replaces an existing var in place, preserving everything else", () => {
    const css = `:root {\n  --primary: #111;\n  --radius: 8px;\n}`;
    const out = upsertCssVars(css, ":root", { primary: "#22c55e" });
    expect(out).toContain("--primary: #22c55e;");
    expect(out).toContain("--radius: 8px;"); // untouched
    expect(out).not.toContain("#111");
  });

  it("appends a missing var to the block with matching indentation", () => {
    const css = `:root {\n  --primary: #111;\n}`;
    const out = upsertCssVars(css, ":root", { radius: "0.5rem" });
    expect(out).toContain("--primary: #111;");
    expect(out).toContain("--radius: 0.5rem;");
    // appended line keeps the two-space indent
    expect(out).toMatch(/\n {2}--radius: 0\.5rem;/);
  });

  it("creates the block when the selector is absent (e.g. first dark edit)", () => {
    const css = `:root {\n  --primary: #111;\n}\n`;
    const out = upsertCssVars(css, ".dark", { primary: "#eee" });
    expect(out).toContain(":root {"); // original preserved
    expect(out).toMatch(/\.dark \{[\s\S]*--primary: #eee;[\s\S]*\}/);
  });

  it("only touches the targeted selector's block, not other :root-adjacent CSS", () => {
    const css = `@layer base {\n  :root {\n    --primary: #111;\n  }\n  .dark {\n    --primary: #eee;\n  }\n}`;
    const out = upsertCssVars(css, ".dark", { primary: "#000" });
    expect(out).toMatch(/\.dark \{[\s\S]*--primary: #000;/);
    expect(out).toMatch(/:root \{[\s\S]*--primary: #111;/); // light untouched
  });
});

describe("writeThemeVars round-trip", () => {
  function tempProject(files: Record<string, string>): string {
    const root = path.join(
      fixturesDir,
      `_tmpwrite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
    fs.mkdirSync(root, { recursive: true });
    cleanups.push(() => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; ignore failures (e.g. already removed).
      }
    });
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf-8");
    }
    return root;
  }

  const GLOBALS = `@layer base {
  :root {
    --background: oklch(1 0 0);
    --primary: oklch(0.21 0.006 285);
    --radius: 0.625rem;
  }
  .dark {
    --primary: oklch(0.92 0.004 286);
  }
}`;

  it("writes light + dark edits and the resolver reads them back", () => {
    const root = tempProject({ "src/app/globals.css": GLOBALS });
    const file = path.join(root, "src/app/globals.css");

    const result = writeThemeVars(file, [
      {
        selector: ":root",
        vars: { primary: "oklch(0.5 0.2 250)", radius: "1rem" },
      },
      { selector: ".dark", vars: { primary: "oklch(0.3 0.1 250)" } },
    ]);
    expect(result.success).toBe(true);

    const reread = resolveTheme(root);
    if (!reread) {
      throw new Error("expected resolveTheme to return a theme");
    }
    expect(reread.theme.light.primary).toBe("oklch(0.5 0.2 250)");
    expect(reread.theme.light.radius).toBe("1rem");
    expect(reread.theme.dark.primary).toBe("oklch(0.3 0.1 250)");
    // unedited var survives
    expect(reread.theme.light.background).toBe("oklch(1 0 0)");
  });

  it("returns before/after for undo and reports no-op cleanly", () => {
    const root = tempProject({ "src/index.css": ":root { --primary: #111; }" });
    const file = path.join(root, "src/index.css");
    const result = writeThemeVars(file, [
      { selector: ":root", vars: { primary: "#111" } },
    ]);
    expect(result.success).toBe(true);
    expect(result.before).toBe(result.after); // no-op (same value)
  });
});

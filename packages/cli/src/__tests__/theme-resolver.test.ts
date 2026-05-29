import { describe, it, expect, afterEach } from "vitest";
import { parseCssVarBlock, resolveTheme } from "../theme-resolver.js";
import * as fs from "node:fs";
import * as path from "node:path";

const fixturesDir = path.join(__dirname, "fixtures");

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tempProject(files: Record<string, string>): string {
  const root = path.join(fixturesDir, `_tmptheme_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(root, { recursive: true });
  cleanups.push(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }
  return root;
}

describe("parseCssVarBlock", () => {
  it("extracts custom properties without the leading --", () => {
    expect(parseCssVarBlock("  --primary: oklch(0.6 0.2 250); --radius: 0.5rem; ")).toEqual({
      primary: "oklch(0.6 0.2 250)",
      radius: "0.5rem",
    });
  });

  it("ignores non-custom-property declarations", () => {
    expect(parseCssVarBlock("color: red; --bg: #fff;")).toEqual({ bg: "#fff" });
  });
});

const SHADCN_GLOBALS = `@layer base {
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.14 0 0);
    --primary: oklch(0.21 0.006 285);
    --radius: 0.625rem;
    --font-sans: Inter, sans-serif;
  }
  .dark {
    --background: oklch(0.14 0 0);
    --foreground: oklch(0.98 0 0);
    --primary: oklch(0.92 0.004 286);
  }
}`;

describe("resolveTheme", () => {
  it("parses :root (light) and .dark blocks from a shadcn globals.css", () => {
    const root = tempProject({ "src/app/globals.css": SHADCN_GLOBALS });
    const resolved = resolveTheme(root);

    expect(resolved).not.toBeNull();
    expect(resolved!.theme.light.primary).toBe("oklch(0.21 0.006 285)");
    expect(resolved!.theme.light.radius).toBe("0.625rem");
    expect(resolved!.theme.light["font-sans"]).toBe("Inter, sans-serif");
    expect(resolved!.theme.dark.primary).toBe("oklch(0.92 0.004 286)");
    expect(resolved!.source.darkSelector).toBe(".dark");
    expect(resolved!.source.filePath).toContain("globals.css");
  });

  it("supports [data-theme=dark] as the dark selector", () => {
    const css = `:root { --primary: #111; --bg: #fff; }
[data-theme="dark"] { --primary: #eee; }`;
    const root = tempProject({ "styles/index.css": css });
    const resolved = resolveTheme(root);
    expect(resolved!.theme.dark.primary).toBe("#eee");
    expect(resolved!.source.darkSelector).toBe('[data-theme="dark"]');
  });

  it("returns light-only theme (null darkSelector) when no dark block exists", () => {
    const root = tempProject({ "src/index.css": ":root { --primary: #111; --radius: 8px; }" });
    const resolved = resolveTheme(root);
    expect(resolved!.theme.dark).toEqual({});
    expect(resolved!.source.darkSelector).toBeNull();
  });

  it("picks the CSS file with the most :root vars (the real theme file)", () => {
    const root = tempProject({
      "src/reset.css": ":root { --x: 1; }",
      "src/app/globals.css": SHADCN_GLOBALS,
    });
    const resolved = resolveTheme(root);
    expect(resolved!.source.filePath).toContain("globals.css");
    expect(Object.keys(resolved!.theme.light).length).toBeGreaterThan(1);
  });

  it("returns null when no CSS file declares :root custom properties", () => {
    const root = tempProject({ "src/app.css": ".btn { color: red; }" });
    expect(resolveTheme(root)).toBeNull();
  });
});

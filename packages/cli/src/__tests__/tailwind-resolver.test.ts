import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveTailwindConfig,
  parseThemeBlock,
  parseDarkModeConfig,
  readDarkModeFromConfigText,
} from "../tailwind-resolver.js";

describe("parseThemeBlock", () => {
  it("extracts CSS custom properties from @theme block", () => {
    const css = `
      @theme {
        --color-brand: #1a2b3c;
        --spacing-18: 4.5rem;
      }
    `;
    const result = parseThemeBlock(css);
    expect(result).toEqual({
      "--color-brand": "#1a2b3c",
      "--spacing-18": "4.5rem",
    });
  });

  it("returns empty object when no @theme block", () => {
    const css = `body { margin: 0; }`;
    expect(parseThemeBlock(css)).toEqual({});
  });

  it("handles multiple @theme blocks", () => {
    const css = `
      @theme {
        --color-a: red;
      }
      @theme {
        --color-b: blue;
      }
    `;
    const result = parseThemeBlock(css);
    expect(result["--color-a"]).toBe("red");
    expect(result["--color-b"]).toBe("blue");
  });
});

describe("parseDarkModeConfig", () => {
  it("treats ['class'] as the class strategy with the default .dark selector", () => {
    expect(parseDarkModeConfig(["class"])).toEqual({ strategy: "class", selector: ".dark" });
  });

  it("reads a custom selector from a tuple", () => {
    expect(parseDarkModeConfig(["selector", "[data-theme=dark]"])).toEqual({
      strategy: "class",
      selector: "[data-theme=dark]",
    });
  });

  it("treats the bare 'class'/'selector' strings as the class strategy", () => {
    expect(parseDarkModeConfig("class").strategy).toBe("class");
    expect(parseDarkModeConfig("selector").strategy).toBe("class");
  });

  it("defaults to media for undefined / 'media'", () => {
    expect(parseDarkModeConfig(undefined).strategy).toBe("media");
    expect(parseDarkModeConfig("media").strategy).toBe("media");
  });
});

describe("readDarkModeFromConfigText", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-tw-"));
  });

  it("recovers darkMode: ['class'] from a tailwind.config.ts (can't be require()d)", () => {
    fs.writeFileSync(
      path.join(dir, "tailwind.config.ts"),
      `import type { Config } from "tailwindcss";\nexport default { darkMode: ['class'], content: [] } satisfies Config;\n`,
    );
    expect(readDarkModeFromConfigText(dir)).toEqual({ strategy: "class", selector: ".dark" });
  });

  it("recovers a string darkMode: 'media'", () => {
    fs.writeFileSync(path.join(dir, "tailwind.config.js"), `module.exports = { darkMode: "media" };\n`);
    expect(readDarkModeFromConfigText(dir)).toEqual({ strategy: "media", selector: ".dark" });
  });

  it("recovers a custom class selector tuple", () => {
    fs.writeFileSync(
      path.join(dir, "tailwind.config.ts"),
      `export default { darkMode: ["selector", ".my-dark"] };\n`,
    );
    expect(readDarkModeFromConfigText(dir)).toEqual({ strategy: "class", selector: ".my-dark" });
  });

  it("returns null when no config or no darkMode is declared", () => {
    expect(readDarkModeFromConfigText(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, "tailwind.config.ts"), `export default { content: [] };\n`);
    expect(readDarkModeFromConfigText(dir)).toBeNull();
  });
});

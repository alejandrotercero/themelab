import { describe, it, expect } from "vitest";

import {
  extractFilePath,
  isBundlerChunkName,
  resolveFrameFilePath,
} from "../source-resolve.js";

describe("extractFilePath", () => {
  it("strips webpack-internal prefix", () => {
    expect(extractFilePath("webpack-internal:///./src/App.tsx")).toBe(
      "src/App.tsx"
    );
  });

  it("strips webpack-internal with app-pages-browser", () => {
    expect(
      extractFilePath(
        "webpack-internal:///(app-pages-browser)/./src/app/page.tsx"
      )
    ).toBe("src/app/page.tsx");
  });

  it("strips webpack-internal with ssr", () => {
    expect(
      extractFilePath("webpack-internal:///(ssr)/./src/components/Button.tsx")
    ).toBe("src/components/Button.tsx");
  });

  it("strips webpack-internal with rsc", () => {
    expect(
      extractFilePath("webpack-internal:///(rsc)/./src/app/layout.tsx")
    ).toBe("src/app/layout.tsx");
  });

  it("strips _next/static/chunks path", () => {
    expect(extractFilePath("/_next/static/chunks/src/App.tsx")).toBe(
      "src/App.tsx"
    );
  });

  it("strips _next/static/chunks/app path", () => {
    expect(extractFilePath("/_next/static/chunks/app/src/app/page.tsx")).toBe(
      "src/app/page.tsx"
    );
  });

  it("strips file:// protocol", () => {
    expect(extractFilePath("file:///src/App.tsx")).toBe("src/App.tsx");
  });

  it("strips Vite /@fs/ prefix", () => {
    expect(extractFilePath("/@fs/src/App.tsx")).toBe("src/App.tsx");
  });

  it("strips query string cache busters", () => {
    expect(extractFilePath("src/App.tsx?abc123")).toBe("src/App.tsx");
  });

  it("strips ?v= version params", () => {
    expect(extractFilePath("src/App.tsx?v=12345")).toBe("src/App.tsx");
  });

  it("strips ?t= timestamp params", () => {
    expect(extractFilePath("src/App.tsx?t=1234567890")).toBe("src/App.tsx");
  });

  it("strips ?import suffix", () => {
    expect(extractFilePath("src/App.tsx?import")).toBe("src/App.tsx");
  });

  it("passes through clean relative paths", () => {
    expect(extractFilePath("src/components/Button.tsx")).toBe(
      "src/components/Button.tsx"
    );
  });

  it("strips leading ./", () => {
    expect(extractFilePath("./src/App.tsx")).toBe("src/App.tsx");
  });

  it("returns empty for empty input", () => {
    expect(extractFilePath("")).toBe("");
  });

  it("handles combined prefix and suffix", () => {
    expect(extractFilePath("webpack-internal:///./src/App.tsx?abc123")).toBe(
      "src/App.tsx"
    );
  });

  it("strips webpack:/// without internal", () => {
    expect(extractFilePath("webpack:///./src/App.tsx")).toBe("src/App.tsx");
  });

  it("strips webpack with app-pages-browser without internal", () => {
    expect(
      extractFilePath("webpack:///(app-pages-browser)/./src/App.tsx")
    ).toBe("src/App.tsx");
  });

  it("strips leading slash from bare paths", () => {
    expect(extractFilePath("/src/App.tsx")).toBe("src/App.tsx");
  });
});

describe("isBundlerChunkName", () => {
  it("flags Turbopack chunk names (._. marker)", () => {
    expect(isBundlerChunkName("src_99ffcf5b._.js")).toBe(true);
    expect(isBundlerChunkName("/_next/static/chunks/src_99ffcf5b._.js")).toBe(
      true
    );
  });

  it("flags hashed webpack chunks", () => {
    expect(isBundlerChunkName("app-pages._a1b2c3d4.js")).toBe(true);
    expect(isBundlerChunkName("main-12ab34cd.mjs")).toBe(true);
  });

  it("does NOT flag real source files", () => {
    expect(isBundlerChunkName("src/components/app/app-header.tsx")).toBe(false);
    expect(isBundlerChunkName("Button.jsx")).toBe(false);
    expect(isBundlerChunkName("src/app/page.tsx")).toBe(false);
    expect(isBundlerChunkName("useDebounce.js")).toBe(false);
  });
});

describe("resolveFrameFilePath", () => {
  it("returns a real source path from a webpack-internal URL", () => {
    expect(
      resolveFrameFilePath(
        "webpack-internal:///./src/components/app/app-header.tsx"
      )
    ).toContain("src/components/app/app-header.tsx");
  });

  it("returns empty for a Turbopack chunk name (prevents ENOENT writes)", () => {
    expect(resolveFrameFilePath("src_99ffcf5b._.js")).toBe("");
  });

  it("returns empty for nullish input", () => {
    // Explicit undefined is the point of this test (verifies the `undefined`
    // branch distinctly from `null`); the param is required (not `?`), so
    // omitting the argument is a type error.
    // oxlint-disable-next-line unicorn/no-useless-undefined -- see comment above
    expect(resolveFrameFilePath(undefined)).toBe("");
    expect(resolveFrameFilePath(null)).toBe("");
  });
});

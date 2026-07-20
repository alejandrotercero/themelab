import { describe, it, expect } from "vitest";

import { classifySourcePath } from "../classify-source-path.js";
import { resolvePackageName } from "../parse-package-name.js";

describe("classifySourcePath", () => {
  it("classifies a plain app source file as app", () => {
    expect(classifySourcePath("src/components/Button.tsx").origin).toBe("app");
  });

  it("classifies a webpack-internal-wrapped app file as app", () => {
    expect(
      classifySourcePath("webpack-internal:///./src/components/Button.tsx")
        .origin
    ).toBe("app");
  });

  it("classifies a node_modules dependency as package", () => {
    const result = classifySourcePath(
      "node_modules/@radix-ui/react-dialog/dist/index.js"
    );
    expect(result.origin).toBe("package");
    expect(result.packageName).toBe("@radix-ui/react-dialog");
  });

  // Leak case 1: Vite optimized-deps flattening has no node_modules/dist marker.
  it("classifies a Vite optimized-dep (flattened scoped pkg) as package, not app", () => {
    const result = classifySourcePath(
      "/project/node_modules/.vite/deps/@radix-ui_react-dialog.js"
    );
    expect(result.origin).toBe("package");
    expect(result.packageName).toBe("@radix-ui/react-dialog");
  });

  // Leak case 2: a monorepo first-party file must survive as editable app source.
  it("classifies a monorepo workspace file (leading ../) as app", () => {
    expect(classifySourcePath("../../packages/ui/src/Button.tsx").origin).toBe(
      "app"
    );
  });

  // Leak case 3: sourcemapped scoped dep with no node_modules marker.
  it("classifies a sourcemapped scoped dep as package", () => {
    const result = classifySourcePath("@radix-ui/react-tabs/src/tabs.tsx");
    expect(result.origin).toBe("package");
    expect(result.packageName).toBe("@radix-ui/react-tabs");
  });

  it("treats a bundler alias scope (@components/...) as app, not package", () => {
    expect(classifySourcePath("@components/forms/Input.tsx").origin).toBe(
      "app"
    );
  });

  it("classifies Turbopack output chunks as unknown (never app)", () => {
    expect(classifySourcePath("src_99ffcf5b._.js").origin).toBe("unknown");
  });

  it("returns unknown for empty input", () => {
    expect(classifySourcePath("").origin).toBe("unknown");
    expect(classifySourcePath(null).origin).toBe("unknown");
  });
});

describe("resolvePackageName", () => {
  it("reads a scoped node_modules package", () => {
    expect(resolvePackageName("node_modules/@mui/material/Button.js")).toBe(
      "@mui/material"
    );
  });

  it("reads an unscoped node_modules package", () => {
    expect(resolvePackageName("node_modules/lodash/map.js")).toBe("lodash");
  });

  it("reads a Vite optimized unscoped dep", () => {
    expect(resolvePackageName("node_modules/.vite/deps/react-dom.js")).toBe(
      "react-dom"
    );
  });

  it("returns null for first-party source", () => {
    expect(resolvePackageName("src/app/page.tsx")).toBeNull();
  });
});

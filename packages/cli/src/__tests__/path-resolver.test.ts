import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isProjectFilePathSafe, resolveProjectFilePath } from "../path-resolver.js";

const tempRoots: string[] = [];

function makeProject(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "themelab-paths-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const projectRoot = tempRoots.pop();
    if (projectRoot) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  }
});

describe("resolveProjectFilePath", () => {
  it("resolves project-relative paths inside the project root", () => {
    const projectRoot = makeProject();

    expect(resolveProjectFilePath("src/Navbar.jsx", projectRoot)).toBe(
      path.join(projectRoot, "src", "Navbar.jsx"),
    );
  });

  it("treats leading-slash source paths as project-root-relative when no real absolute file exists", () => {
    const projectRoot = makeProject();

    expect(resolveProjectFilePath("/src/Navbar.jsx", projectRoot)).toBe(
      path.join(projectRoot, "src", "Navbar.jsx"),
    );
    expect(resolveProjectFilePath("/app/page.tsx", projectRoot)).toBe(
      path.join(projectRoot, "app", "page.tsx"),
    );
    expect(resolveProjectFilePath("/components/Button.tsx", projectRoot)).toBe(
      path.join(projectRoot, "components", "Button.tsx"),
    );
  });

  it("keeps true absolute paths that are already inside the project root", () => {
    const projectRoot = makeProject();
    const absolutePath = path.join(projectRoot, "features", "Hero.tsx");

    expect(resolveProjectFilePath(absolutePath, projectRoot)).toBe(absolutePath);
  });

  it("rejects traversal outside the project root", () => {
    const projectRoot = makeProject();

    expect(resolveProjectFilePath("../outside.tsx", projectRoot)).toBeNull();
    expect(isProjectFilePathSafe("../outside.tsx", projectRoot)).toBe(false);
  });

  it("rejects real absolute filesystem paths outside the project root", () => {
    const projectRoot = makeProject();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "themelab-outside-"));
    tempRoots.push(outsideDir);
    const outsideFile = path.join(outsideDir, "Navbar.jsx");
    fs.writeFileSync(outsideFile, "export default function Navbar() { return null; }", "utf-8");

    expect(resolveProjectFilePath(outsideFile, projectRoot)).toBeNull();
    expect(isProjectFilePathSafe(outsideFile, projectRoot)).toBe(false);
  });

  it("rejects symlink that escapes the project root", () => {
    // Skip gracefully on platforms where symlink creation is not permitted.
    let canSymlink = true;
    try {
      const testLink = path.join(os.tmpdir(), `themelab-symtest-${process.pid}`);
      fs.symlinkSync(os.tmpdir(), testLink);
      fs.unlinkSync(testLink);
    } catch {
      canSymlink = false;
    }
    if (!canSymlink) return;

    const projectRoot = makeProject();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "themelab-escape-"));
    tempRoots.push(outsideDir);
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret", "utf-8");
    // Create a symlink inside the project that points outside.
    fs.symlinkSync(outsideDir, path.join(projectRoot, "escape"));

    expect(resolveProjectFilePath("escape/secret.txt", projectRoot)).toBeNull();
    expect(isProjectFilePathSafe("escape/secret.txt", projectRoot)).toBe(false);
  });

  it("allows symlink that stays inside the project root", () => {
    // Skip gracefully on platforms where symlink creation is not permitted.
    let canSymlink = true;
    try {
      const testLink = path.join(os.tmpdir(), `themelab-symtest2-${process.pid}`);
      fs.symlinkSync(os.tmpdir(), testLink);
      fs.unlinkSync(testLink);
    } catch {
      canSymlink = false;
    }
    if (!canSymlink) return;

    const projectRoot = makeProject();
    // Create a real directory and file inside the project.
    fs.mkdirSync(path.join(projectRoot, "real"));
    fs.writeFileSync(path.join(projectRoot, "real", "Button.tsx"), "export {};", "utf-8");
    // Create a symlink inside the project that points to another dir inside the project.
    fs.symlinkSync(path.join(projectRoot, "real"), path.join(projectRoot, "link"));

    expect(resolveProjectFilePath("link/Button.tsx", projectRoot)).not.toBeNull();
    expect(isProjectFilePathSafe("link/Button.tsx", projectRoot)).toBe(true);
  });
});

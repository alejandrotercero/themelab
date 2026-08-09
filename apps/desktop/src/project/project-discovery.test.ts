import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { inspectProject } from "./project-discovery.js";
import { isNodeVersionCompatible } from "./runtime-resolver.js";

const fixtures: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "themelab-desktop-project-"));
  fixtures.push(root);
  await Promise.all(Object.entries(files).map(async ([relative, content]) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }));
  return root;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("inspectProject", () => {
  it("separates a monorepo workspace from its chosen app and install root", async () => {
    const root = await fixture({
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "apps/one/package.json": JSON.stringify({ name: "one", dependencies: { react: "19.0.0", next: "15.0.0" }, scripts: { dev: "next dev" }, packageManager: "pnpm@10.0.0" }),
      "apps/two/package.json": JSON.stringify({ name: "two", dependencies: { react: "19.0.0", vite: "6.0.0" }, scripts: { dev: "vite" } }),
    });
    const choice = await inspectProject(root);
    expect(choice.status).toBe("needs-app-choice");
    if (choice.status !== "needs-app-choice") return;
    expect(choice.candidates).toHaveLength(2);
    const result = await inspectProject(root, { appRoot: path.join(root, "apps/one"), nodeExecutable: process.execPath });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const canonicalRoot = await realpath(root);
    expect(result.project.workspaceRoot).toBe(canonicalRoot);
    expect(result.project.appRoot).toBe(path.join(canonicalRoot, "apps/one"));
    expect(result.project.installRoot).toBe(canonicalRoot);
    expect(result.project.packageManager).toMatchObject({ name: "pnpm", declaredVersion: "10.0.0", source: "package-json" });
  });

  it("does not widen an app-only authorization to an ancestor install root", async () => {
    const root = await fixture({
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "apps/one/package.json": JSON.stringify({ dependencies: { react: "19.0.0", vite: "6.0.0" }, scripts: { dev: "vite" } }),
    });
    const result = await inspectProject(path.join(root, "apps/one"), { nodeExecutable: process.execPath });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.project.installRoot).toBe(await realpath(path.join(root, "apps/one")));
    expect(result.project.packageManager.name).toBeNull();
    expect(result.project.diagnostics).toContainEqual(expect.objectContaining({ code: "install-root-outside-workspace" }));
  });

  it("uses the resolved Node module search path instead of a bare node_modules directory", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { react: "19.0.0", vite: "6.0.0" }, scripts: { dev: "vite" }, packageManager: "npm@10.0.0" }),
      "node_modules/not-react/package.json": "{}",
    });
    const result = await inspectProject(root, { nodeExecutable: process.execPath });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.project.dependencyStatus).toBe("missing");
  });

  it("does not make a framework default port part of discovery", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { react: "19.0.0", next: "15.0.0" }, scripts: { dev: "next dev", start: "next start" } }),
    });
    const result = await inspectProject(root, { nodeExecutable: process.execPath });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.project).not.toHaveProperty("port");
    expect(result.project.scripts).toEqual([{ id: "dev", name: "dev", command: "next dev", recommended: true }, { id: "start", name: "start", command: "next start", recommended: false }]);
  });
});

describe("isNodeVersionCompatible", () => {
  it("handles normal Node major and minimum requirements", () => {
    expect(isNodeVersionCompatible("v24.17.0", ">=20")).toBe(true);
    expect(isNodeVersionCompatible("v18.20.0", ">=20")).toBe(false);
    expect(isNodeVersionCompatible("v20.11.0", "20.x")).toBe(true);
    expect(isNodeVersionCompatible("v21.0.0", "20.x")).toBe(false);
  });
});

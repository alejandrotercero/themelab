import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { migrateProjectStore, readProjectStore, rememberProject, validateRecentProjects, writeProjectStore } from "./project-store.js";

const roots: string[] = [];
async function fixture(): Promise<string> { const root = await mkdtemp(path.join(os.tmpdir(), "themelab-project-store-")); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("project store", () => {
  it("migrates legacy path-only recents without pretending they are openable", () => {
    const state = migrateProjectStore({ version: 1, recentRoots: ["/missing/one"] });
    expect(state).toMatchObject({ version: 2, recentProjects: [{ workspaceRoot: "/missing/one", appRoot: null, availability: "missing" }] });
  });

  it("writes atomically and keeps the app/install identity", async () => {
    const root = await fixture();
    const file = path.join(root, "state", "projects.json");
    const state = rememberProject(migrateProjectStore(null), { id: "project-1", workspaceRoot: root, appRoot: path.join(root, "apps", "web"), installRoot: root, displayName: "web" });
    await writeProjectStore(file, state);
    expect(await readProjectStore(file)).toMatchObject({ version: 2, recentProjects: [{ id: "project-1", workspaceRoot: root, appRoot: path.join(root, "apps", "web"), installRoot: root }] });
  });

  it("preserves unavailable recents instead of deleting them", async () => {
    const root = await fixture();
    const appRoot = path.join(root, "app");
    await mkdir(appRoot);
    const state = rememberProject(migrateProjectStore(null), { id: "project-1", workspaceRoot: root, appRoot, installRoot: root, displayName: "app" });
    await rm(appRoot, { recursive: true });
    const verified = await validateRecentProjects(state);
    expect(verified.recentProjects[0]).toMatchObject({ availability: "missing", appRoot });
    await writeFile(path.join(root, "placeholder"), "ok");
  });
});

import type { ProjectDescriptor } from "./project-model.js";
import path from "node:path";
import { createInstallPlan, environmentWithRuntime, resolvePackageManagerExecutable, type PackageManagerProbe } from "./dependency-service.js";
import { describe, expect, it } from "vitest";

function project(manager: ProjectDescriptor["packageManager"]["name"], lockfile: string | null): ProjectDescriptor {
  return {
    id: "project", workspaceRoot: "/workspace", appRoot: "/workspace/app", installRoot: "/workspace",
    displayName: "app", framework: "vite", packageJsonPath: "/workspace/app/package.json",
    packageManager: { name: manager, declaredVersion: null, source: lockfile ? "lockfile" : null, lockfile },
    runtime: { requirement: ">=20", requirementSource: "package-json-engines", executable: "/usr/local/bin/node", version: "v22.0.0", compatible: true, source: "path", diagnostic: null },
    scripts: [], dependencyStatus: "missing", diagnostics: [],
  };
}

describe("createInstallPlan", () => {
  it.each([
    ["npm", "package-lock.json", ["ci"]],
    ["npm", null, ["install"]],
    ["pnpm", "pnpm-lock.yaml", ["install", "--frozen-lockfile"]],
    ["pnpm", null, ["install"]],
    ["yarn", "yarn.lock", ["install", "--immutable"]],
    ["bun", "bun.lock", ["install", "--frozen-lockfile"]],
  ] as const)("creates the correct %s command", (manager, lockfile, args) => {
    const result = createInstallPlan(project(manager, lockfile), `/tools/${manager}`);
    expect(result).toMatchObject({ ok: true, plan: { cwd: "/workspace", args, lockfileMode: lockfile ? "frozen" : "mutable", mutatesLockfile: !lockfile } });
  });

  it("recovers a package manager from a login shell when GUI PATH has none", async () => {
    const probe: PackageManagerProbe = {
      commandOnPath: async () => null,
      loginShellCommand: async () => process.execPath,
      knownCandidates: async () => null,
    };
    const input = project("pnpm", "pnpm-lock.yaml");
    input.runtime.executable = null;
    await expect(resolvePackageManagerExecutable(input, probe)).resolves.toBe(process.execPath);
  });

  it("uses known installed manager locations when GUI PATH and shell lookup fail", async () => {
    const probe: PackageManagerProbe = {
      commandOnPath: async () => null,
      loginShellCommand: async () => null,
      knownCandidates: async () => process.execPath,
    };
    const input = project("pnpm", "pnpm-lock.yaml");
    input.runtime.executable = null;
    await expect(resolvePackageManagerExecutable(input, probe)).resolves.toBe(process.execPath);
  });

  it("prepends the selected Node directory for child package-manager scripts", () => {
    expect(environmentWithRuntime("/managed/node/bin/node", { PATH: "/usr/bin" }).PATH).toBe(`/managed/node/bin${path.delimiter}/usr/bin`);
  });

  it("blocks a runtime mismatch rather than trying to install Node", () => {
    const input = project("pnpm", "pnpm-lock.yaml");
    input.runtime.compatible = false;
    input.runtime.diagnostic = "Project requires Node >=20; selected Node is v18.0.0.";
    expect(createInstallPlan(input, "/tools/pnpm")).toEqual({ ok: false, message: input.runtime.diagnostic });
  });

  it("uses the Yarn classic lockfile flag when the project pins Yarn 1", () => {
    const input = project("yarn", "yarn.lock");
    input.packageManager.declaredVersion = "1.22.22";
    expect(createInstallPlan(input, "/tools/yarn")).toMatchObject({ ok: true, plan: { args: ["install", "--frozen-lockfile"] } });
  });
});

import type { ProjectDescriptor } from "./project-model.js";
import { createDevCommandPlan, parseLoopbackEndpoints, resolveStartedEndpoint, validateLoopbackUrl } from "./dev-server-service.js";
import { describe, expect, it } from "vitest";

function project(framework: ProjectDescriptor["framework"]): ProjectDescriptor {
  return { id: "project", workspaceRoot: "/workspace", appRoot: "/workspace/app", installRoot: "/workspace", displayName: "app", framework, packageJsonPath: "/workspace/app/package.json", packageManager: { name: "pnpm", declaredVersion: null, source: "lockfile", lockfile: "pnpm-lock.yaml" }, runtime: { requirement: null, requirementSource: null, executable: "/tools/node", version: "v22.0.0", compatible: true, source: "path", diagnostic: null }, scripts: [{ id: "dev", name: "dev", command: framework === "vite" ? "vite" : "next dev", recommended: true }], dependencyStatus: "ready", diagnostics: [] };
}

describe("dev server command plans", () => {
  it("starts Next on an allocated non-default loopback port", () => {
    const result = createDevCommandPlan(project("nextjs"), "/tools/pnpm", "dev", 43123);
    expect(result).toMatchObject({ ok: true, plan: { endpoint: { url: "http://127.0.0.1:43123/" }, args: ["--dir", "/workspace/app", "run", "dev", "--hostname", "127.0.0.1", "--port", "43123"] } });
  });

  it("starts Vite on an allocated strict loopback port", () => {
    const result = createDevCommandPlan(project("vite"), "/tools/pnpm", "dev", 43124);
    expect(result).toMatchObject({ ok: true, plan: { endpoint: { url: "http://127.0.0.1:43124/" }, args: ["--dir", "/workspace/app", "run", "dev", "--host", "127.0.0.1", "--port", "43124", "--strictPort"] } });
  });

  it("uses npm's script separator but not pnpm's", () => {
    const npmProject = project("nextjs");
    npmProject.packageManager = { name: "npm", declaredVersion: null, source: "package-json", lockfile: null };
    const result = createDevCommandPlan(npmProject, "/tools/npm", "dev", 43125);
    expect(result).toMatchObject({ ok: true, plan: { args: ["--prefix", "/workspace/app", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", "43125"] } });
  });

  it.each([
    ["yarn", ["--cwd", "/workspace/app", "run", "dev", "--hostname", "127.0.0.1", "--port", "43126"]],
    ["bun", ["--cwd", "/workspace/app", "run", "dev", "--hostname", "127.0.0.1", "--port", "43126"]],
  ] as const)("forwards framework flags directly through %s", (manager, args) => {
    const managerProject = project("nextjs");
    managerProject.packageManager = { name: manager, declaredVersion: null, source: "lockfile", lockfile: `${manager}.lock` };
    const result = createDevCommandPlan(managerProject, `/tools/${manager}`, "dev", 43126);
    expect(result).toMatchObject({ ok: true, plan: { args } });
  });

  it("accepts only loopback attachment URLs", () => {
    expect(validateLoopbackUrl("http://localhost:4321/path")).toMatchObject({ host: "localhost", port: 4321 });
    expect(validateLoopbackUrl("https://example.com:4321/")).toBeNull();
    expect(validateLoopbackUrl("http://user:pass@localhost:4321/")).toBeNull();
  });

  it("parses unique loopback URLs from ANSI dev-server output", () => {
    expect(parseLoopbackEndpoints("\u001b[32mLocal:\u001b[0m http://localhost:4321/\nhttp://localhost:4321/")).toEqual([{ url: "http://localhost:4321/", host: "localhost", port: 4321 }]);
  });

  it("uses a custom script's announced endpoint and asks about multiple healthy endpoints", async () => {
    const delay = async () => undefined;
    await expect(resolveStartedEndpoint({ expected: null, output: () => "ready http://127.0.0.1:4011", hasExited: () => false, healthCheck: async () => true, delay, attempts: 1 })).resolves.toMatchObject({ status: "ready", endpoint: { port: 4011 } });
    await expect(resolveStartedEndpoint({ expected: null, output: () => "http://127.0.0.1:4011 http://localhost:4012", hasExited: () => false, healthCheck: async () => true, delay, attempts: 1 })).resolves.toMatchObject({ status: "choose", candidates: [{ port: 4011 }, { port: 4012 }] });
  });

  it("never substitutes a conventional port when the owned process exits", async () => {
    await expect(resolveStartedEndpoint({ expected: { url: "http://127.0.0.1:3000/", host: "127.0.0.1", port: 3000 }, output: () => "", hasExited: () => true, healthCheck: async () => true, delay: async () => undefined, attempts: 1 })).resolves.toMatchObject({ status: "error" });
  });
});

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { isNodeVersionCompatible, resolveRuntime, type RuntimeProbe } from "./runtime-resolver.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "themelab-runtime-"));
  roots.push(value);
  return value;
}

function probe(overrides: Partial<RuntimeProbe> = {}): RuntimeProbe {
  return {
    commandOnPath: async () => null,
    loginShellCommand: async () => null,
    knownShimCandidates: async () => [],
    version: async () => "v22.11.0",
    ...overrides,
  };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe("runtime resolution", () => {
  it("uses the declared Volta requirement before generic engine metadata", async () => {
    const result = await resolveRuntime(await root(), { volta: { node: "22.0.0" }, engines: { node: ">=20" } }, process.execPath, probe({ version: async () => "v22.0.0" }));
    expect(result).toMatchObject({ requirement: "22.0.0", requirementSource: "package-json-volta", source: "user", compatible: true });
  });

  it("uses an existing login-shell executable without invoking an installer", async () => {
    const executable = process.execPath;
    const result = await resolveRuntime(await root(), { engines: { node: ">=20" } }, undefined, probe({ loginShellCommand: async () => executable, version: async () => "v22.0.0" }));
    expect(result).toMatchObject({ executable, source: "login-shell", compatible: true });
  });

  it("uses a discovered fnm runtime when GUI PATH and login shell have none", async () => {
    const executable = process.execPath;
    const result = await resolveRuntime(await root(), { engines: { node: ">=20" } }, undefined, probe({ knownShimCandidates: async () => [{ executable, source: "fnm" }], version: async () => "v22.0.0" }));
    expect(result).toMatchObject({ executable, source: "fnm", compatible: true });
  });

  it("reports an incompatible existing runtime instead of switching or downloading", async () => {
    const result = await resolveRuntime(await root(), { engines: { node: ">=25" } }, process.execPath, probe({ version: async () => "v22.0.0" }));
    expect(result.compatible).toBe(false);
    expect(result.diagnostic).toContain("requires Node >=25");
  });

  it("handles bounded comparator ranges", () => {
    expect(isNodeVersionCompatible("v22.11.0", ">=20 <23")).toBe(true);
    expect(isNodeVersionCompatible("v23.0.0", ">=20 <23")).toBe(false);
    expect(isNodeVersionCompatible("v20.11.0", "^20.10.0")).toBe(true);
    expect(isNodeVersionCompatible("v21.0.0", "^20.10.0")).toBe(false);
  });
});

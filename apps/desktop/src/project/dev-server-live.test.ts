import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import { allocateLoopbackPort, createDevCommandPlan, resolveStartedEndpoint } from "./dev-server-service.js";
import { resolvePackageManagerExecutable } from "./dependency-service.js";
import { startOwnedProcess } from "./owned-process.js";
import { inspectProject } from "./project-discovery.js";

const roots: string[] = [];
const repoRoot = path.resolve(process.cwd(), "../..");

function healthy(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http.get(url, (response) => {
      response.resume();
      finish((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 400);
    });
    request.setTimeout(1_000, () => {
      request.destroy();
      finish(false);
    });
    request.once("error", () => finish(false));
  });
}

async function start(executable: string, args: string[], cwd: string, url: string) {
  const owned = startOwnedProcess({ executable, args, cwd, env: { ...process.env, BROWSER: "none" } });
  const output: string[] = [];
  owned.child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  owned.child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  const endpoint = new URL(url);
  const resolution = await resolveStartedEndpoint({
    expected: { url, host: "127.0.0.1", port: Number(endpoint.port) },
    output: () => output.join(""),
    hasExited: () => owned.child.exitCode !== null || owned.child.signalCode !== null,
    healthCheck: async (candidate) => healthy(candidate.url),
    delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
  if (resolution.status !== "ready") {
    await owned.stop();
    throw new Error(resolution.status === "error" ? resolution.message : "Unexpected multiple endpoints.");
  }
  return owned;
}

async function occupyPortIfAvailable(port: number): Promise<http.Server | null> {
  const server = http.createServer((_request, response) => response.end("unrelated external server"));
  const listening = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
  return listening ? server : null;
}

async function closeServer(server: http.Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterAll(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe.sequential("real framework dev-server lifecycle", () => {
  it("runs Next on an allocated port and releases it on owned stop", async () => {
    // If 3000 is available, deliberately occupy it with an unrelated server.
    // If it is already occupied, we leave it alone: either way ThemeLab must
    // allocate its own endpoint rather than attaching to a conventional port.
    const conventional = await occupyPortIfAvailable(3000);
    const port = await allocateLoopbackPort();
    expect(port).not.toBe(3000);
    const url = `http://127.0.0.1:${port}/`;
    const app = path.join(repoRoot, "apps/web");
    const inspection = await inspectProject(repoRoot, { appRoot: app });
    if (inspection.status !== "ready") throw new Error("The real Next fixture was not recognized as a runnable project.");
    const executable = await resolvePackageManagerExecutable(inspection.project);
    const planResult = createDevCommandPlan(inspection.project, executable, "dev", port);
    if (!planResult.ok) throw new Error(planResult.message);
    const owned = await start(planResult.plan.executable, planResult.plan.args, planResult.plan.cwd, url);
    try {
      expect(await healthy(url)).toBe(true);
      if (conventional) expect(await healthy("http://127.0.0.1:3000/")).toBe(true);
    } finally {
      await owned.stop();
      await closeServer(conventional);
    }
    expect(await healthy(url)).toBe(false);
  }, 45_000);

  it("runs Vite on an allocated strict port and releases it on owned stop", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "themelab-vite-live-"));
    roots.push(root);
    await writeFile(path.join(root, "index.html"), "<div>vite fixture</div>");
    const conventional = await occupyPortIfAvailable(5173);
    const port = await allocateLoopbackPort();
    expect(port).not.toBe(5173);
    const url = `http://127.0.0.1:${port}/`;
    const vite = path.join(repoRoot, "apps/desktop/node_modules/.bin/vite");
    const owned = await start(vite, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], root, url);
    try {
      expect(await healthy(url)).toBe(true);
      if (conventional) expect(await healthy("http://127.0.0.1:5173/")).toBe(true);
    } finally {
      await owned.stop();
      await closeServer(conventional);
    }
    expect(await healthy(url)).toBe(false);
  }, 30_000);

  it("leaves no owned Vite listener across repeated start/stop cycles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "themelab-vite-cycle-"));
    roots.push(root);
    await writeFile(path.join(root, "index.html"), "<div>cycle fixture</div>");
    const vite = path.join(repoRoot, "apps/desktop/node_modules/.bin/vite");
    for (let cycle = 0; cycle < 5; cycle++) {
      const port = await allocateLoopbackPort();
      const url = `http://127.0.0.1:${port}/`;
      const owned = await start(vite, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], root, url);
      try { expect(await healthy(url)).toBe(true); } finally { await owned.stop(); }
      expect(await healthy(url)).toBe(false);
    }
  }, 60_000);

  it("does not stop an independently attached loopback server", async () => {
    const externalPort = await allocateLoopbackPort();
    const externalUrl = `http://127.0.0.1:${externalPort}/`;
    const external = http.createServer((_request, response) => response.end("external"));
    await new Promise<void>((resolve) => external.listen(externalPort, "127.0.0.1", resolve));
    const root = await mkdtemp(path.join(os.tmpdir(), "themelab-vite-attached-"));
    roots.push(root);
    await writeFile(path.join(root, "index.html"), "<div>owned fixture</div>");
    const ownedPort = await allocateLoopbackPort();
    const ownedUrl = `http://127.0.0.1:${ownedPort}/`;
    const vite = path.join(repoRoot, "apps/desktop/node_modules/.bin/vite");
    const owned = await start(vite, ["--host", "127.0.0.1", "--port", String(ownedPort), "--strictPort"], root, ownedUrl);
    try { expect(await healthy(externalUrl)).toBe(true); } finally { await owned.stop(); }
    expect(await healthy(ownedUrl)).toBe(false);
    expect(await healthy(externalUrl)).toBe(true);
    await new Promise<void>((resolve) => external.close(() => resolve()));
  }, 30_000);
});

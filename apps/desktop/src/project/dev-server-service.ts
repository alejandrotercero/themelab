import net from "node:net";
import path from "node:path";

import type { ProjectDescriptor } from "./project-model.js";
import { environmentWithRuntime } from "./dependency-service.js";

export interface LoopbackEndpoint { url: string; host: "127.0.0.1" | "localhost" | "[::1]"; port: number; }
export interface DevCommandPlan { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; displayCommand: string; endpoint: LoopbackEndpoint | null; }
export type StartedEndpointResolution =
  | { status: "ready"; endpoint: LoopbackEndpoint }
  | { status: "choose"; candidates: LoopbackEndpoint[] }
  | { status: "error"; message: string };

export interface StartedEndpointOptions {
  expected: LoopbackEndpoint | null;
  output: () => string;
  hasExited: () => boolean;
  healthCheck(endpoint: LoopbackEndpoint): Promise<boolean>;
  attempts?: number;
  delay(ms: number): Promise<void>;
}

export function validateLoopbackUrl(value: string): LoopbackEndpoint | null {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || !parsed.port) return null;
  const host = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" ? parsed.hostname : parsed.hostname === "[::1]" || parsed.hostname === "::1" ? "[::1]" : null;
  const port = Number(parsed.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { url: parsed.toString(), host, port };
}

export async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("Could not allocate a loopback port.")); return; }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export function parseLoopbackEndpoints(output: string): LoopbackEndpoint[] {
  const stripped = output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  const urls = stripped.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s)]*)?/g) ?? [];
  return [...new Map(urls.map((url) => {
    const endpoint = validateLoopbackUrl(url);
    return endpoint ? [endpoint.url, endpoint] : null;
  }).filter((value): value is [string, LoopbackEndpoint] => value !== null)).values()];
}

/** Known frameworks receive an endpoint; custom scripts must announce a loopback URL. */
export async function resolveStartedEndpoint(options: StartedEndpointOptions): Promise<StartedEndpointResolution> {
  const attempts = options.attempts ?? 120;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.hasExited()) return { status: "error", message: "The dev process exited before a loopback endpoint became available." };
    const candidates = options.expected ? [options.expected] : parseLoopbackEndpoints(options.output());
    const healthy: LoopbackEndpoint[] = [];
    for (const candidate of candidates) if (await options.healthCheck(candidate)) healthy.push(candidate);
    if (healthy.length === 1) return { status: "ready", endpoint: healthy[0] };
    if (healthy.length > 1) return { status: "choose", candidates: healthy };
    await options.delay(250);
  }
  const candidates = options.expected ? [options.expected] : parseLoopbackEndpoints(options.output());
  return candidates.length > 1
    ? { status: "choose", candidates }
    : { status: "error", message: options.expected ? `Timed out waiting for ${options.expected.url}.` : "The dev script did not announce one usable loopback URL. Attach an existing server explicitly." };
}

export function createDevCommandPlan(project: ProjectDescriptor, executable: string | null, scriptId: string, port: number): { ok: true; plan: DevCommandPlan } | { ok: false; message: string } {
  if (!project.runtime.executable || project.runtime.compatible === false) return { ok: false, message: project.runtime.diagnostic ?? "Choose a compatible installed Node executable before starting the dev server." };
  if (!project.packageManager.name || !executable) return { ok: false, message: "The selected project's package manager is not installed." };
  const script = project.scripts.find((candidate) => candidate.id === scriptId);
  if (!script) return { ok: false, message: "The selected dev script is no longer available." };
  if (!script.recommended) return { ok: false, message: "Only the project's dev script can be started automatically. Attach an existing server or choose an explicit custom command in a future session." };
  const adapterArgs = project.framework === "nextjs" ? ["--hostname", "127.0.0.1", "--port", String(port)]
    : project.framework === "vite" ? ["--host", "127.0.0.1", "--port", String(port), "--strictPort"]
      : project.framework === "cra" ? [] : [];
  const endpoint = project.framework === "unknown" ? null : { url: `http://127.0.0.1:${port}/`, host: "127.0.0.1" as const, port };
  // npm alone requires `--` to forward flags to a package script. pnpm/yarn/bun
  // forward trailing flags directly; adding npm's separator makes Next interpret
  // the first flag as a positional directory under pnpm.
  const args = project.packageManager.name === "pnpm" ? ["--dir", project.appRoot, "run", script.name, ...adapterArgs]
    : project.packageManager.name === "npm" ? ["--prefix", project.appRoot, "run", script.name, "--", ...adapterArgs]
      : project.packageManager.name === "yarn" ? ["--cwd", project.appRoot, "run", script.name, ...adapterArgs]
        : ["--cwd", project.appRoot, "run", script.name, ...adapterArgs];
  const env = { ...environmentWithRuntime(project.runtime.executable), BROWSER: "none", ...(project.framework === "cra" ? { HOST: "127.0.0.1", PORT: String(port) } : {}) };
  return { ok: true, plan: { executable, args, cwd: project.appRoot, env, displayCommand: `${path.basename(executable)} ${args.join(" ")}`, endpoint } };
}

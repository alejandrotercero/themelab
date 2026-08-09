import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import { promisify } from "node:util";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

const execFile = promisify(nodeExecFile);

export interface OwnedProcessSpec {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface OwnedProcess {
  child: ChildProcessWithoutNullStreams;
  pid: number;
  stop: () => Promise<void>;
}

export interface OwnedProcessDependencies {
  platform: NodeJS.Platform;
  spawn: typeof nodeSpawn;
  execFile: typeof execFile;
  kill: typeof process.kill;
  stopTimeoutMs: number;
}

const defaults: OwnedProcessDependencies = {
  platform: process.platform,
  spawn: nodeSpawn,
  execFile,
  kill: process.kill.bind(process),
  stopTimeoutMs: 5_000,
};

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

export function startOwnedProcess(spec: OwnedProcessSpec, overrides: Partial<OwnedProcessDependencies> = {}): OwnedProcess {
  const dependencies = { ...defaults, ...overrides };
  const options: SpawnOptionsWithoutStdio = {
    cwd: spec.cwd,
    env: spec.env,
    stdio: "pipe",
    windowsHide: true,
    // On POSIX this gives ThemeLab a private process group, allowing stop() to
    // terminate package-manager children without touching unrelated processes.
    detached: dependencies.platform !== "win32",
  };
  const child = dependencies.spawn(spec.executable, spec.args, options) as ChildProcessWithoutNullStreams;
  // A failed spawn reports asynchronously. Keep a listener installed even when
  // no PID was created so callers get the synchronous error without an uncaught
  // child-process error on the next tick.
  child.once("error", () => undefined);
  const pid = child.pid;
  if (!pid) throw new Error(`Could not start ${spec.executable}.`);
  let stopping: Promise<void> | null = null;
  const stop = async () => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (hasExited(child)) return;
      if (dependencies.platform === "win32") {
        try {
          await dependencies.execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
        } catch {
          // taskkill returns non-zero when a process has already exited.
        }
        await waitForExit(child, dependencies.stopTimeoutMs);
        return;
      }
      try {
        dependencies.kill(-pid, "SIGTERM");
      } catch {
        try { child.kill("SIGTERM"); } catch { /* already exited */ }
      }
      if (await waitForExit(child, dependencies.stopTimeoutMs)) return;
      try {
        dependencies.kill(-pid, "SIGKILL");
      } catch {
        try { child.kill("SIGKILL"); } catch { /* already exited */ }
      }
      await waitForExit(child, dependencies.stopTimeoutMs);
    })();
    return stopping;
  };
  return { child, pid, stop };
}

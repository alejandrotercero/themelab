import path from "node:path";
import os from "node:os";
import { access } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProjectDescriptor } from "./project-model.js";

const execFile = promisify(nodeExecFile);

export interface PackageManagerProbe {
  commandOnPath(manager: NonNullable<ProjectDescriptor["packageManager"]["name"]>): Promise<string | null>;
  loginShellCommand(manager: NonNullable<ProjectDescriptor["packageManager"]["name"]>): Promise<string | null>;
  knownCandidates(manager: NonNullable<ProjectDescriptor["packageManager"]["name"]>): Promise<string | null>;
}

export interface InstallPlan {
  projectId: string;
  executable: string;
  args: string[];
  cwd: string;
  displayCommand: string;
  lockfileMode: "frozen" | "mutable";
  mutatesLockfile: boolean;
}

export type InstallPlanningResult =
  | { ok: true; plan: InstallPlan }
  | { ok: false; message: string };

async function executableAt(candidate: string): Promise<string | null> {
  try { await access(candidate); return candidate; } catch { return null; }
}

async function commandOnPath(manager: NonNullable<ProjectDescriptor["packageManager"]["name"]>): Promise<string | null> {
  try {
    const { stdout } = await execFile("which", [manager], { encoding: "utf8" });
    return executableAt(stdout.trim());
  } catch { return null; }
}

async function loginShellCommand(manager: NonNullable<ProjectDescriptor["packageManager"]["name"]>): Promise<string | null> {
  const shells = process.platform === "win32" ? [] : ["/bin/zsh", "/bin/bash", "/bin/sh"];
  for (const shell of shells) {
    if (!await executableAt(shell)) continue;
    try {
      // manager is a closed union, never renderer or project supplied text.
      const { stdout } = await execFile(shell, ["-lic", `command -v ${manager}`], { encoding: "utf8", timeout: 3_000 });
      const resolved = await executableAt(stdout.trim().split(/\r?\n/)[0]);
      if (resolved) return resolved;
    } catch { /* try the next known shell */ }
  }
  return null;
}

async function knownCandidates(manager: NonNullable<ProjectDescriptor["packageManager"]["name"]>): Promise<string | null> {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".volta", "bin", manager),
    path.join(home, ".local", "share", "mise", "shims", manager),
    path.join(home, ".asdf", "shims", manager),
    ...(manager === "pnpm" ? [path.join(home, "Library", "pnpm", "pnpm"), path.join(home, ".local", "share", "pnpm", "pnpm")] : []),
    ...(manager === "bun" ? [path.join(home, ".bun", "bin", "bun")] : []),
  ];
  for (const candidate of candidates) {
    const executable = await executableAt(candidate);
    if (executable) return executable;
  }
  return null;
}

const defaultProbe: PackageManagerProbe = { commandOnPath, loginShellCommand, knownCandidates };

/** Child processes need the selected Node for package-manager script shims in GUI PATHs. */
export function environmentWithRuntime(executable: string | null, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!executable) return { ...inherited };
  const nodeDirectory = path.dirname(executable);
  const inheritedPath = inherited.PATH;
  return { ...inherited, PATH: [nodeDirectory, inheritedPath].filter((value): value is string => Boolean(value)).join(path.delimiter) };
}

export async function resolvePackageManagerExecutable(project: ProjectDescriptor, probe: PackageManagerProbe = defaultProbe): Promise<string | null> {
  const manager = project.packageManager.name;
  if (!manager) return null;
  const candidates = project.runtime.executable
    ? [path.join(path.dirname(project.runtime.executable), manager)]
    : [];
  for (const candidate of candidates) {
    const executable = await executableAt(candidate);
    if (executable) return executable;
  }
  return await probe.commandOnPath(manager) ?? await probe.loginShellCommand(manager) ?? await probe.knownCandidates(manager);
}

export function createInstallPlan(project: ProjectDescriptor, executable: string | null): InstallPlanningResult {
  if (project.runtime.compatible === false) return { ok: false, message: project.runtime.diagnostic ?? "Choose a compatible installed Node executable before installing dependencies." };
  if (!project.runtime.executable) return { ok: false, message: project.runtime.diagnostic ?? "Choose an installed Node executable before installing dependencies." };
  if (!project.packageManager.name) return { ok: false, message: "No supported package manager was detected for this app." };
  if (!executable) return { ok: false, message: `ThemeLab could not find an installed ${project.packageManager.name} executable. It will not install one automatically.` };
  const frozen = Boolean(project.packageManager.lockfile);
  const command = (() => {
    switch (project.packageManager.name) {
      case "npm": return frozen ? ["ci"] : ["install"];
      case "pnpm": return frozen ? ["install", "--frozen-lockfile"] : ["install"];
      case "yarn": return frozen ? ["install", project.packageManager.declaredVersion?.startsWith("1.") ? "--frozen-lockfile" : "--immutable"] : ["install"];
      case "bun": return frozen ? ["install", "--frozen-lockfile"] : ["install"];
    }
  })();
  return {
    ok: true,
    plan: {
      projectId: project.id,
      executable,
      args: command,
      cwd: project.installRoot,
      displayCommand: `${path.basename(executable)} ${command.join(" ")}`,
      lockfileMode: frozen ? "frozen" : "mutable",
      mutatesLockfile: !frozen,
    },
  };
}

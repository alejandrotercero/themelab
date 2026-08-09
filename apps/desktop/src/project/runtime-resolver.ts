import os from "node:os";
import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

import type { RuntimeResolution } from "./project-model.js";

const execFile = promisify(nodeExecFile);

type PackageJson = {
  engines?: { node?: unknown };
  volta?: { node?: unknown };
};

export interface RuntimeProbe {
  commandOnPath(): Promise<string | null>;
  loginShellCommand(): Promise<string | null>;
  knownShimCandidates(): Promise<Array<{ executable: string; source: Exclude<RuntimeResolution["source"], "path" | "login-shell" | "user" | null> }>>;
  version(executable: string): Promise<string | null>;
}

function parseVersion(value: string | null): [number, number, number] | null {
  if (!value) return null;
  const match = value.trim().replace(/^v/, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
}

function compare(actual: [number, number, number], target: [number, number, number]): number {
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== target[index]) return actual[index] > target[index] ? 1 : -1;
  }
  return 0;
}

function versionFromComparator(value: string): [number, number, number] | null {
  return parseVersion(value.replace(/^[<>=~^\s]*/, ""));
}

/** Covers the Node ranges normally accepted in package.json without executing a package manager. */
export function isNodeVersionCompatible(version: string, requirement: string | null): boolean | null {
  if (!requirement?.trim()) return null;
  const actual = parseVersion(version);
  if (!actual) return false;
  return requirement.split("||").map((value) => value.trim()).filter(Boolean).some((alternative) => {
    const comparators = alternative.replace(/\s+-\s+/g, " >=").split(/\s+/).filter(Boolean);
    return comparators.every((comparator) => {
      const target = versionFromComparator(comparator);
      if (!target) return false;
      if (/^(?:x|\*)$/i.test(comparator)) return true;
      if (/^\d+\.(?:x|\*)$/i.test(comparator)) return actual[0] === target[0];
      if (/^\d+\.\d+\.(?:x|\*)$/i.test(comparator)) return actual[0] === target[0] && actual[1] === target[1];
      if (/^\^/.test(comparator)) return actual[0] === target[0] && compare(actual, target) >= 0;
      if (/^~/.test(comparator)) return actual[0] === target[0] && actual[1] === target[1] && compare(actual, target) >= 0;
      if (/^>=/.test(comparator)) return compare(actual, target) >= 0;
      if (/^>/.test(comparator)) return compare(actual, target) > 0;
      if (/^<=/.test(comparator)) return compare(actual, target) <= 0;
      if (/^</.test(comparator)) return compare(actual, target) < 0;
      return actual[0] === target[0] && (comparator.split(".").length < 2 || actual[1] === target[1]) && (comparator.split(".").length < 3 || actual[2] === target[2]);
    });
  });
}

async function readRequirement(root: string, packageJson: PackageJson): Promise<Pick<RuntimeResolution, "requirement" | "requirementSource">> {
  // Volta pins the intended runtime and must win over generic version files.
  if (typeof packageJson.volta?.node === "string") return { requirement: packageJson.volta.node, requirementSource: "package-json-volta" };
  for (const [source, file] of [[".nvmrc", ".nvmrc"], [".node-version", ".node-version"], [".tool-versions", ".tool-versions"]] as const) {
    try {
      const content = (await readFile(path.join(root, file), "utf8")).trim();
      const requirement = source === ".tool-versions" ? content.split(/\r?\n/).find((line) => line.trim().startsWith("nodejs "))?.trim().split(/\s+/)[1] : content;
      if (requirement) return { requirement, requirementSource: source };
    } catch {
      // Missing version files are normal.
    }
  }
  if (typeof packageJson.engines?.node === "string") return { requirement: packageJson.engines.node, requirementSource: "package-json-engines" };
  return { requirement: null, requirementSource: null };
}

async function executableAt(candidate: string | null | undefined): Promise<string | null> {
  if (!candidate || !path.isAbsolute(candidate)) return null;
  try { await access(candidate); return candidate; } catch { return null; }
}

async function pathProbe(): Promise<string | null> {
  try {
    const { stdout } = await execFile("which", ["node"], { encoding: "utf8" });
    return executableAt(stdout.trim());
  } catch { return null; }
}

async function loginShellProbe(): Promise<string | null> {
  const shells = process.platform === "win32" ? [] : ["/bin/zsh", "/bin/bash", "/bin/sh"];
  for (const shell of shells) {
    if (!await executableAt(shell)) continue;
    try {
      // Constant command, no project content or environment interpolation.
      const { stdout } = await execFile(shell, ["-lic", "command -v node"], { encoding: "utf8", timeout: 3_000 });
      const executable = await executableAt(stdout.trim().split(/\r?\n/)[0]);
      if (executable) return executable;
    } catch { /* next known shell */ }
  }
  return null;
}

async function knownShimProbe(): Promise<Array<{ executable: string; source: "volta" | "mise" | "asdf" | "nvm" | "fnm" }>> {
  const home = os.homedir();
  const candidates: Array<{ executable: string; source: "volta" | "mise" | "asdf" | "nvm" | "fnm" }> = [
    { executable: path.join(home, ".volta", "bin", "node"), source: "volta" },
    { executable: path.join(home, ".local", "share", "mise", "shims", "node"), source: "mise" },
    { executable: path.join(home, ".asdf", "shims", "node"), source: "asdf" },
  ];
  try {
    const versions = await readdir(path.join(home, ".nvm", "versions", "node"), { withFileTypes: true });
    for (const entry of versions.filter((value) => value.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
      candidates.push({ executable: path.join(home, ".nvm", "versions", "node", entry.name, "bin", "node"), source: "nvm" });
    }
  } catch { /* nvm is optional */ }
  try {
    const versions = await readdir(path.join(home, ".local", "share", "fnm", "node-versions"), { withFileTypes: true });
    for (const entry of versions.filter((value) => value.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
      candidates.push({ executable: path.join(home, ".local", "share", "fnm", "node-versions", entry.name, "installation", "bin", "node"), source: "fnm" });
    }
  } catch { /* fnm is optional */ }
  const result: Array<{ executable: string; source: "volta" | "mise" | "asdf" | "nvm" | "fnm" }> = [];
  for (const candidate of candidates) {
    const executable = await executableAt(candidate.executable);
    if (executable) result.push({ ...candidate, executable });
  }
  return result;
}

const defaultProbe: RuntimeProbe = {
  commandOnPath: pathProbe,
  loginShellCommand: loginShellProbe,
  knownShimCandidates: knownShimProbe,
  async version(executable) {
    try { return (await execFile(executable, ["--version"], { encoding: "utf8", timeout: 3_000 })).stdout.trim(); } catch { return null; }
  },
};

export async function resolveRuntime(root: string, packageJson: PackageJson, preferredExecutable?: string, probe: RuntimeProbe = defaultProbe): Promise<RuntimeResolution> {
  const requirement = await readRequirement(root, packageJson);
  const candidates: Array<{ executable: string | null; source: RuntimeResolution["source"] }> = [
    { executable: await executableAt(preferredExecutable), source: "user" },
    { executable: await probe.commandOnPath(), source: "path" },
    { executable: await probe.loginShellCommand(), source: "login-shell" },
    ...(await probe.knownShimCandidates()).map((candidate) => ({ ...candidate })),
  ];
  for (const candidate of candidates) {
    if (!candidate.executable) continue;
    const version = await probe.version(candidate.executable);
    if (!version) continue;
    const compatible = isNodeVersionCompatible(version, requirement.requirement);
    return { ...requirement, executable: candidate.executable, version, compatible, source: candidate.source, diagnostic: compatible === false ? `Project requires Node ${requirement.requirement}; selected Node is ${version}.` : null };
  }
  return { ...requirement, executable: null, version: null, compatible: null, source: null, diagnostic: "Node was not found. Choose an existing Node executable; ThemeLab will not download one." };
}

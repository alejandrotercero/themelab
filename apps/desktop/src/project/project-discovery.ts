import crypto from "node:crypto";
import path from "node:path";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveRuntime } from "./runtime-resolver.js";
import type { DependencyStatus, DevScriptCandidate, PackageManagerName, PackageManagerResolution, ProjectCandidate, ProjectDescriptor, ProjectDiagnostic, ProjectFramework, ProjectInspection } from "./project-model.js";

type PackageJson = {
  name?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  packageManager?: unknown;
  engines?: { node?: unknown };
  volta?: { node?: unknown };
};

const LOCKFILES: Array<[PackageManagerName, string]> = [["pnpm", "pnpm-lock.yaml"], ["npm", "package-lock.json"], ["npm", "npm-shrinkwrap.json"], ["yarn", "yarn.lock"], ["bun", "bun.lock"], ["bun", "bun.lockb"]];
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo"]);
const execFile = promisify(nodeExecFile);

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

async function parsePackage(root: string): Promise<PackageJson | null> {
  try { return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as PackageJson; } catch { return null; }
}

function isReactPackage(pkg: PackageJson): boolean {
  return Boolean(pkg.dependencies?.react || pkg.devDependencies?.react);
}

function frameworkFor(pkg: PackageJson): ProjectFramework {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return "nextjs";
  if (deps.vite) return "vite";
  if (deps["react-scripts"]) return "cra";
  return "unknown";
}

function scriptsFor(pkg: PackageJson): DevScriptCandidate[] {
  return Object.entries(pkg.scripts ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, command]) => ({ id: name, name, command, recommended: name === "dev" }));
}

async function findReactCandidates(root: string, depth = 0): Promise<ProjectCandidate[]> {
  if (depth > 4) return [];
  const pkg = await parsePackage(root);
  const own = pkg && isReactPackage(pkg) ? [{ appRoot: root, displayName: typeof pkg.name === "string" ? pkg.name : path.basename(root), framework: frameworkFor(pkg) }] : [];
  try {
    const entries = await readdir(root, { withFileTypes: true, encoding: "utf8" });
    const nested = await Promise.all(entries.filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)).map((entry) => findReactCandidates(path.join(root, entry.name), depth + 1)));
    return [...own, ...nested.flat()];
  } catch {
    return own;
  }
}

async function installRootFor(workspaceRoot: string, appRoot: string): Promise<{ installRoot: string | null; lockfile: string | null; manager: PackageManagerName | null }> {
  let current = appRoot;
  while (true) {
    for (const [manager, lockfile] of LOCKFILES) {
      if (await exists(path.join(current, lockfile))) return { installRoot: current, lockfile, manager };
    }
    if (current === workspaceRoot) break;
    const parent = path.dirname(current);
    if (parent === current || (parent !== workspaceRoot && !parent.startsWith(`${workspaceRoot}${path.sep}`))) break;
    current = parent;
  }
  return { installRoot: appRoot, lockfile: null, manager: null };
}

async function externalInstallRootFor(workspaceRoot: string): Promise<string | null> {
  let current = path.dirname(workspaceRoot);
  while (current !== path.dirname(current)) {
    for (const [, lockfile] of LOCKFILES) if (await exists(path.join(current, lockfile))) return current;
    current = path.dirname(current);
  }
  return null;
}

function managerFor(pkg: PackageJson, discovered: Awaited<ReturnType<typeof installRootFor>>): PackageManagerResolution {
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager : null;
  const match = declared?.match(/^(pnpm|npm|yarn|bun)@(.+)$/);
  if (match) return { name: match[1] as PackageManagerName, declaredVersion: match[2], source: "package-json", lockfile: discovered.lockfile };
  if (discovered.manager) return { name: discovered.manager, declaredVersion: null, source: "lockfile", lockfile: discovered.lockfile };
  return { name: null, declaredVersion: null, source: null, lockfile: null };
}

async function dependencyStatus(workspaceRoot: string, appRoot: string, packageJson: PackageJson, runtimeExecutable: string | null): Promise<DependencyStatus> {
  if (!runtimeExecutable) return "blocked";
  const required = ["react", ...(frameworkFor(packageJson) === "nextjs" ? ["next"] : frameworkFor(packageJson) === "vite" ? ["vite"] : frameworkFor(packageJson) === "cra" ? ["react-scripts"] : [])];
  const check = "const packages = JSON.parse(process.argv[1]); const root = process.argv[2]; const workspace = process.argv[3]; const { createRequire } = require('node:module'); const path = require('node:path'); const resolver = createRequire(path.join(root, 'package.json')); try { for (const name of packages) { const resolved = resolver.resolve(name + '/package.json'); if (!resolved.startsWith(workspace + path.sep)) throw new Error('dependency resolved outside workspace'); } process.exit(0); } catch { process.exit(1); }";
  try {
    await execFile(runtimeExecutable, ["-e", check, JSON.stringify(required), appRoot, workspaceRoot], { encoding: "utf8", timeout: 3_000 });
    return "ready";
  } catch { return "missing"; }
}

export async function inspectProject(selectedRoot: string, options: { appRoot?: string; nodeExecutable?: string } = {}): Promise<ProjectInspection> {
  const workspaceRoot = await realpath(selectedRoot);
  const selectedPackage = await parsePackage(workspaceRoot);
  const candidates = selectedPackage && isReactPackage(selectedPackage)
    ? [{ appRoot: workspaceRoot, displayName: typeof selectedPackage.name === "string" ? selectedPackage.name : path.basename(workspaceRoot), framework: frameworkFor(selectedPackage) }]
    : await findReactCandidates(workspaceRoot);
  if (!candidates.length) return { status: "unsupported", workspaceRoot, diagnostics: [{ code: "no-app-found", message: "No React package was found inside the selected workspace." }] };
  const appRoot = options.appRoot ? await realpath(options.appRoot) : candidates.length === 1 ? candidates[0].appRoot : null;
  if (!appRoot) return { status: "needs-app-choice", workspaceRoot, candidates, diagnostics: [{ code: "app-choice-required", message: "Choose which React app in this workspace ThemeLab should run." }] };
  if (appRoot !== workspaceRoot && !appRoot.startsWith(`${workspaceRoot}${path.sep}`)) return { status: "unsupported", workspaceRoot, diagnostics: [{ code: "unsupported", message: "The selected app is outside the authorized workspace." }] };
  const pkg = await parsePackage(appRoot);
  if (!pkg || !isReactPackage(pkg)) return { status: "unsupported", workspaceRoot, diagnostics: [{ code: "unsupported", message: "The selected app is not a React package." }] };
  const installed = await installRootFor(workspaceRoot, appRoot);
  const manager = managerFor(pkg, installed);
  const runtime = await resolveRuntime(appRoot, pkg, options.nodeExecutable);
  const diagnostics: ProjectDiagnostic[] = [];
  if (!manager.name) diagnostics.push({ code: "dependencies-unavailable", message: "No supported package manager was detected for this app." });
  if (!manager.name && await externalInstallRootFor(workspaceRoot)) diagnostics.push({ code: "install-root-outside-workspace", message: "A controlling lockfile appears above the selected folder. Reopen the monorepo root before installing dependencies." });
  if (!runtime.executable) diagnostics.push({ code: "runtime-unavailable", message: runtime.diagnostic ?? "Node is unavailable." });
  if (runtime.compatible === false) diagnostics.push({ code: "runtime-incompatible", message: runtime.diagnostic ?? "Node does not satisfy this project." });
  const descriptor: ProjectDescriptor = {
    id: crypto.createHash("sha256").update(`${workspaceRoot}\0${appRoot}`).digest("hex").slice(0, 16),
    workspaceRoot,
    appRoot,
    installRoot: installed.installRoot ?? appRoot,
    displayName: typeof pkg.name === "string" ? pkg.name : path.basename(appRoot),
    framework: frameworkFor(pkg),
    packageJsonPath: path.join(appRoot, "package.json"),
    packageManager: manager,
    runtime,
    scripts: scriptsFor(pkg),
    dependencyStatus: await dependencyStatus(workspaceRoot, appRoot, pkg, runtime.executable),
    diagnostics,
  };
  return { status: "ready", project: descriptor };
}

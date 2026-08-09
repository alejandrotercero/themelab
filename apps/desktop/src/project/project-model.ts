export type ProjectFramework = "nextjs" | "vite" | "cra" | "unknown";
export type PackageManagerName = "pnpm" | "npm" | "yarn" | "bun";
export type DependencyStatus = "unknown" | "ready" | "missing" | "blocked" | "error";

export interface PackageManagerResolution {
  name: PackageManagerName | null;
  declaredVersion: string | null;
  source: "package-json" | "lockfile" | "fallback" | null;
  lockfile: string | null;
}

export interface RuntimeResolution {
  requirement: string | null;
  requirementSource: ".nvmrc" | ".node-version" | ".tool-versions" | "package-json-volta" | "package-json-engines" | null;
  executable: string | null;
  version: string | null;
  compatible: boolean | null;
  source: "path" | "login-shell" | "volta" | "mise" | "asdf" | "nvm" | "fnm" | "user" | null;
  diagnostic: string | null;
}

export interface DevScriptCandidate {
  id: string;
  name: string;
  command: string;
  recommended: boolean;
}

export interface ProjectDiagnostic {
  code: "unsupported" | "invalid-package-json" | "no-app-found" | "app-choice-required" | "install-root-outside-workspace" | "runtime-unavailable" | "runtime-incompatible" | "dependencies-unavailable";
  message: string;
}

export interface ProjectCandidate {
  appRoot: string;
  displayName: string;
  framework: ProjectFramework;
}

export interface ProjectDescriptor {
  id: string;
  workspaceRoot: string;
  appRoot: string;
  installRoot: string;
  displayName: string;
  framework: ProjectFramework;
  packageJsonPath: string;
  packageManager: PackageManagerResolution;
  runtime: RuntimeResolution;
  scripts: DevScriptCandidate[];
  dependencyStatus: DependencyStatus;
  diagnostics: ProjectDiagnostic[];
}

/** Persisted, non-secret project identity. It is always re-inspected before use. */
export interface RecentProjectRecord {
  id: string;
  workspaceRoot: string;
  appRoot: string | null;
  installRoot: string | null;
  nodeExecutable: string | null;
  displayName: string;
  lastOpenedAt: number;
  availability: "available" | "missing";
}

export interface ProjectStoreState {
  version: 2;
  recentProjects: RecentProjectRecord[];
}

export type ProjectInspection =
  | { status: "ready"; project: ProjectDescriptor }
  | { status: "needs-app-choice"; workspaceRoot: string; candidates: ProjectCandidate[]; diagnostics: ProjectDiagnostic[] }
  | { status: "unsupported"; workspaceRoot: string; diagnostics: ProjectDiagnostic[] };

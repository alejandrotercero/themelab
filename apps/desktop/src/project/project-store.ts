import { mkdir, realpath, rename, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectDescriptor, ProjectStoreState, RecentProjectRecord } from "./project-model.js";

const MAX_RECENTS = 10;

type LegacyState = { version: 1; recentRoots: string[] };
type PersistedState = Partial<ProjectStoreState> | Partial<LegacyState>;

function empty(): ProjectStoreState {
  return { version: 2, recentProjects: [] };
}

function idFor(workspaceRoot: string, appRoot: string | null): string {
  // The descriptor has a stable hash already; this fallback is only used for migrated v1 records.
  return Buffer.from(`${workspaceRoot}\0${appRoot ?? ""}`).toString("base64url").slice(0, 24);
}

export function migrateProjectStore(value: unknown): ProjectStoreState {
  if (!value || typeof value !== "object") return empty();
  const parsed = value as PersistedState;
  if (parsed.version === 2 && "recentProjects" in parsed && Array.isArray(parsed.recentProjects)) {
    const recentProjects = parsed.recentProjects.filter((entry): entry is RecentProjectRecord => Boolean(entry) && typeof entry === "object" && typeof (entry as RecentProjectRecord).id === "string" && typeof (entry as RecentProjectRecord).workspaceRoot === "string" && typeof (entry as RecentProjectRecord).displayName === "string" && typeof (entry as RecentProjectRecord).lastOpenedAt === "number" && ((entry as RecentProjectRecord).availability === "available" || (entry as RecentProjectRecord).availability === "missing")).map((entry) => ({ ...entry, nodeExecutable: typeof entry.nodeExecutable === "string" ? entry.nodeExecutable : null }));
    return { version: 2, recentProjects: recentProjects.slice(0, MAX_RECENTS) };
  }
  if (parsed.version === 1 && "recentRoots" in parsed && Array.isArray(parsed.recentRoots) && parsed.recentRoots.every((root) => typeof root === "string")) {
    return { version: 2, recentProjects: parsed.recentRoots.slice(0, MAX_RECENTS).map((workspaceRoot) => ({ id: idFor(workspaceRoot, null), workspaceRoot, appRoot: null, installRoot: null, nodeExecutable: null, displayName: path.basename(workspaceRoot) || workspaceRoot, lastOpenedAt: 0, availability: "missing" })) };
  }
  return empty();
}

export async function readProjectStore(filePath: string): Promise<ProjectStoreState> {
  try { return migrateProjectStore(JSON.parse(await readFile(filePath, "utf8"))); } catch { return empty(); }
}

export async function writeProjectStore(filePath: string, state: ProjectStoreState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, filePath);
}

export async function validateRecentProjects(state: ProjectStoreState): Promise<ProjectStoreState> {
  const recentProjects = await Promise.all(state.recentProjects.map(async (record) => {
    try {
      const workspaceRoot = await realpath(record.workspaceRoot);
      const appRoot = record.appRoot ? await realpath(record.appRoot) : null;
      const installRoot = record.installRoot ? await realpath(record.installRoot) : null;
      const nodeExecutable = record.nodeExecutable ? await realpath(record.nodeExecutable).catch(() => null) : null;
      return { ...record, workspaceRoot, appRoot, installRoot, nodeExecutable, availability: "available" as const };
    } catch { return { ...record, availability: "missing" as const }; }
  }));
  return { version: 2, recentProjects };
}

export function rememberProject(state: ProjectStoreState, project: Pick<ProjectDescriptor, "id" | "workspaceRoot" | "appRoot" | "installRoot" | "displayName" | "runtime"> | { workspaceRoot: string; appRoot?: null; installRoot?: null; displayName?: string; nodeExecutable?: string | null }): ProjectStoreState {
  const record: RecentProjectRecord = {
    id: "id" in project ? project.id : idFor(project.workspaceRoot, project.appRoot ?? null),
    workspaceRoot: project.workspaceRoot,
    appRoot: project.appRoot ?? null,
    installRoot: project.installRoot ?? null,
    nodeExecutable: "runtime" in project ? project.runtime.executable : project.nodeExecutable ?? null,
    displayName: project.displayName ?? path.basename(project.workspaceRoot),
    lastOpenedAt: Date.now(),
    availability: "available",
  };
  return { version: 2, recentProjects: [record, ...state.recentProjects.filter((entry) => entry.id !== record.id && entry.workspaceRoot !== record.workspaceRoot)].slice(0, MAX_RECENTS) };
}

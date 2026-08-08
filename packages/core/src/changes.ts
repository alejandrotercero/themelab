import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export interface FileChange {
  /** Workspace-relative POSIX path. */
  path: string
  /** SHA-256 of the source content used when this proposal was created. */
  baseHash: string
  before: string
  after: string
}

export interface ChangeProposal {
  id: string
  createdAt: number
  label: string
  origin: ChangeOrigin
  operation: string | null
  selectionKey: string | null
  files: FileChange[]
}

export type ChangeOrigin = "theme" | "inspector" | "agent" | "other"

export interface ProposalMetadata {
  origin?: ChangeOrigin
  operation?: string
  selectionKey?: string
}

export interface ApplyResult {
  proposalId: string
  recoveryPath: string
  files: string[]
}

export interface UndoResult {
  proposalId: string
  files: string[]
}

/** A persisted transaction that can be shown after the desktop process restarts. */
export interface RecoveryEntry {
  proposalId: string
  label: string
  createdAt: number
  origin: ChangeOrigin
  operation: string | null
  selectionKey: string | null
  files: string[]
  /** Whether the transaction can safely be undone without replacing an external edit. */
  status: "undoable" | "undone" | "conflicted"
}

export class ProposalConflictError extends Error {
  constructor(public readonly files: string[]) {
    super(`Source changed since this proposal was generated: ${files.join(", ")}`)
    this.name = "ProposalConflictError"
  }
}

export class ProposalPolicyError extends Error {}

export class UndoConflictError extends Error {
  constructor(public readonly files: string[]) {
    super(`Source changed after this proposal was applied: ${files.join(", ")}`)
    this.name = "UndoConflictError"
  }
}

const MAX_FILE_BYTES = 2 * 1024 * 1024
const DENIED_SEGMENTS = new Set([".git", ".themelab", "node_modules", "dist", "build", ".next", "coverage"])

export function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function createProposal(label: string, files: Array<{ path: string; before: string; after: string }>, metadata: ProposalMetadata = {}): ChangeProposal {
  const seen = new Set<string>()
  const changes = files
    .filter((file) => file.before !== file.after)
    .map((file) => {
      const normalizedPath = normalizeRelativePath(file.path)
      if (seen.has(normalizedPath)) throw new Error(`A proposal can only change a file once: ${normalizedPath}`)
      seen.add(normalizedPath)
      return { path: normalizedPath, baseHash: contentHash(file.before), before: file.before, after: file.after }
    })
  if (!changes.length) throw new Error("A proposal must contain at least one changed file")
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    label,
    origin: metadata.origin ?? "other",
    operation: metadata.operation ?? null,
    selectionKey: metadata.selectionKey ?? null,
    files: changes,
  }
}

export function proposalDiff(proposal: ChangeProposal): string {
  return proposal.files.map((file) => unifiedDiff(file.path, file.before, file.after)).join("\n")
}

/**
 * Verifies all snapshots before changing anything, saves originals to a project-local
 * recovery record, then atomically replaces each file. A failed write is rolled back
 * from its in-memory originals before the error escapes.
 */
export async function applyProposal(workspaceRoot: string, proposal: ChangeProposal): Promise<ApplyResult> {
  const root = await realpath(path.resolve(workspaceRoot))
  const resolved = await Promise.all(proposal.files.map(async (file) => ({ file, target: await resolveWorkspaceFile(root, file.path) })))
  const current = await Promise.all(resolved.map(async ({ file, target }) => {
    const content = await readFile(target, "utf8")
    ensureFileSize(file.path, content)
    ensureFileSize(file.path, file.after)
    return { file, target, content }
  }))
  const conflicted = current.filter(({ file, content }) => contentHash(content) !== file.baseHash).map(({ file }) => file.path)
  if (conflicted.length) throw new ProposalConflictError(conflicted)

  const recoveryPath = path.join(root, ".themelab", "recovery", proposal.id)
  await mkdir(recoveryPath, { recursive: true })
  await writeFile(path.join(recoveryPath, "manifest.json"), JSON.stringify({
    proposalId: proposal.id,
    label: proposal.label,
    createdAt: proposal.createdAt,
    origin: proposal.origin,
    operation: proposal.operation,
    selectionKey: proposal.selectionKey,
    files: proposal.files.map(({ path: filePath, baseHash, after }) => ({ path: filePath, baseHash, afterHash: contentHash(after) })),
  }, null, 2), "utf8")

  try {
    for (const { file, target, content } of current) {
      const backup = resolveInsideRoot(recoveryPath, file.path)
      await mkdir(path.dirname(backup), { recursive: true })
      await writeFile(backup, content, "utf8")
      const temporary = `${target}.themelab-${proposal.id}.tmp`
      await writeFile(temporary, file.after, "utf8")
      await rename(temporary, target)
    }
  } catch (error) {
    await Promise.all(current.map(async ({ target, content }) => writeFile(target, content, "utf8")))
    throw error
  }

  return { proposalId: proposal.id, recoveryPath, files: proposal.files.map((file) => file.path) }
}

export async function discardRecovery(workspaceRoot: string, proposalId: string): Promise<void> {
  const root = path.resolve(workspaceRoot)
  await rm(path.join(root, ".themelab", "recovery", proposalId), { recursive: true, force: true })
}

/**
 * Reads the bounded, project-local recovery store. Invalid or incomplete records are ignored so
 * a manually deleted recovery folder never prevents the rest of the workspace from opening.
 */
export async function listRecovery(workspaceRoot: string): Promise<RecoveryEntry[]> {
  const root = await realpath(path.resolve(workspaceRoot))
  const recoveryRoot = path.join(root, ".themelab", "recovery")
  const entries = await readdir(recoveryRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null
    throw error
  })
  if (!entries) return []
  const recoveries = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    if (!/^[0-9a-f-]{36}$/i.test(entry.name)) return null
    try {
      const manifestPath = path.join(recoveryRoot, entry.name, "manifest.json")
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RecoveryManifest
      if (manifest.proposalId !== entry.name || !isRecoveryManifest(manifest)) return null
      const files = await Promise.all(manifest.files.map(async (file) => {
        const current = await readFile(await resolveWorkspaceFile(root, file.path), "utf8")
        return { baseHash: file.baseHash, afterHash: file.afterHash, currentHash: contentHash(current), path: file.path }
      }))
      const status = files.every((file) => file.currentHash === file.afterHash)
        ? "undoable"
        : files.every((file) => file.currentHash === file.baseHash)
          ? "undone"
          : "conflicted"
      return { proposalId: manifest.proposalId, label: manifest.label, createdAt: manifest.createdAt, origin: manifest.origin ?? "other", operation: manifest.operation ?? null, selectionKey: manifest.selectionKey ?? null, files: files.map((file) => file.path), status } satisfies RecoveryEntry
    } catch {
      return null
    }
  }))
  return recoveries.filter((entry): entry is RecoveryEntry => entry !== null).sort((left, right) => right.createdAt - left.createdAt)
}

/** Restores a ThemeLab transaction only when no external edit has happened since apply. */
export async function undoProposal(workspaceRoot: string, proposalId: string): Promise<UndoResult> {
  const root = await realpath(path.resolve(workspaceRoot))
  const recoveryPath = path.join(root, ".themelab", "recovery", proposalId)
  const manifest = JSON.parse(await readFile(path.join(recoveryPath, "manifest.json"), "utf8")) as RecoveryManifest
  if (manifest.proposalId !== proposalId || !isRecoveryManifest(manifest)) {
    throw new ProposalPolicyError("Invalid recovery manifest")
  }
  const entries = await Promise.all(manifest.files.map(async (file) => {
    const target = await resolveWorkspaceFile(root, file.path)
    const before = await readFile(resolveInsideRoot(recoveryPath, file.path), "utf8")
    const current = await readFile(target, "utf8")
    return { file, target, before, current }
  }))
  const conflicted = entries.filter(({ file, current }) => contentHash(current) !== file.afterHash).map(({ file }) => file.path)
  if (conflicted.length) throw new UndoConflictError(conflicted)
  try {
    for (const { target, before } of entries) {
      const temporary = `${target}.themelab-undo-${proposalId}.tmp`
      await writeFile(temporary, before, "utf8")
      await rename(temporary, target)
    }
  } catch (error) {
    await Promise.all(entries.map(({ target, current }) => writeFile(target, current, "utf8")))
    throw error
  }
  return { proposalId, files: entries.map(({ file }) => file.path) }
}

interface RecoveryManifest {
  proposalId: string
  label: string
  createdAt: number
  origin?: ChangeOrigin
  operation?: string | null
  selectionKey?: string | null
  files: Array<{ path: string; baseHash: string; afterHash: string }>
}

function isRecoveryManifest(value: RecoveryManifest): boolean {
  return typeof value.label === "string" && Number.isFinite(value.createdAt) && (value.origin === undefined || isChangeOrigin(value.origin))
    && (value.operation === undefined || value.operation === null || typeof value.operation === "string")
    && (value.selectionKey === undefined || value.selectionKey === null || typeof value.selectionKey === "string") && Array.isArray(value.files)
    && value.files.every((file) => typeof file.path === "string" && typeof file.baseHash === "string" && typeof file.afterHash === "string")
}

function isChangeOrigin(value: unknown): value is ChangeOrigin {
  return value === "theme" || value === "inspector" || value === "agent" || value === "other"
}

function normalizeRelativePath(value: string): string {
  if (!value || path.isAbsolute(value)) throw new Error("Proposal paths must be workspace-relative")
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"))
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("Proposal paths must stay inside the workspace")
  const segments = normalized.split("/")
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment) || segment === ".env" || segment.startsWith(".env."))) {
    throw new ProposalPolicyError(`ThemeLab cannot edit protected path: ${normalized}`)
  }
  return normalized
}

function resolveInsideRoot(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Proposal path is outside the workspace")
  return target
}

async function resolveWorkspaceFile(root: string, relativePath: string): Promise<string> {
  const normalized = normalizeRelativePath(relativePath)
  const target = resolveInsideRoot(root, normalized)
  const info = await lstat(target)
  if (!info.isFile()) throw new ProposalPolicyError(`ThemeLab can only edit regular files: ${normalized}`)
  const canonicalTarget = await realpath(target)
  if (canonicalTarget !== root && !canonicalTarget.startsWith(`${root}${path.sep}`)) {
    throw new ProposalPolicyError(`ThemeLab cannot follow a symlink outside the workspace: ${normalized}`)
  }
  return canonicalTarget
}

function ensureFileSize(filePath: string, content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new ProposalPolicyError(`ThemeLab cannot edit files larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB: ${filePath}`)
  }
}

function unifiedDiff(filePath: string, before: string, after: string): string {
  const oldLines = before.split("\n")
  const newLines = after.split("\n")
  const matrix = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1))
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      matrix[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? matrix[oldIndex + 1][newIndex + 1] + 1
        : Math.max(matrix[oldIndex + 1][newIndex], matrix[oldIndex][newIndex + 1])
    }
  }
  const body: string[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      body.push(` ${oldLines[oldIndex++]}`)
      newIndex++
    } else if (newIndex < newLines.length && (oldIndex === oldLines.length || matrix[oldIndex][newIndex + 1] >= matrix[oldIndex + 1][newIndex])) {
      body.push(`+${newLines[newIndex++]}`)
    } else {
      body.push(`-${oldLines[oldIndex++]}`)
    }
  }
  return [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...body].join("\n")
}

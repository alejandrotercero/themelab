import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { applyProposal, createProposal, listRecovery, ProposalConflictError, ProposalPolicyError, proposalDiff, undoProposal, UndoConflictError } from "../changes.js"

const workspaces: string[] = []
afterEach(async () => Promise.all(workspaces.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

async function workspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "themelab-core-"))
  workspaces.push(directory)
  return directory
}

describe("change proposals", () => {
  it("renders a reviewable diff and applies a guarded multi-file write with recovery", async () => {
    const root = await workspace()
    await writeFile(path.join(root, "a.css"), ":root { --primary: red; }\n")
    await writeFile(path.join(root, "b.tsx"), "export const title = 'old'\n")
    const proposal = createProposal("Tune theme", [
      { path: "a.css", before: ":root { --primary: red; }\n", after: ":root { --primary: blue; }\n" },
      { path: "b.tsx", before: "export const title = 'old'\n", after: "export const title = 'new'\n" },
    ])
    expect(proposalDiff(proposal)).toContain("+export const title = 'new'")
    const result = await applyProposal(root, proposal)
    await expect(readFile(path.join(root, "a.css"), "utf8")).resolves.toContain("blue")
    await expect(readFile(path.join(result.recoveryPath, "a.css"), "utf8")).resolves.toContain("red")
  })

  it("rejects stale source without writing any file", async () => {
    const root = await workspace()
    const target = path.join(root, "tokens.css")
    await writeFile(target, "before\n")
    const proposal = createProposal("Change token", [{ path: "tokens.css", before: "before\n", after: "after\n" }])
    await writeFile(target, "external change\n")
    await expect(applyProposal(root, proposal)).rejects.toBeInstanceOf(ProposalConflictError)
    await expect(readFile(target, "utf8")).resolves.toBe("external change\n")
  })

  it("undoes only an unchanged ThemeLab transaction", async () => {
    const root = await workspace()
    const target = path.join(root, "tokens.css")
    await writeFile(target, "before\n")
    const proposal = createProposal("Change token", [{ path: "tokens.css", before: "before\n", after: "after\n" }])
    await applyProposal(root, proposal)
    await expect(undoProposal(root, proposal.id)).resolves.toMatchObject({ proposalId: proposal.id, files: ["tokens.css"] })
    await expect(readFile(target, "utf8")).resolves.toBe("before\n")

    await applyProposal(root, proposal)
    await writeFile(target, "external change\n")
    await expect(undoProposal(root, proposal.id)).rejects.toBeInstanceOf(UndoConflictError)
    await expect(readFile(target, "utf8")).resolves.toBe("external change\n")
  })

  it("lists persisted recovery entries and reports whether they are still undoable", async () => {
    const root = await workspace()
    const target = path.join(root, "tokens.css")
    await writeFile(target, "before\n")
    const proposal = createProposal("Persistent change", [{ path: "tokens.css", before: "before\n", after: "after\n" }], { origin: "theme", operation: "token-update", selectionKey: "light:primary" })
    await applyProposal(root, proposal)
    await expect(listRecovery(root)).resolves.toEqual([expect.objectContaining({ proposalId: proposal.id, label: "Persistent change", origin: "theme", operation: "token-update", selectionKey: "light:primary", files: ["tokens.css"], status: "undoable" })])
    await undoProposal(root, proposal.id)
    await expect(listRecovery(root)).resolves.toEqual([expect.objectContaining({ proposalId: proposal.id, status: "undone" })])
  })

  it("rejects protected targets and symlinks that leave the workspace", async () => {
    const root = await workspace()
    const outside = await workspace()
    const externalFile = path.join(outside, "external.css")
    await writeFile(externalFile, "before\n")
    await symlink(externalFile, path.join(root, "linked.css"))
    const linked = createProposal("Unsafe", [{ path: "linked.css", before: "before\n", after: "after\n" }])
    await expect(applyProposal(root, linked)).rejects.toBeInstanceOf(ProposalPolicyError)
    await expect(readFile(externalFile, "utf8")).resolves.toBe("before\n")
    expect(() => createProposal("Protected", [{ path: ".git/config", before: "a", after: "b" }])).toThrow(ProposalPolicyError)
  })
})

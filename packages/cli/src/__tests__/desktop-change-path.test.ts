import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { applyProposal, createProposal, undoProposal } from "@themelab/core"
import { executeBatch } from "../batch-transform.js"

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createProject(kind: "next" | "vite") {
  const root = await mkdtemp(path.join(tmpdir(), `themelab-${kind}-`))
  workspaces.push(root)
  const relativeFile = kind === "next" ? "app/page.tsx" : "src/App.tsx"
  const source = [
    'export default function App() {',
    '  return <main className="bg-white p-4">ThemeLab fixture</main>',
    '}',
    '',
  ].join("\n")
  const target = path.join(root, relativeFile)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, source, "utf8")
  return { root, relativeFile, source, target }
}

describe("desktop Tailwind change path", () => {
  for (const kind of ["next", "vite"] as const) {
    it(`proposes, applies, and undoes a ${kind} Tailwind edit without a direct transform write`, async () => {
      const project = await createProject(kind)
      const result = executeBatch([{
        op: "updateClass",
        file: project.relativeFile,
        line: 2,
        col: 9,
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }], project.root, { write: false })

      expect(result.results).toEqual([expect.objectContaining({ success: true })])
      expect(await readFile(project.target, "utf8")).toBe(project.source)
      expect(result.undoEntries).toHaveLength(1)

      const [change] = result.undoEntries
      const proposal = createProposal("Update component styles", [{
        path: project.relativeFile,
        before: change.content,
        after: change.afterContent,
      }])
      await applyProposal(project.root, proposal)
      await expect(readFile(project.target, "utf8")).resolves.toContain("bg-red-500")
      await undoProposal(project.root, proposal.id)
      await expect(readFile(project.target, "utf8")).resolves.toBe(project.source)
    })
  }
})

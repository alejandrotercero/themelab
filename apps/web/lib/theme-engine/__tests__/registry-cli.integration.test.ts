import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import { encodeInstallPayload } from "../install-payload"
import { installPayloadToRegistryItem } from "../registry"
import { paletteToThemeStyles } from "../transpile"

const execFileAsync = promisify(execFile)
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("shadcn CLI registry installation", () => {
  it("installs both CSS modes, radius, and root DESIGN.md into a Tailwind v4 project", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "themelab-registry-"))
    cleanup.push(directory)
    await mkdir(path.join(directory, "app"), { recursive: true })

    await Promise.all([
      writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({
          name: "themelab-registry-fixture",
          private: true,
          dependencies: {
            next: "16.2.6",
            react: "19.2.4",
            "react-dom": "19.2.4",
            tailwindcss: "^4",
          },
        })
      ),
      writeFile(
        path.join(directory, "components.json"),
        JSON.stringify({
          $schema: "https://ui.shadcn.com/schema.json",
          style: "new-york",
          rsc: true,
          tsx: true,
          tailwind: {
            config: "",
            css: "app/globals.css",
            baseColor: "neutral",
            cssVariables: true,
            prefix: "",
          },
          aliases: {
            components: "@/components",
            utils: "@/lib/utils",
            ui: "@/components/ui",
            lib: "@/lib",
            hooks: "@/hooks",
          },
        })
      ),
      writeFile(
        path.join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
        })
      ),
      writeFile(
        path.join(directory, "app/globals.css"),
        '@import "tailwindcss";\n'
      ),
    ])

    const theme = paletteToThemeStyles("#f97316", "#6b7280")
    const payload = encodeInstallPayload({
      name: "CLI Fixture",
      radius: "0.75rem",
      theme,
    })
    const item = installPayloadToRegistryItem(payload)
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify(item))
    })
    // oxlint-disable-next-line promise/avoid-new -- wraps a callback-based Node API (server.listen); no promise-returning alternative
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve)
    })

    try {
      const address = server.address()
      if (!address || typeof address === "string") {
        throw new Error("Registry fixture did not bind.")
      }
      await execFileAsync(
        path.resolve("node_modules/.bin/shadcn"),
        [
          "add",
          `http://127.0.0.1:${address.port}/theme.json`,
          "--cwd",
          directory,
          "--yes",
        ],
        { timeout: 45_000, env: { ...process.env, NO_COLOR: "1" } }
      )
    } finally {
      // oxlint-disable-next-line promise/avoid-new -- wraps a callback-based Node API (server.close); no promise-returning alternative
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }

    const [css, designMd] = await Promise.all([
      readFile(path.join(directory, "app/globals.css"), "utf-8"),
      readFile(path.join(directory, "DESIGN.md"), "utf-8"),
    ])
    expect(css).toContain("--radius: 0.75rem")
    expect(css).toContain(`--primary: ${item.cssVars.light.primary}`)
    expect(css).toContain(`--primary: ${item.cssVars.dark.primary}`)
    expect(css).toMatch(/\.dark\s*\{/u)
    expect(designMd).toBe(item.files[0].content)
    expect(designMd).toContain('name: "CLI Fixture"')
  }, 60_000)
})

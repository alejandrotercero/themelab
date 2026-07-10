import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
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
    const directory = await mkdtemp(join(tmpdir(), "themelab-registry-"))
    cleanup.push(directory)
    await mkdir(join(directory, "app"), { recursive: true })

    await Promise.all([
      writeFile(
        join(directory, "package.json"),
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
        join(directory, "components.json"),
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
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
        })
      ),
      writeFile(join(directory, "app/globals.css"), '@import "tailwindcss";\n'),
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
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen)
    )

    try {
      const address = server.address()
      if (!address || typeof address === "string")
        throw new Error("Registry fixture did not bind.")
      await execFileAsync(
        resolve("node_modules/.bin/shadcn"),
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
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose()))
      )
    }

    const [css, designMd] = await Promise.all([
      readFile(join(directory, "app/globals.css"), "utf8"),
      readFile(join(directory, "DESIGN.md"), "utf8"),
    ])
    expect(css).toContain("--radius: 0.75rem")
    expect(css).toContain(`--primary: ${item.cssVars.light.primary}`)
    expect(css).toContain(`--primary: ${item.cssVars.dark.primary}`)
    expect(css).toMatch(/\.dark\s*\{/u)
    expect(designMd).toBe(item.files[0].content)
    expect(designMd).toContain('name: "CLI Fixture"')
  }, 60_000)
})

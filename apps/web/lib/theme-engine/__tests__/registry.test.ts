import { registryItemSchema, registrySchema } from "shadcn/schema"
import { describe, expect, it } from "vitest"

import { encodeInstallPayload } from "../install-payload"
import {
  createRegistryCatalog,
  installPayloadToRegistryItem,
} from "../registry"
import { paletteToThemeStyles, THEME_TOKENS } from "../transpile"

const theme = paletteToThemeStyles("#0ea5e9", "#737373")

describe("ThemeLab registry", () => {
  it("builds a schema-valid registry theme with both modes and DESIGN.md", () => {
    const payload = encodeInstallPayload({
      name: "Sky Theme",
      radius: "10px",
      theme,
    })
    const item = installPayloadToRegistryItem(payload)

    expect(registryItemSchema.safeParse(item).success).toBe(true)
    expect(item.type).toBe("registry:theme")
    expect(item.cssVars.light.radius).toBe("10px")
    expect(item.files).toEqual([
      expect.objectContaining({
        path: "DESIGN.md",
        type: "registry:file",
        target: "~/DESIGN.md",
      }),
    ])
    expect(item.files[0].content).toContain('name: "Sky Theme"')
    expect(item.files[0].content).toMatch(/^ {2}primary: "oklch\(/m)

    for (const token of THEME_TOKENS) {
      expect(item.cssVars.light[token]).toMatch(/^oklch\(/u)
      expect(item.cssVars.dark[token]).toMatch(/^oklch\(/u)
    }
  })

  it("publishes a valid empty catalog without listing personal payloads", () => {
    const catalog = createRegistryCatalog()
    expect(registrySchema.safeParse(catalog).success).toBe(true)
    expect(catalog.items).toEqual([])
  })
})

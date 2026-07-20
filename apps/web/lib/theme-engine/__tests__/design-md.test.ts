import { execFileSync } from "node:child_process"
import path from "node:path"

import { lint } from "@google/design.md/linter"
import { describe, expect, it } from "vitest"

import { themeStylesToDesignMd } from "../design-md"
import { paletteToThemeStyles, THEME_TOKENS } from "../transpile"

const theme = paletteToThemeStyles("#2563eb", "#71717a")

describe("themeStylesToDesignMd", () => {
  it("emits deterministic, spec-valid YAML and factual sections", () => {
    const first = themeStylesToDesignMd(theme, {
      name: 'Ocean: "Blue"\n---',
      description: "Light and dark shadcn tokens.\u0000",
      radius: "0.625rem",
    })
    const second = themeStylesToDesignMd(theme, {
      name: 'Ocean: "Blue"\n---',
      description: "Light and dark shadcn tokens.\u0000",
      radius: "0.625rem",
    })

    expect(first).toBe(second)
    expect(first).toContain("version: alpha")
    expect(first).toContain('name: "Ocean: \\\"Blue\\\" ---"')
    expect(first).toContain('description: "Light and dark shadcn tokens."')
    expect(first).toContain('rounded:\n  base: "0.625rem"')
    expect(first).toContain("## Overview")
    expect(first).toContain("## Colors")
    expect(first).toContain("## Shapes")
    expect(first).toContain("## Components")
    expect(first).toContain("## Do's and Don'ts")
    expect(first).not.toMatch(/^## (?:Typography|Layout|Elevation & Depth)$/m)
    expect(first).not.toMatch(/^\s*(?:typography|spacing):/m)

    for (const token of THEME_TOKENS) {
      expect(first).toMatch(new RegExp(`^  ${token}: \\"`, "m"))
      expect(first).toMatch(new RegExp(`^  dark-${token}: \\"`, "m"))
    }

    expect(lint(first).summary.errors).toBe(0)
    expect(() =>
      execFileSync(
        path.resolve("node_modules/.bin/designmd"),
        ["lint", "--", "-"],
        {
          input: first,
          stdio: ["pipe", "pipe", "pipe"],
        }
      )
    ).not.toThrow()
  })

  it("respects the selected direct-export color format", () => {
    const hex = themeStylesToDesignMd(theme, {
      name: "Hex theme",
      radius: "8px",
      format: "hex",
    })
    const rgb = themeStylesToDesignMd(theme, {
      name: "RGB theme",
      radius: "8px",
      format: "rgb",
    })

    expect(hex).toMatch(/^ {2}primary: "#[0-9a-f]{6}"$/m)
    expect(hex).toMatch(/^ {2}dark-primary: "#[0-9a-f]{6}"$/m)
    expect(rgb).toMatch(/^ {2}primary: "rgb\(/m)
  })
})

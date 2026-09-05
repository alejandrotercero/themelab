// Tests for the saved-themes library file format: serialize → parse round-trip,
// the forgiving import shapes, entry sanitization, and the store's import merge
// (duplicate-id skipping + name uniquification). The store is fresh per test via
// module reset, so tests don't depend on shared module state.

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  parseThemesFile,
  sanitizeImportedTheme,
  serializeThemesFile,
  themesFileName,
} from "../saved-themes"
import type { savedThemesStore, SavedTheme } from "../saved-themes"

function makeTheme(overrides: Partial<SavedTheme> = {}): SavedTheme {
  return {
    id: "t1",
    name: "Aurora",
    theme: {
      light: { background: "#ffffff", foreground: "#000000" },
      dark: { background: "#000000", foreground: "#ffffff" },
    },
    radius: "0.625rem",
    source: "ThemeLab palette",
    favorite: false,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

function parseThemes(text: string) {
  return parseThemesFile(text)
}

describe("serializeThemesFile / parseThemesFile", () => {
  it("round-trips themes through the envelope format", () => {
    const themes = [makeTheme(), makeTheme({ id: "t2", name: "Nord" })]
    expect(parseThemes(serializeThemesFile(themes))).toEqual({
      themes,
      invalidCount: 0,
    })
  })

  it("parses a bare array of themes", () => {
    const themes = [makeTheme()]
    expect(parseThemes(JSON.stringify(themes))).toEqual({
      themes,
      invalidCount: 0,
    })
  })

  it("parses a single bare theme object", () => {
    const theme = makeTheme()
    expect(parseThemes(JSON.stringify(theme))).toEqual({
      themes: [theme],
      invalidCount: 0,
    })
  })

  it("rejects non-JSON text and unrecognized shapes", () => {
    expect(parseThemes("not json")).toBeNull()
    expect(parseThemes(JSON.stringify({ foo: 1 }))).toBeNull()
    // The /edit JSON export ({ root, dark }) is a theme input, not a library file.
    expect(
      parseThemes(JSON.stringify({ root: { background: "#fff" }, dark: {} }))
    ).toBeNull()
  })

  it("counts invalid entries instead of failing the whole file", () => {
    const parsed = parseThemes(
      JSON.stringify({
        version: 1,
        themes: [makeTheme(), { nope: true }, "a string", null],
      })
    )
    expect(parsed?.themes).toEqual([makeTheme()])
    expect(parsed?.invalidCount).toBe(3)
  })
})

describe("sanitizeImportedTheme", () => {
  it("accepts a theme with only light tokens (dark becomes empty)", () => {
    const item = sanitizeImportedTheme({
      name: "Paper",
      theme: { light: { background: "#fff" } },
    })
    expect(item?.theme.light).toEqual({ background: "#fff" })
    expect(item?.theme.dark).toEqual({})
  })

  it("rejects entries with no tokens in either mode", () => {
    expect(sanitizeImportedTheme({ name: "Empty", theme: {} })).toBeNull()
    expect(
      sanitizeImportedTheme({ name: "Empty", theme: { light: {}, dark: {} } })
    ).toBeNull()
    expect(
      sanitizeImportedTheme({ theme: { light: { background: 5 } } })
    ).toBeNull()
    expect(sanitizeImportedTheme("a string")).toBeNull()
    expect(sanitizeImportedTheme(null)).toBeNull()
  })

  it("fills missing fields with defaults and drops non-string tokens", () => {
    const item = sanitizeImportedTheme({
      theme: { light: { background: "#fff", bogus: 42 } },
    })
    expect(item).toMatchObject({
      name: "Imported theme",
      radius: "0.625rem",
      source: "Imported",
      favorite: false,
    })
    expect(item?.theme.light).toEqual({ background: "#fff" })
    expect(item?.id).toBeTruthy()
    expect(item?.createdAt).toBeGreaterThan(0)
  })

  it("keeps valid ids, names, favorites, and timestamps", () => {
    const theme = makeTheme({ favorite: true })
    expect(sanitizeImportedTheme(theme)).toEqual(theme)
    // A non-boolean favorite must not become true.
    expect(sanitizeImportedTheme({ ...theme, favorite: "yes" })?.favorite).toBe(
      false
    )
  })
})

describe("themesFileName", () => {
  it("slugs a single-theme name", () => {
    expect(themesFileName("Aurora")).toBe("themelab-theme-aurora.json")
    expect(themesFileName("My Cool Theme!!")).toBe(
      "themelab-theme-my-cool-theme.json"
    )
  })

  it("falls back to 'theme' for a name with no slug characters", () => {
    expect(themesFileName("!!!")).toBe("themelab-theme-theme.json")
  })

  it("dates the whole-library export", () => {
    expect(themesFileName()).toMatch(
      /^themelab-themes-\d{4}-\d{2}-\d{2}\.json$/
    )
  })
})

describe("savedThemesStore.importThemes", () => {
  let store: typeof savedThemesStore

  beforeEach(async () => {
    vi.resetModules()
    ;({ savedThemesStore: store } = await import("../saved-themes"))
  })

  it("adds imported themes and re-adding the same ids skips them", () => {
    const batch = [makeTheme(), makeTheme({ id: "t2", name: "Nord" })]
    expect(store.importThemes(batch)).toEqual({ added: 2, skipped: 0 })
    expect(store.list().length).toBe(2)
    // Same file again — nothing new, all skipped.
    expect(store.importThemes(batch)).toEqual({ added: 0, skipped: 2 })
    expect(store.list().length).toBe(2)
  })

  it("re-imports a theme whose local copy was deleted", () => {
    store.importThemes([makeTheme()])
    store.remove("t1")
    expect(store.importThemes([makeTheme()])).toEqual({ added: 1, skipped: 0 })
  })

  it("uniquifies names against existing themes", () => {
    store.saveNew({
      name: "Aurora",
      theme: makeTheme().theme,
      radius: "0.625rem",
      source: "ThemeLab palette",
    })
    store.importThemes([makeTheme()])
    const names = store.list().map((t) => t.name)
    expect(names).toContain("Aurora")
    expect(names).toContain("Aurora (2)")
  })

  it("uniquifies names within a single import batch", () => {
    store.importThemes([makeTheme(), makeTheme({ id: "t2" })])
    const names = store.list().map((t) => t.name)
    expect(names.filter((n) => n.startsWith("Aurora"))).toEqual([
      "Aurora",
      "Aurora (2)",
    ])
  })
})

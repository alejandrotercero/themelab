// localStorage-backed library of saved themes. A tiny module-level store with an
// external-store subscription (useSyncExternalStore-friendly) so the toolbar
// "My Themes" dialog and the /library page stay in lockstep — and across tabs
// via the window `storage` event. No backend, no dependency.

import type { ThemeStyles } from "@themelab/shared"

export interface SavedTheme {
  id: string
  name: string
  theme: ThemeStyles // resolved light + dark
  radius: string // e.g. "0.625rem"
  source: string // origin label, e.g. "ThemeLab palette"
  favorite: boolean
  createdAt: number
  updatedAt: number
}

const KEY = "tl-saved-themes"

const listeners = new Set<() => void>()
let cache: SavedTheme[] = []
let hydrated = false

function isBrowser() {
  return typeof window !== "undefined"
}

function read(): SavedTheme[] {
  if (!isBrowser()) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedTheme[]) : []
  } catch {
    return []
  }
}

function emit() {
  for (const l of listeners) {
    l()
  }
}

function ensureHydrated() {
  if (hydrated || !isBrowser()) {
    return
  }
  cache = read()
  hydrated = true
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== KEY) {
      return
    }
    cache = read()
    emit()
  })
}

function write(next: SavedTheme[]) {
  cache = next
  if (isBrowser()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // quota / private mode — keep the in-memory copy so the UI still works.
    }
  }
  emit()
}

/** Favorites first, then most-recently-updated. */
function sortForDisplay(items: SavedTheme[]): SavedTheme[] {
  return items.toSorted((a, b) => {
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1
    }
    return b.updatedAt - a.updatedAt
  })
}

function newId(): string {
  if (isBrowser() && typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `t_${Date.now().toString(36)}`
}

function uniqueName(
  name: string,
  items: SavedTheme[],
  ignoreId?: string
): string {
  const taken = new Set(
    items.filter((t) => t.id !== ignoreId).map((t) => t.name)
  )
  if (!taken.has(name)) {
    return name
  }
  let n = 2
  while (taken.has(`${name} (${n})`)) {
    n += 1
  }
  return `${name} (${n})`
}

// --- public store API ---------------------------------------------------

export const savedThemesStore = {
  subscribe(listener: () => void): () => void {
    ensureHydrated()
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Snapshot for useSyncExternalStore — stable reference between writes. */
  getSnapshot(): SavedTheme[] {
    ensureHydrated()
    return cache
  },

  getServerSnapshot(): SavedTheme[] {
    return []
  },

  list(): SavedTheme[] {
    ensureHydrated()
    return sortForDisplay(cache)
  },

  get(id: string): SavedTheme | undefined {
    ensureHydrated()
    return cache.find((t) => t.id === id)
  },

  saveNew(input: {
    name: string
    theme: ThemeStyles
    radius: string
    source: string
  }): SavedTheme {
    ensureHydrated()
    const now = Date.now()
    const item: SavedTheme = {
      id: newId(),
      name: uniqueName(input.name.trim() || "Untitled theme", cache),
      theme: input.theme,
      radius: input.radius,
      source: input.source,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    }
    write([item, ...cache])
    return item
  },

  update(
    id: string,
    patch: Partial<Pick<SavedTheme, "theme" | "radius" | "source" | "name">>
  ): void {
    ensureHydrated()
    write(
      cache.map((t) =>
        t.id === id
          ? {
              ...t,
              ...patch,
              name: patch.name
                ? uniqueName(patch.name.trim() || t.name, cache, id)
                : t.name,
              updatedAt: Date.now(),
            }
          : t
      )
    )
  },

  rename(id: string, name: string): void {
    this.update(id, { name })
  },

  duplicate(id: string): SavedTheme | undefined {
    ensureHydrated()
    const src = cache.find((t) => t.id === id)
    if (!src) {
      return undefined
    }
    const now = Date.now()
    const copy: SavedTheme = {
      ...src,
      id: newId(),
      name: uniqueName(`${src.name} copy`, cache),
      favorite: false,
      createdAt: now,
      updatedAt: now,
    }
    write([copy, ...cache])
    return copy
  },

  /** Merge imported themes into the library. Entries whose id already exists
   *  are skipped (the local copy wins), names are uniquified on collision. */
  importThemes(items: SavedTheme[]): { added: number; skipped: number } {
    ensureHydrated()
    const next = [...cache]
    const seenIds = new Set(cache.map((t) => t.id))
    let added = 0
    let skipped = 0
    for (const item of items) {
      if (seenIds.has(item.id)) {
        skipped += 1
        continue
      }
      seenIds.add(item.id)
      next.push({ ...item, name: uniqueName(item.name, next) })
      added += 1
    }
    if (added > 0) {
      write(next)
    }
    return { added, skipped }
  },

  remove(id: string): void {
    ensureHydrated()
    write(cache.filter((t) => t.id !== id))
  },

  toggleFavorite(id: string): void {
    ensureHydrated()
    write(
      cache.map((t) =>
        t.id === id ? { ...t, favorite: !t.favorite, updatedAt: Date.now() } : t
      )
    )
  },
}

// --- library file import / export -----------------------------------------

// The portable .json format shared by "Export" (whole library or a single
// theme) and "Import": a versioned envelope around saved themes. Parsing is
// deliberately forgiving — it accepts the wrapped envelope, a bare array, or a
// single bare theme object — so exports from older builds and hand-edited
// files still load.

const THEMES_FILE_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Keep only string→string entries; anything else in a token map is dropped. */
function sanitizeTokenMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }
  const tokens: Record<string, string> = {}
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "string") {
      tokens[key] = val
    }
  }
  return tokens
}

/** Coerce an unknown file entry into a SavedTheme, filling gaps with defaults.
 *  Returns null for entries with no usable tokens in either mode. */
export function sanitizeImportedTheme(raw: unknown): SavedTheme | null {
  if (!isRecord(raw) || !isRecord(raw.theme)) {
    return null
  }
  const light = sanitizeTokenMap(raw.theme.light)
  const dark = sanitizeTokenMap(raw.theme.dark)
  if (!Object.keys(light).length && !Object.keys(dark).length) {
    return null
  }
  const now = Date.now()
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : "Imported theme",
    theme: { light, dark },
    radius:
      typeof raw.radius === "string" && raw.radius ? raw.radius : "0.625rem",
    source:
      typeof raw.source === "string" && raw.source ? raw.source : "Imported",
    favorite: raw.favorite === true,
    createdAt:
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : now,
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : now,
  }
}

export interface ParsedThemesFile {
  themes: SavedTheme[]
  /** Entries that were present but unusable (dropped during sanitization). */
  invalidCount: number
}

/** Which array of raw entries a parsed file holds, or null if the shape isn't
 *  recognized: the wrapped envelope, a bare array, or one bare theme object. */
function themeEntries(data: unknown): unknown[] | null {
  if (Array.isArray(data)) {
    return data
  }
  if (!isRecord(data)) {
    return null
  }
  if (Array.isArray(data.themes)) {
    return data.themes
  }
  if (isRecord(data.theme)) {
    return [data] // a single bare theme object
  }
  return null
}

/** Parse a saved-themes export. Returns null when the text isn't a themes
 *  file at all (bad JSON or an unrecognized shape). */
export function parseThemesFile(text: string): ParsedThemesFile | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const entries = themeEntries(data)
  if (!entries) {
    return null
  }
  const themes: SavedTheme[] = []
  let invalidCount = 0
  for (const entry of entries) {
    const item = sanitizeImportedTheme(entry)
    if (item) {
      themes.push(item)
    } else {
      invalidCount += 1
    }
  }
  return { themes, invalidCount }
}

/** Serialize themes into the portable library-file format. */
export function serializeThemesFile(themes: SavedTheme[]): string {
  return JSON.stringify(
    {
      version: THEMES_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      count: themes.length,
      themes,
    },
    null,
    2
  )
}

/** Export filename: slugged for a single theme, dated for the whole library. */
export function themesFileName(name?: string): string {
  if (name) {
    const slug =
      name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replaceAll(/^-+|-+$/g, "") || "theme"
    return `themelab-theme-${slug}.json`
  }
  return `themelab-themes-${new Date().toISOString().slice(0, 10)}.json`
}

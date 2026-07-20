"use client"

// /edit — open an arbitrary full shadcn theme, tweak it, and export. Hydrates
// the theme from the URL hash (`/edit#theme=<encoded>`, written by the overlay's
// "Open in editor"), and can also Import a pasted CSS/JSON export. Reuses the
// shared editor chrome (token sidebar · live preview · Code export) from the
// other two tools.

import { decodeTheme } from "@themelab/shared"
import type { ThemeStyles, ParsedTheme } from "@themelab/shared"
import { useEffect } from "react"

import { Toaster } from "@/components/ui/sonner"
import { savedThemesStore } from "@/lib/saved-themes"
import { paletteToThemeStyles } from "@/lib/theme-engine"

import { EditorShell } from "./editor-shell"
import { ImportDialog } from "./import-dialog"
import { LibraryControls } from "./library-controls"
import { Toolbar } from "./toolbar"
import { useThemeEditor } from "./use-theme-editor"

// Shown when /edit is opened without a theme in the hash.
const FALLBACK: ThemeStyles = paletteToThemeStyles("#3b82f6", "#71717a")

export function ThemeEditor() {
  const editor = useThemeEditor()

  // Hydrate once, in priority order: a saved-library id (?saved=), then the
  // overlay's encoded theme (#theme=), then a neutral default.
  useEffect(() => {
    const savedId = new URLSearchParams(window.location.search).get("saved")
    const saved = savedId ? savedThemesStore.get(savedId) : undefined
    if (saved) {
      editor.loadBase(saved.theme, {
        source: saved.name,
        swatches: [],
        savedId: saved.id,
      })
      editor.setRadius(saved.radius)
      return
    }

    const hash = window.location.hash.replace(/^#/, "")
    const encoded = new URLSearchParams(hash).get("theme")
    const decoded = encoded ? decodeTheme(encoded) : null
    editor.loadBase(decoded ?? FALLBACK, {
      source: decoded ? "Imported theme" : "Untitled theme",
      swatches: [],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Merge a paste onto the current theme so a single-mode import keeps the other
  // mode intact.
  const importTheme = (parsed: ParsedTheme) => {
    editor.loadBase(
      {
        light: { ...editor.theme.light, ...parsed.light },
        dark: { ...editor.theme.dark, ...parsed.dark },
      },
      { source: "Imported theme", swatches: [] }
    )
  }

  return (
    <EditorShell
      editor={editor}
      toolbar={
        <Toolbar
          theme={editor.theme}
          radius={editor.radius}
          name={editor.source}
          title="edit"
          extra={
            <>
              <LibraryControls editor={editor} />
              <ImportDialog onImport={importTheme} />
            </>
          }
        />
      }
      input={
        <p className="text-[11px] text-[var(--ov-text-ghost)]">
          Edit tokens on the left, or Import a pasted theme. Export with Code.
        </p>
      }
      output={null}
    >
      <Toaster />
    </EditorShell>
  )
}

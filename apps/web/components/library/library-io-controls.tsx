"use client"

// Import / export controls for the saved-themes library. Export downloads the
// whole library as a portable .json file; Import reads one back and merges it
// into the store (duplicate ids are skipped, names are uniquified). Rendered
// by LibraryGallery, so both the /library page and the in-tool "My Themes"
// dialog get the same controls.

import { DownloadSimpleIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useRef } from "react"
import type { ChangeEvent } from "react"
import { toast } from "sonner"

import { downloadTextFile } from "@/lib/download"
import {
  parseThemesFile,
  savedThemesStore,
  serializeThemesFile,
  themesFileName,
} from "@/lib/saved-themes"
import type { SavedTheme } from "@/lib/saved-themes"

interface LibraryIoControlsProps {
  themes: SavedTheme[]
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

export function LibraryIoControls({ themes }: LibraryIoControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const exportAll = () => {
    if (!themes.length) {
      return
    }
    downloadTextFile(
      serializeThemesFile(themes),
      themesFileName(),
      "application/json"
    )
    toast.success(`Exported ${plural(themes.length, "theme")}`)
  }

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // allow re-importing the same file later
    if (!file) {
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      toast.error("Couldn't read that file. Try exporting it again.")
      return
    }
    const parsed = parseThemesFile(text)
    if (!parsed) {
      toast.error(
        "That's not a themes file. Pick a .json export from ThemeLab's library."
      )
      return
    }
    if (!parsed.themes.length) {
      toast.error(
        parsed.invalidCount
          ? "No usable themes in that file — every entry was invalid."
          : "That file contains no themes."
      )
      return
    }
    const { added, skipped } = savedThemesStore.importThemes(parsed.themes)
    if (!added) {
      toast.info(
        `Already in your library — ${plural(skipped, "theme")} skipped.`
      )
      return
    }
    const parts = [`Imported ${plural(added, "theme")}`]
    if (skipped) {
      parts.push(`${skipped} already saved`)
    }
    if (parsed.invalidCount) {
      parts.push(`${parsed.invalidCount} invalid skipped`)
    }
    toast.success(parts.join(" · "))
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onFileChange}
      />
      <button
        type="button"
        className="ov-btn"
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadSimpleIcon weight="bold" className="size-3.5" />
        Import
      </button>
      <button
        type="button"
        className="ov-btn"
        onClick={exportAll}
        disabled={!themes.length}
      >
        <DownloadSimpleIcon weight="bold" className="size-3.5" />
        Export
      </button>
    </div>
  )
}

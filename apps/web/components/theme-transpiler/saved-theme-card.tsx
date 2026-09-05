"use client"

// One saved-theme tile: a swatch strip previewing the theme, its name + source,
// a favorite star, and a "⋯" menu (Rename / Duplicate / Delete). All behaviour is
// delegated to the parent via callbacks; the card holds no store state.

import {
  DotsThreeIcon,
  StarIcon,
  CopyIcon,
  DownloadSimpleIcon,
  PencilSimpleIcon,
  TerminalWindowIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { downloadTextFile } from "@/lib/download"
import { serializeThemesFile, themesFileName } from "@/lib/saved-themes"
import type { SavedTheme } from "@/lib/saved-themes"
import { createInstallCommand, themeStylesToDesignMd } from "@/lib/theme-engine"

// Tokens shown in the preview strip, in order. Read from dark mode (the studio's
// default), falling back to light.
const PREVIEW_TOKENS = [
  "background",
  "primary",
  "secondary",
  "accent",
  "muted",
  "foreground",
]

interface SavedThemeCardProps {
  theme: SavedTheme
  onOpen: (t: SavedTheme) => void
  onRename: (t: SavedTheme) => void
  onDuplicate: (t: SavedTheme) => void
  onDelete: (t: SavedTheme) => void
  onToggleFavorite: (t: SavedTheme) => void
}

export function SavedThemeCard({
  theme,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onToggleFavorite,
}: SavedThemeCardProps) {
  const vars =
    theme.theme.dark && Object.keys(theme.theme.dark).length
      ? theme.theme.dark
      : theme.theme.light

  const copyInstallCommand = async () => {
    try {
      const command = createInstallCommand(
        { name: theme.name, radius: theme.radius, theme: theme.theme },
        window.location.origin
      )
      await navigator.clipboard.writeText(command)
      toast.success("Install command copied")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't copy this theme."
      )
    }
  }

  const downloadDesignMd = () => {
    downloadTextFile(
      themeStylesToDesignMd(theme.theme, {
        name: theme.name,
        radius: theme.radius,
        format: "oklch",
      }),
      "DESIGN.md",
      "text/markdown"
    )
    toast.success("DESIGN.md downloaded")
  }

  const exportThemeJson = () => {
    downloadTextFile(
      serializeThemesFile([theme]),
      themesFileName(theme.name),
      "application/json"
    )
    toast.success("Theme exported — import it from any ThemeLab library")
  }

  return (
    <div className="group/card flex flex-col overflow-hidden rounded-[var(--ov-radius-sm)] border border-[var(--ov-border)] bg-[var(--ov-surface-2)] text-left transition-colors hover:border-[var(--ov-accent)]">
      <button
        type="button"
        onClick={() => onOpen(theme)}
        aria-label={`Open ${theme.name}`}
        className="flex h-16 w-full items-stretch outline-none focus-visible:ring-2 focus-visible:ring-[var(--ov-accent)]"
        style={{ backgroundColor: vars.background }}
      >
        {PREVIEW_TOKENS.map((token) => (
          <span
            key={token}
            className="flex-1"
            style={{ backgroundColor: vars[token] }}
            title={token}
          />
        ))}
      </button>

      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <button
          type="button"
          onClick={() => onToggleFavorite(theme)}
          aria-label={
            theme.favorite ? "Remove from favorites" : "Add to favorites"
          }
          aria-pressed={theme.favorite}
          className="shrink-0 text-[var(--ov-text-ghost)] transition-colors hover:text-[var(--ov-accent)] aria-pressed:text-[var(--ov-accent)]"
        >
          <StarIcon
            weight={theme.favorite ? "fill" : "regular"}
            className="size-4"
          />
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen(theme)}
            className="block w-full truncate text-left text-sm font-medium text-[var(--ov-text)] outline-none hover:underline"
            title={theme.name}
          >
            {theme.name}
          </button>
          <p className="truncate text-[10px] text-[var(--ov-text-ghost)]">
            {theme.source}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="ov-btn shrink-0 px-1.5"
            aria-label={`Actions for ${theme.name}`}
          >
            <DotsThreeIcon weight="bold" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="tl-overlay">
            <DropdownMenuItem onClick={() => onRename(theme)}>
              <PencilSimpleIcon className="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDuplicate(theme)}>
              <CopyIcon className="size-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={copyInstallCommand}>
              <TerminalWindowIcon className="size-4" />
              Copy install command
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadDesignMd}>
              <DownloadSimpleIcon className="size-4" />
              Download DESIGN.md
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportThemeJson}>
              <DownloadSimpleIcon className="size-4" />
              Export theme (.json)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(theme)}
            >
              <TrashIcon className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

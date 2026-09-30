"use client"

// One saved-theme tile: a swatch strip previewing the theme, its name + source,
// a favorite star, and a "⋯" menu (Rename / Duplicate / Delete). All behaviour is
// delegated to the parent via callbacks; the card holds no store state.
//
// /tailwind scale-set entries (SavedTheme with a `scaleSet` field) render a
// different tile: a stack of live-generated mini ramps plus a slimmer menu
// (Rename / Duplicate / Export scale set / Delete).

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
import {
  isScaleSetEntry,
  serializeThemesFile,
  themesFileName,
} from "@/lib/saved-themes"
import type { SavedTheme } from "@/lib/saved-themes"
import {
  buildScale,
  createInstallCommand,
  oklchToHex,
  radixScaleFromColor,
  themeStylesToDesignMd,
  toOklch,
} from "@/lib/theme-engine"
import type { Scale } from "@/lib/theme-engine"

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

const toHex = (value: string) => {
  const o = toOklch(value)
  return o ? oklchToHex(o) : value
}

// Max ramps shown in a scale-set preview; the rest collapse to a "+N more" caption.
const MAX_VISIBLE_ROWS = 4

function scaleForRow(
  row: { color: string; neutral: boolean },
  algo: "themelab" | "radix",
  appearance: "light" | "dark"
): Scale {
  return algo === "themelab"
    ? buildScale(row.color, { neutral: row.neutral })
    : radixScaleFromColor(row.color, appearance).primary
}

function ScaleSetCard({
  theme,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onToggleFavorite,
}: SavedThemeCardProps) {
  const set = theme.scaleSet
  // Unreachable: the parent only renders this branch for scale-set entries.
  if (!set) {
    return null
  }
  const rows = set.rows
  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS)
  const extra = rows.length - visibleRows.length
  const algoLabel = set.algo === "themelab" ? "ThemeLab" : "Radix"

  const exportScaleSetJson = () => {
    downloadTextFile(
      serializeThemesFile([theme]),
      themesFileName(theme.name),
      "application/json"
    )
    toast.success("Scale set exported — import it from any ThemeLab library")
  }

  return (
    <div className="group/card flex flex-col overflow-hidden rounded-[var(--ov-radius-sm)] border border-[var(--ov-border)] bg-[var(--ov-surface-2)] text-left transition-colors hover:border-[var(--ov-accent)]">
      <button
        type="button"
        onClick={() => onOpen(theme)}
        aria-label={`Open ${theme.name}`}
        className="flex w-full flex-col gap-px p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ov-accent)]"
      >
        {visibleRows.map((row) => {
          const scale = scaleForRow(row, set.algo, set.appearance)
          return (
            <div
              key={row.name}
              className="flex overflow-hidden rounded-[var(--ov-radius-xs)]"
            >
              {scale.map(({ stop, value }) => {
                const hex = toHex(value)
                return (
                  <span
                    key={stop}
                    className="h-5 flex-1"
                    style={{ backgroundColor: hex }}
                    title={`${row.name} · ${hex}`}
                  />
                )
              })}
            </div>
          )
        })}
        {extra > 0 && (
          <span className="px-0.5 pt-0.5 text-left text-[10px] text-[var(--ov-text-ghost)]">
            +{extra} more
          </span>
        )}
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
            {theme.source} · {rows.length}{" "}
            {rows.length === 1 ? "scale" : "scales"} · {algoLabel}
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
            <DropdownMenuItem onClick={exportScaleSetJson}>
              <DownloadSimpleIcon className="size-4" />
              Export scale set (.json)
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

export function SavedThemeCard({
  theme,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onToggleFavorite,
}: SavedThemeCardProps) {
  if (isScaleSetEntry(theme)) {
    return (
      <ScaleSetCard
        theme={theme}
        onOpen={onOpen}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onToggleFavorite={onToggleFavorite}
      />
    )
  }

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

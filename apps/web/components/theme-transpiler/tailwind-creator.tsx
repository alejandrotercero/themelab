"use client"

// /tailwind — build named Tailwind scales from single colors. One row per
// scale (name + color + neutral toggle), up to 8. Two algorithms, toggled by
// the user:
//   • "ThemeLab" (default) — buildScale: fixed lightness + chroma curve per
//     stop in the anchor's hue; neutral clamps chroma so grays stay gray.
//   • "Radix" — radixScaleFromColor: the real generateRadixColors with
//     gray = accent (tinted neutrals), fixed backgrounds; 12 steps, so the
//     appearance toggle picks which mode's scales are shown.
// Scales only — no shadcn theme. Export is a Tailwind @theme block + the
// Figma SVG copy. Scale sets save into the shared library (Plan A): the
// SavedTheme entry carries the generator inputs in `scaleSet` and empty
// theme maps.

import Link from "next/link"
import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"

import { Logo } from "@/components/logo"
import { Toaster } from "@/components/ui/sonner"
import { savedThemesStore } from "@/lib/saved-themes"
import type { SavedTheme } from "@/lib/saved-themes"
import {
  buildScale,
  oklchToHex,
  radixScaleFromColor,
  scalesToFigmaSvg,
  toOklch,
} from "@/lib/theme-engine"
import type { Appearance, Scale } from "@/lib/theme-engine"

import { LibraryDialog } from "./library-dialog"
import { NameThemeDialog } from "./name-theme-dialog"
import { ScaleExportDialog } from "./scale-export-dialog"
import { ScaleRowsInput } from "./scale-rows-input"
import type { ScaleRow } from "./scale-rows-input"
import { ScaleView } from "./scale-view"

type Algo = "themelab" | "radix"

function newRowId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return String(Date.now())
  }
}

const DEFAULT_ROWS: ScaleRow[] = [
  { id: "default-brand", name: "brand", color: "#3b82f6", neutral: false },
]

const toHex = (value: string) => {
  const o = toOklch(value)
  return o ? oklchToHex(o) : value
}

/** Uniquify scale names for the CSS output (`--color-<name>-<stop>`). */
function uniqueNames(rows: ScaleRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const base = row.name.trim() || "scale"
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  })
}

export function TailwindCreator() {
  // Hydrate from the library (?saved=<id>) so saved scale sets reopen here.
  // Lazy useState initializers (not an effect): this runs once on mount and
  // reads the external system (URL + localStorage store) synchronously.
  const [initial] = useState(() => {
    const savedIdParam =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("saved")
    const saved = savedIdParam
      ? savedThemesStore.get(savedIdParam)
      : undefined
    if (saved?.scaleSet && saved.scaleSet.rows.length > 0) {
      const rows: ScaleRow[] = saved.scaleSet.rows.map((r) => ({
        id: newRowId(),
        name: r.name,
        color: r.color,
        neutral: r.neutral,
      }))
      return {
        rows,
        algo: saved.scaleSet.algo as Algo,
        appearance: saved.scaleSet.appearance as Appearance,
        name: saved.name,
        savedId: saved.id as string | null,
      }
    }
    return {
      rows: DEFAULT_ROWS,
      algo: "themelab" as Algo,
      appearance: "light" as Appearance,
      name: "Untitled scales",
      savedId: null,
    }
  })

  const [algo, setAlgo] = useState<Algo>(initial.algo)
  const [appearance, setAppearance] = useState<Appearance>(initial.appearance)
  const [rows, setRows] = useState<ScaleRow[]>(initial.rows)
  const [gen, setGen] = useState<{
    algo: Algo
    appearance: Appearance
    rows: ScaleRow[]
  }>({ algo: initial.algo, appearance: initial.appearance, rows: initial.rows })
  const [setName, setSetName] = useState(initial.name)
  const [savedId, setSavedId] = useState<string | null>(initial.savedId)
  const [nameOpen, setNameOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const generate = useCallback(() => {
    setGen({ algo, appearance, rows })
    // Generating fresh detaches from any open saved entry (mirrors /create).
    setSavedId(null)
  }, [algo, appearance, rows])

  const changeAlgo = (a: Algo) => {
    setAlgo(a)
    setGen((prev) => ({ ...prev, algo: a }))
    setSavedId(null)
  }

  const changeAppearance = (m: Appearance) => {
    setAppearance(m)
    setGen((prev) => ({ ...prev, appearance: m }))
    setSavedId(null)
  }

  const scales = useMemo(() => {
    const names = uniqueNames(gen.rows)
    return gen.rows.map((row, i) => {
      const name = names[i] ?? `scale-${i + 1}`
      let scale: Scale
      if (gen.algo === "themelab") {
        scale = buildScale(row.color, { neutral: row.neutral })
      } else {
        const { primary, neutral } = radixScaleFromColor(
          row.color,
          gen.appearance
        )
        scale = row.neutral ? neutral : primary
      }
      return { name, scale }
    })
  }, [gen])

  const figmaSvg = useCallback(
    () =>
      scalesToFigmaSvg({
        families: scales,
        mode: "light",
        title: gen.algo === "radix" ? "Radix" : "ThemeLab",
      }),
    [scales, gen.algo]
  )

  const swatchCount = useMemo(
    () => scales.reduce((n, s) => n + s.scale.length, 0),
    [scales]
  )

  const copyStop = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`Copied ${label}`)
    } catch {
      toast.error("Couldn't access the clipboard.")
    }
  }, [])

  const save = () => {
    if (savedId && savedThemesStore.get(savedId)) {
      savedThemesStore.update(savedId, {
        source: "Tailwind scales",
        scaleSet: {
          algo: gen.algo,
          appearance: gen.appearance,
          rows: gen.rows.map((r) => ({
            name: r.name,
            color: r.color,
            neutral: r.neutral,
          })),
        },
      })
      toast.success("Scale set updated")
      return
    }
    setNameOpen(true)
  }

  const saveNew = (name: string) => {
    const created = savedThemesStore.saveNew({
      name,
      theme: { light: {}, dark: {} },
      radius: "0.625rem",
      source: "Tailwind scales",
      scaleSet: {
        algo: gen.algo,
        appearance: gen.appearance,
        rows: gen.rows.map((r) => ({
          name: r.name,
          color: r.color,
          neutral: r.neutral,
        })),
      },
    })
    setSavedId(created.id)
    setSetName(created.name)
    toast.success("Scale set saved")
  }

  const openSaved = (t: SavedTheme) => {
    if (!t.scaleSet || t.scaleSet.rows.length === 0) {
      return
    }
    const next: ScaleRow[] = t.scaleSet.rows.map((r) => ({
      id: newRowId(),
      name: r.name,
      color: r.color,
      neutral: r.neutral,
    }))
    setRows(next)
    setAlgo(t.scaleSet.algo)
    setAppearance(t.scaleSet.appearance)
    setGen({
      algo: t.scaleSet.algo,
      appearance: t.scaleSet.appearance,
      rows: next,
    })
    setSetName(t.name)
    setSavedId(t.id)
  }

  return (
    <div className="tl-overlay flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--ov-border)] px-4 py-2.5">
        <div className="flex items-center gap-2.5 text-[var(--ov-text)]">
          <Link href="/" aria-label="ThemeLab home" className="flex items-center">
            <Logo className="h-3.5" />
          </Link>
          <span className="text-[var(--ov-text-ghost)]">/</span>
          <h1 className="text-sm font-semibold tracking-tight">tailwind</h1>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="ov-btn"
            onClick={() => setLibraryOpen(true)}
          >
            My themes
          </button>
          <button type="button" className="ov-btn" onClick={save}>
            Save
          </button>
          <ScaleExportDialog
            scales={scales}
            title={gen.algo === "radix" ? "Radix" : "ThemeLab"}
            name={setName}
          />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-[10px] font-semibold tracking-wide text-[var(--ov-text-ghost)] uppercase">
              Scale set:
            </span>
            <span className="truncate text-lg font-semibold text-[var(--ov-text)]">
              {setName}
            </span>
          </div>

          <ScaleRowsInput
            rows={rows}
            onChange={(next) => {
              setRows(next)
              setSavedId(null)
            }}
            onGenerate={generate}
          />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--ov-text-ghost)]">
                Algorithm
              </span>
              <div
                className="ov-seg"
                role="tablist"
                aria-label="Generation algorithm"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={algo === "themelab"}
                  data-active={algo === "themelab"}
                  className="ov-seg-btn"
                  title="Fixed lightness + chroma curve per stop in the anchor's hue"
                  onClick={() => changeAlgo("themelab")}
                >
                  ThemeLab
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={algo === "radix"}
                  data-active={algo === "radix"}
                  className="ov-seg-btn"
                  title="Radix's real generateRadixColors"
                  onClick={() => changeAlgo("radix")}
                >
                  Radix
                </button>
              </div>
            </div>

            {algo === "radix" && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--ov-text-ghost)]">
                  Appearance
                </span>
                <div
                  className="ov-seg"
                  role="tablist"
                  aria-label="Radix appearance"
                >
                  {(["light", "dark"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={appearance === m}
                      data-active={appearance === m}
                      className="ov-seg-btn"
                      title={`Generate the ${m}-mode Radix scales`}
                      onClick={() => changeAppearance(m)}
                    >
                      {m === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <span className="text-[11px] text-[var(--ov-text-ghost)]">
              {scales.length} scale{scales.length === 1 ? "" : "s"} ·{" "}
              {swatchCount} swatches · click a swatch to copy
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {scales.map(({ name, scale }) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="truncate text-sm font-semibold text-[var(--ov-text)]">
                  {name}
                </h2>
                <span className="shrink-0 text-[10px] text-[var(--ov-text-ghost)]">
                  {scale.length} stops
                </span>
              </div>
              <div className="flex overflow-hidden rounded-[var(--ov-radius-xs)] border border-[var(--ov-border)]">
                {scale.map(({ stop, value }) => {
                  const hex = toHex(value)
                  return (
                    <button
                      key={stop}
                      type="button"
                      title={`${name}-${stop} · ${hex} · ${value}`}
                      aria-label={`Copy ${name}-${stop} (${hex})`}
                      onClick={() => copyStop(value, `${name}-${stop}`)}
                      className="h-14 min-w-0 flex-1 transition-transform hover:scale-y-105"
                      style={{ backgroundColor: hex }}
                    />
                  )
                })}
              </div>
              <div className="flex">
                {scale.map(({ stop }) => (
                  <span
                    key={stop}
                    className="flex-1 text-center text-[9px] text-[var(--ov-text-ghost)]"
                  >
                    {stop}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <details className="text-[11px] text-[var(--ov-text-dim)]">
          <summary className="cursor-pointer text-[var(--ov-text-ghost)]">
            Scale rows (compact list)
          </summary>
          <div className="mt-2">
            <ScaleView scales={scales} figmaSvg={figmaSvg} />
          </div>
        </details>
      </main>

      <NameThemeDialog
        open={nameOpen}
        onOpenChange={setNameOpen}
        initialName={setName}
        title="Save scale set"
        description="Give this scale set a name to keep it in your library."
        onConfirm={saveNew}
      />
      <LibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        initialFilter="scales"
        onOpen={openSaved}
      />
      <Toaster />
    </div>
  )
}

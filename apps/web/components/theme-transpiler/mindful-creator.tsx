"use client"

// /mindfulpalettes — generate a full shadcn theme from a 6-color Mindful Palette
// (2 light · 2 accent · 2 dark), per Alex Cristache's #MindfulPalettes format.
// Shares the editor chrome (overrides, mode, radius, apply-to-page) with the
// other tools via useThemeEditor + EditorShell; this island adds the 6-color
// input, the accent/neutral scales output, and the preset picker.

import { useCallback, useEffect, useMemo, useState } from "react"

import { Toaster } from "@/components/ui/sonner"
import {
  analyzeMindful,
  mindfulToThemeStyles,
  MINDFUL_PRESETS,
} from "@/lib/theme-engine"
import type { MindfulColors } from "@/lib/theme-engine"

import { EditorShell } from "./editor-shell"
import { LibraryControls } from "./library-controls"
import { MindfulInput } from "./mindful-input"
import { MindfulReadout } from "./mindful-readout"
import { Toolbar } from "./toolbar"
import { useThemeEditor } from "./use-theme-editor"

const DEFAULT_COLORS = MINDFUL_PRESETS[0].colors

// The six source colors, offered in the token-override "source colors" popover.
const sourceSwatches = (c: MindfulColors) => [
  { slot: "light-1", hex: c.light1 },
  { slot: "light-2", hex: c.light2 },
  { slot: "accent-1", hex: c.accent1 },
  { slot: "accent-2", hex: c.accent2 },
  { slot: "dark-1", hex: c.dark1 },
  { slot: "dark-2", hex: c.dark2 },
]

export function MindfulCreator() {
  const editor = useThemeEditor()
  const [colors, setColors] = useState<MindfulColors>(DEFAULT_COLORS)
  const [gen, setGen] = useState<MindfulColors>(DEFAULT_COLORS)

  const generate = useCallback(
    (c: MindfulColors, source = "Mindful palette") => {
      editor.loadBase(mindfulToThemeStyles(c), {
        source,
        swatches: sourceSwatches(c),
      })
      setGen(c)
    },
    [editor]
  )

  // Generate once on mount with the first preset so the page is never empty.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time seed on mount; generate calls editor.loadBase (dispatch) + setGen once
    generate(DEFAULT_COLORS) // oxlint-disable-line react-compiler -- same intentional one-time mount seed as the eslint-disable above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onColor = (key: keyof MindfulColors, hex: string) =>
    setColors((prev) => ({ ...prev, [key]: hex }))

  const onPreset = (id: string) => {
    const preset = MINDFUL_PRESETS.find((p) => p.id === id)
    if (!preset) {
      return
    }
    setColors(preset.colors)
    generate(preset.colors, preset.name)
  }

  const report = useMemo(() => analyzeMindful(gen), [gen])

  return (
    <EditorShell
      editor={editor}
      toolbar={
        <Toolbar
          theme={editor.theme}
          radius={editor.radius}
          name={editor.source}
          title="mindful → shadcn"
          extra={<LibraryControls editor={editor} />}
        />
      }
      input={
        <MindfulInput
          colors={colors}
          onColor={onColor}
          onPreset={onPreset}
          onGenerate={() => generate(colors)}
        />
      }
      output={<MindfulReadout report={report} />}
    >
      <Toaster />
    </EditorShell>
  )
}

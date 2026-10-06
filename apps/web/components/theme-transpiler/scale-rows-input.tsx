"use client"

// Row-list input for the /tailwind tool's boom bar: one color swatch + scale
// name + neutral toggle per row, with add/remove and a Generate button.

import { SwatchPopover } from "./swatch-popover"

export interface ScaleRow {
  id: string
  name: string
  color: string
  neutral: boolean
}

interface ScaleRowsInputProps {
  rows: ScaleRow[]
  onChange: (rows: ScaleRow[]) => void
  onGenerate: () => void
  /** "inline" (default) wraps rows in one line; "stacked" renders one row per
   *  line with full-width actions — for sidebar layouts. */
  layout?: "inline" | "stacked"
}

const MAX_ROWS = 8
const DEFAULT_ROW_COLOR = "#8b5cf6"

function newRowId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return String(Date.now())
  }
}

/** Blur-time cleanup for a scale name: lowercase, spaces to dashes, strip
 *  anything outside [a-z0-9-]. Falls back to `scale-{index+1}` when empty.
 *  Duplicates are left as-is here — the parent sanitizes on generate. */
function sanitizeRowName(raw: string, index: number): string {
  const clean = raw
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/[^a-z0-9-]/g, "")
  return clean || `scale-${index + 1}`
}

export function ScaleRowsInput({
  rows,
  onChange,
  onGenerate,
  layout = "inline",
}: ScaleRowsInputProps) {
  const update = (id: string, patch: Partial<ScaleRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  const add = () => {
    if (rows.length >= MAX_ROWS) {
      return
    }
    onChange([
      ...rows,
      {
        id: newRowId(),
        name: `scale-${rows.length + 1}`,
        color: DEFAULT_ROW_COLOR,
        neutral: false,
      },
    ])
  }
  const addDisabled = rows.length >= MAX_ROWS

  if (layout === "stacked") {
    return (
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div
            key={row.id}
            className="flex items-center gap-1.5 rounded-[var(--ov-radius-xs)] border border-[var(--ov-border)] bg-[var(--ov-surface-2)] px-2 py-1.5"
          >
            <SwatchPopover
              value={row.color}
              onChange={(hex) => update(row.id, { color: hex })}
              title={`${row.name}: ${row.color}`}
              className="size-[22px]"
            />
            <input
              type="text"
              value={row.name}
              onChange={(e) => update(row.id, { name: e.target.value })}
              onBlur={() => {
                const clean = sanitizeRowName(row.name, index)
                if (clean !== row.name) {
                  update(row.id, { name: clean })
                }
              }}
              aria-label="Scale name"
              spellCheck={false}
              className="ov-input min-w-0 flex-1"
            />
            <label
              title="Clamp chroma so grays stay gray"
              className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-[var(--ov-text-dim)]"
            >
              <input
                type="checkbox"
                checked={row.neutral}
                onChange={(e) => update(row.id, { neutral: e.target.checked })}
              />
              neutral
            </label>
            <button
              type="button"
              className="ov-btn shrink-0 px-1.5"
              onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
              disabled={rows.length <= 1}
              aria-label="Remove scale"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ov-btn w-full"
          onClick={add}
          disabled={addDisabled}
          title={addDisabled ? "Maximum of 8 scales" : undefined}
        >
          + Add scale
        </button>
        <button
          type="button"
          className="ov-btn ov-btn-primary w-full"
          onClick={onGenerate}
        >
          Generate
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-1.5">
          <SwatchPopover
            value={row.color}
            onChange={(hex) => update(row.id, { color: hex })}
            title={`${row.name}: ${row.color}`}
            className="size-[18px]"
          />
          <input
            type="text"
            value={row.name}
            onChange={(e) => update(row.id, { name: e.target.value })}
            onBlur={() => {
              const clean = sanitizeRowName(row.name, index)
              if (clean !== row.name) {
                update(row.id, { name: clean })
              }
            }}
            aria-label="Scale name"
            spellCheck={false}
            className="ov-input w-28"
          />
          <label
            title="Clamp chroma so grays stay gray"
            className="flex cursor-pointer items-center gap-1 text-[11px] text-[var(--ov-text-dim)]"
          >
            <input
              type="checkbox"
              checked={row.neutral}
              onChange={(e) => update(row.id, { neutral: e.target.checked })}
            />
            neutral
          </label>
          <button
            type="button"
            className="ov-btn px-1.5"
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
            disabled={rows.length <= 1}
            aria-label="Remove scale"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ov-btn"
        onClick={add}
        disabled={addDisabled}
        title={addDisabled ? "Maximum of 8 scales" : undefined}
      >
        + Add scale
      </button>
      <button
        type="button"
        className="ov-btn ov-btn-primary"
        onClick={onGenerate}
      >
        Generate
      </button>
    </div>
  )
}

"use client"

// Editable per-token controls, grouped, in the overlay's panel style. The
// light/dark toggle is a sticky header (like the overlay theme panel); radius is
// a normal variable; each color row can be overridden from the 9 SVG colors.

import { ColorPicker } from "./color-picker"
import type { SourceColor } from "./color-picker"
import { THEME_TOKEN_GROUPS } from "@themelab/theme-ui"

interface TokenControlsProps {
  vars: Record<string, string>
  /** Tokens overridden in the current mode (label rendered in accent). */
  edited: Set<string>
  mode: "light" | "dark"
  radius: string
  /** The 9 HR source colors, for one-click overrides. */
  palette: SourceColor[]
  onMode: (mode: "light" | "dark") => void
  onToken: (token: string, value: string) => void
  onRadius: (value: string) => void
}

export function TokenControls({
  vars,
  edited,
  mode,
  radius,
  palette,
  onMode,
  onToken,
  onRadius,
}: TokenControlsProps) {
  return (
    <div className="flex min-w-0 flex-col">
      {/* Light/dark toggle, like the overlay theme panel's header. */}
      <div className="sticky top-0 z-10 border-b border-[var(--ov-border)] bg-[var(--ov-bg)] px-3 py-2">
        <div className="ov-seg w-full" role="tablist" aria-label="Edit mode">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              data-active={mode === m}
              className="ov-seg-btn flex-1"
              onClick={() => onMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4 p-3">
        <div className="flex flex-col gap-1">
          <h4 className="px-1 text-[10px] font-semibold tracking-wide text-[var(--ov-text-ghost)] uppercase">
            Radius
          </h4>
          <div className="ov-row">
            <span
              className="size-[18px] shrink-0 border border-[var(--ov-border)]"
              style={{ borderRadius: radius }}
            />
            <span className="w-28 shrink-0 truncate text-[11px] text-[var(--ov-text-dim)]">
              radius
            </span>
            <input
              type="text"
              value={radius}
              onChange={(e) => onRadius(e.target.value)}
              spellCheck={false}
              className="ov-input min-w-0 flex-1 tabular-nums"
            />
          </div>
        </div>

        {THEME_TOKEN_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <h4 className="px-1 text-[10px] font-semibold tracking-wide text-[var(--ov-text-ghost)] uppercase">
              {group.label}
            </h4>
            <div className="flex flex-col">
              {group.tokens.map((token) => (
                <ColorPicker
                  key={token}
                  token={token}
                  value={vars[token] ?? "oklch(0 0 0)"}
                  edited={edited.has(token)}
                  palette={palette}
                  onChange={(v) => onToken(token, v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

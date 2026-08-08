import { contrastRatio, toOklch } from "@themelab/theme-engine"

/** The Web theme editor's canonical token grouping. */
export const THEME_TOKEN_GROUPS: ReadonlyArray<{ label: string; tokens: readonly string[] }> = [
  { label: "Base", tokens: ["background", "foreground"] },
  { label: "Primary", tokens: ["primary", "primary-foreground"] },
  { label: "Secondary", tokens: ["secondary", "secondary-foreground"] },
  { label: "Accent", tokens: ["accent", "accent-foreground"] },
  { label: "Card & Popover", tokens: ["card", "card-foreground", "popover", "popover-foreground"] },
  { label: "Muted", tokens: ["muted", "muted-foreground"] },
  { label: "Destructive", tokens: ["destructive", "destructive-foreground"] },
  { label: "Border · Input · Ring", tokens: ["border", "input", "ring"] },
  { label: "Charts", tokens: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] },
  { label: "Sidebar", tokens: ["sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring"] },
]

export interface TokenContrast {
  background: string
  foreground: string
  ratio: number | null
  passesAA: boolean | null
}

/** Shared, parser-backed quality readout for the base and semantic text pairs. */
export function tokenContrast(vars: Record<string, string>): TokenContrast[] {
  return [["background", "foreground"], ["primary", "primary-foreground"], ["secondary", "secondary-foreground"], ["accent", "accent-foreground"], ["destructive", "destructive-foreground"]]
    .map(([background, foreground]) => {
      const back = toOklch(vars[background] ?? "")
      const front = toOklch(vars[foreground] ?? "")
      const ratio = back && front ? contrastRatio(vars[background], vars[foreground]) : null
      return { background, foreground, ratio, passesAA: ratio === null ? null : ratio >= 4.5 }
    })
}

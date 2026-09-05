import type { ReactNode } from "react"

import { THEME_TOKEN_GROUPS } from "./token-model"

export interface ThemeTokenSectionsProps {
  /** Values detected from the active theme source. Missing tokens stay hidden. */
  vars: Record<string, string>
  /** Product-owned token row. This keeps file writing and popover placement local. */
  renderToken: (token: string, value: string) => ReactNode
  className?: string
  groupClassName?: string
  labelClassName?: string
}

/**
 * Canonical token ordering and grouping shared by the Web studio and Desktop.
 *
 * Products supply their own row because their popovers live in different
 * compositor contexts, but they no longer duplicate the semantic theme map.
 */
export function ThemeTokenSections({
  vars,
  renderToken,
  className,
  groupClassName,
  labelClassName,
}: ThemeTokenSectionsProps) {
  const groups = THEME_TOKEN_GROUPS.map((group) => ({
    ...group,
    tokens: group.tokens.filter((token) => token in vars),
  })).filter((group) => group.tokens.length > 0)

  return (
    <div className={className}>
      {groups.map((group) => (
        <section className={groupClassName} key={group.label}>
          <h4 className={labelClassName}>{group.label}</h4>
          {group.tokens.map((token) => renderToken(token, vars[token] ?? ""))}
        </section>
      ))}
    </div>
  )
}

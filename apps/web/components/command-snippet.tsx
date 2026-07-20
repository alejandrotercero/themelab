"use client"

import { CaretDownIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { SnippetCopyButton } from "@/components/kibo-ui/snippet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export interface Command {
  label: string
  code: string
}

interface Props {
  commands: Command[]
  className?: string
}

// Terminal-style install bar: a dropdown on the left picks the method, the
// chosen command renders inline, and the copy button reflects it. Styled as a
// fixed dark surface (a terminal reads the same in light and dark themes).
export function CommandSnippet({ commands, className }: Props) {
  const [value, setValue] = useState(commands[0]?.label)
  const active =
    commands.find((command) => command.label === value) ?? commands[0]

  // Split the leading program name off so it can be tinted like a shell prompt.
  const [program, ...rest] = active.code.split(" ")

  return (
    <div
      className={cn(
        "flex w-fit max-w-full items-center gap-3 rounded-lg border border-border bg-card py-1.5 pr-1.5 pl-2 text-card-foreground",
        className
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {active.label}
          <CaretDownIcon
            weight="bold"
            className="size-3.5 text-muted-foreground"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => setValue(next as string)}
          >
            {commands.map((command) => (
              <DropdownMenuRadioItem key={command.label} value={command.label}>
                {command.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <code className="truncate font-mono text-sm">
        <span className="text-rose-400">{program}</span>
        {rest.length > 0 && (
          <span className="text-foreground"> {rest.join(" ")}</span>
        )}
      </code>

      <SnippetCopyButton
        value={active.code}
        className="ml-auto size-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      />
    </div>
  )
}

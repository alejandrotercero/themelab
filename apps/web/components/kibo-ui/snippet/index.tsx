"use client"

import { CheckIcon, CopyIcon } from "lucide-react"
import { cloneElement, useState } from "react"
import type { ComponentProps, HTMLAttributes, ReactElement } from "react"

import { Button } from "@/components/ui/button"
import type { TabsList } from "@/components/ui/tabs"
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export { TabsList as SnippetTabsList } from "@/components/ui/tabs"

export type SnippetProps = ComponentProps<typeof Tabs>

export const Snippet = ({ className, ...props }: SnippetProps) => (
  <Tabs
    className={cn(
      "group w-full gap-0 overflow-hidden rounded-md border",
      className
    )}
    {...props}
  />
)

export type SnippetHeaderProps = HTMLAttributes<HTMLDivElement>

export const SnippetHeader = ({ className, ...props }: SnippetHeaderProps) => (
  <div
    className={cn(
      "flex flex-row items-center justify-between border-b bg-secondary p-1",
      className
    )}
    {...props}
  />
)

export type SnippetCopyButtonProps = ComponentProps<typeof Button> & {
  asChild?: boolean
  value: string
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const SnippetCopyButton = ({
  asChild,
  value,
  onCopy,
  onError,
  timeout = 2000,
  children,
  ...props
}: SnippetCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)

  const copyToClipboard = async () => {
    if (
      typeof window === "undefined" ||
      !navigator.clipboard.writeText ||
      !value
    ) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setIsCopied(true)
      onCopy?.()

      setTimeout(() => setIsCopied(false), timeout)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  if (asChild) {
    // oxlint-disable-next-line react/no-clone-element -- asChild pattern needs to merge onClick onto the caller-supplied child element; a render-prop replacement would change this component's public API
    return cloneElement(children as ReactElement, {
      // @ts-expect-error - we know this is a button
      onClick: copyToClipboard,
    })
  }

  const icon = isCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />

  return (
    <Button
      className="opacity-0 transition-opacity group-hover:opacity-100"
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? icon}
    </Button>
  )
}

export type SnippetTabsListProps = ComponentProps<typeof TabsList>

export type SnippetTabsTriggerProps = ComponentProps<typeof TabsTrigger>

export const SnippetTabsTrigger = ({
  className,
  ...props
}: SnippetTabsTriggerProps) => (
  <TabsTrigger className={cn("gap-1.5", className)} {...props} />
)

export type SnippetTabsContentProps = ComponentProps<typeof TabsContent>

export const SnippetTabsContent = ({
  className,
  children,
  ...props
}: SnippetTabsContentProps) => (
  // base-ui's Tabs.Panel has no `asChild` (it is not Radix), so the <pre> is
  // nested as a child rather than merged onto the panel element.
  <TabsContent
    className={cn("mt-0 bg-background p-4 text-sm", className)}
    {...props}
  >
    <pre className="truncate">{children}</pre>
  </TabsContent>
)

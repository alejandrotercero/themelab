import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-heading",
    "rounded-lg", // border-radius: var(--radius-md) → derived from the theme --radius
    "text-sm font-medium",
    "ring-offset-background transition-colors",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    // auto-spacing for icons
    "[&_[data-icon=inline-start]>svg]:mr-0",
    "[&_[data-icon=inline-end]>svg]:ml-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        outline:
          "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        link: "text-primary underline-offset-4 hover:underline",

        // ── Relume compatibility variants (for dark/inverted backgrounds) ──
        "outline-alt":
          "border border-border-alternative text-text-alternative bg-transparent hover:bg-text-alternative/10",
        "link-alt":
          "text-text-alternative underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        xs: "h-7 px-2 text-xs",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "size-9",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        "icon-lg": "size-10",

        // ── Relume compatibility size (zero-padding, auto-height) ──
        link: "h-auto p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

interface ButtonBaseProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  iconLeft?: React.ReactNode
  iconRight?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonBaseProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
export type { ButtonBaseProps as ButtonProps }

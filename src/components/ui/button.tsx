import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    // ── Base ──
    "group relative inline-flex items-center justify-center gap-2",
    "whitespace-nowrap text-sm font-medium tracking-wide uppercase",
    "transition-all duration-150 ease-out overflow-hidden",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
    "outline-none focus-visible:ring-1 focus-visible:ring-ring",
    "cursor-pointer select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        // Filled primary — solid bg, light text
        default: [
          "bg-primary text-primary-foreground border border-primary",
          "hover:brightness-110 active:brightness-95",
        ].join(" "),

        // Ghost — transparent bg, border on hover
        ghost: [
          "bg-transparent text-foreground border border-transparent",
          "hover:border-border",
        ].join(" "),

        // Outline — thin border, transparent bg
        outline: [
          "bg-transparent text-foreground border border-primary",
          "hover:text-primary hover:border-primary",
        ].join(" "),

        // Destructive — hot coral
        destructive: [
          "bg-destructive text-white border border-destructive",
          "hover:brightness-110 active:brightness-95",
        ].join(" "),

        // Secondary — subtle fill
        secondary: [
          "bg-secondary text-secondary-foreground border border-border",
          "hover:bg-secondary/80",
        ].join(" "),

        // Link — minimal, underline
        link: "text-primary underline-offset-4 hover:underline border-none",
      },
      size: {
        default: "h-9 px-6 py-2",
        xs: "h-6 px-3 text-[11px] gap-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 px-5 gap-1.5 text-xs",
        lg: "h-10 px-10 text-sm",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const showRunner = variant !== "link"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {/* Slant overlay runner — sweeps across on hover */}
      {showRunner && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 z-0",
            "translate-x-[-110%] skew-x-[-20deg]",
            "group-hover:translate-x-[110%]",
            "transition-transform duration-300 ease-out",
            variant === "default" || variant === "destructive"
              ? "bg-white/15"
              : "bg-primary/8"
          )}
        />
      )}

      {/* Content sits above the runner */}
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
      </span>
    </Comp>
  )
}

export { Button, buttonVariants }

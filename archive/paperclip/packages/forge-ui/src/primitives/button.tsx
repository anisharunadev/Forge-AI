import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../tokens/cn";

/**
 * Button — Shadcn-style primitive using KnackForge brand tokens.
 * Variants follow Plan 3 §3.1 brand colours. Primary actions get a
 * minimum 32×32 hit target (Plan 3 §5.1: WCAG 2.5.8); secondary 24×24.
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-sans text-body font-medium",
    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        primary:
          "bg-brand-primary text-ink-inverse hover:opacity-90 active:opacity-80",
        secondary:
          "bg-surface-raised text-ink-default border border-surface-border hover:bg-surface-sunken",
        ghost:
          "bg-transparent text-ink-default hover:bg-surface-raised",
        danger:
          "bg-brand-danger text-ink-inverse hover:opacity-90",
        link: "text-brand-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 rounded-sm min-w-[64px]",
        md: "h-10 px-4 rounded-md min-w-[80px]",
        lg: "h-12 px-6 rounded-md min-w-[96px] text-body-lg",
        icon: "h-10 w-10 rounded-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, asChild, type, ...props }, ref) {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type ?? "button"}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);

export { buttonVariants };
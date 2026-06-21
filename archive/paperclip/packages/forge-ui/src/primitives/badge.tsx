import type { JSX } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../tokens/cn";

const badgeVariants = cva(
  cn(
    "inline-flex items-center gap-1 rounded-sm px-2 py-0.5",
    "text-caption font-medium uppercase tracking-wide",
  ),
  {
    variants: {
      tone: {
        neutral: "bg-surface-raised text-ink-muted border border-surface-border",
        success: "bg-brand-success/10 text-brand-success border border-brand-success/30",
        warn: "bg-brand-warn/10 text-brand-warn border border-brand-warn/30",
        danger: "bg-brand-danger/10 text-brand-danger border border-brand-danger/30",
        primary: "bg-brand-primary/10 text-brand-primary border border-brand-primary/30",
        accent: "bg-brand-accent/10 text-brand-accent border border-brand-accent/30",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
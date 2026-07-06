import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

export type BadgeTone =
  | 'cyan'
  | 'idle'
  | 'amber'
  | 'rose'
  | 'emerald'
  | 'indigo'
  | 'violet'
  | 'muted';

const toneClasses: Record<BadgeTone, string> = {
  cyan: 'border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]',
  idle: 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
  amber: 'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]',
  rose: 'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]',
  emerald: 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]',
  indigo: 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]',
  violet: 'border-[var(--accent-violet)]/40 bg-[var(--accent-violet)]/10 text-[var(--accent-violet)]',
  muted: 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
};

const sizeClasses: Record<'sm' | 'md', string> = {
  sm: 'px-1.5 py-0 text-[10px]',
  md: 'px-2.5 py-0.5 text-xs',
};

const badgeVariants = cva(
  'inline-flex items-center rounded-md border font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * Domain-tone shortcut. When set, renders with the tone classes
   * (cyan/idle/amber/rose/emerald/indigo/violet/muted). Takes
   * precedence over `variant` for color but keeps the shape.
   */
  tone?: BadgeTone;
  /**
   * Size shortcut. `sm` matches the legacy chip used in the
   * workflow gallery; `md` matches the shadcn default.
   */
  size?: 'sm' | 'md';
}

function Badge({ className, variant, tone, size = 'md', ...props }: BadgeProps) {
  // When a tone is supplied we ignore the cva variant and apply the
  // tone classes directly. This keeps the existing call sites
  // working without forking the shadcn primitive.
  const toneClass = tone ? toneClasses[tone] : cn(badgeVariants({ variant }));
  return (
    <div
      className={cn('inline-flex items-center rounded-md border font-semibold', sizeClasses[size], toneClass, className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };

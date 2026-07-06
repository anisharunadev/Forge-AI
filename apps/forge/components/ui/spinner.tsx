import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual size — sm fits inside buttons, md is the default, lg for hero. */
  size?: 'sm' | 'md' | 'lg';
  /** When true, render with `role="status"` and announce "Loading…". */
  label?: string;
}

const sizeClasses: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-3 w-3 border',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

export function Spinner({ className, size = 'md', label = 'Loading…', ...rest }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent text-current',
        sizeClasses[size],
        className,
      )}
      {...rest}
    />
  );
}

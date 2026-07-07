/**
 * Spinner — Day 5 minimal loading indicator.
 *
 * ponytail: this stub exists because WorkflowEditor imports `@/components/ui/spinner`
 * but the component was never created. Full visual treatment is out of Day 5 scope;
 * this renders an inline SVG that the editor can drop in where it currently
 * expects one. Replace with the design-system spinner when available.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
}

export function Spinner({ size = 16, className, ...props }: SpinnerProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('animate-spin', className)}
      aria-hidden="true"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

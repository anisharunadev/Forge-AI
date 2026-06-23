import * as React from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * SectionCard — the standard container for a section on a center page.
 *
 * Wraps the shadcn `<Card>` primitive with a stable header layout:
 *   - title (h2) + description on the left
 *   - headerRight on the right (e.g., a "View all" button, a counter)
 *   - content (children) in the body
 *
 * Visual weight: `bg-card text-card-foreground border border-border rounded-lg`.
 * Uses semantic tokens exclusively; no `forge-*` literal classes.
 */

export interface SectionCardProps {
  /** Section title (h2). */
  title?: string;
  /** Optional muted description under the title. */
  description?: string;
  /** Optional slot for a right-aligned header element. */
  headerRight?: React.ReactNode;
  /** Body content. */
  children: React.ReactNode;
  /** Extra classes appended to the root. */
  className?: string;
  /** Optional data-testid passthrough. */
  testId?: string;
}

export function SectionCard({
  title,
  description,
  headerRight,
  children,
  className,
  testId,
}: SectionCardProps) {
  const hasHeader = Boolean(title) || Boolean(headerRight);
  return (
    <Card
      className={cn('border border-border bg-card text-card-foreground', className)}
      data-testid={testId}
    >
      {hasHeader ? (
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="flex flex-col gap-1">
            {title ? (
              <CardTitle className="text-lg font-semibold text-foreground">
                {title}
              </CardTitle>
            ) : null}
            {description ? (
              <CardDescription className="text-sm text-muted-foreground">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {headerRight ? (
            <div className="shrink-0">{headerRight}</div>
          ) : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn(hasHeader ? 'pt-0' : 'p-6')}>{children}</CardContent>
    </Card>
  );
}
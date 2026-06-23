import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * PageHeader — the standard header chrome for center pages.
 *
 * Replaces the bespoke `<header>` markup that previously lived
 * inline in each center page (`text-xs uppercase tracking-wider`,
 * bespoke H1 styling, etc.) with a single primitive that reads
 * from semantic tokens.
 *
 * Layout:
 *   - Mobile: vertical stack (eyebrow → title → description; action
 *     drops to a new line below the description).
 *   - md+: flex row, title-block on the left, action on the right.
 *
 * Tokens used (no `forge-*` literals):
 *   - text-foreground, text-muted-foreground, text-subtle
 *
 * Back-compat: the `data-testid="page-header"` and
 * `data-page-title` attributes are exposed so existing testids
 * (`*-center`, `-dashboard`, etc.) on parent pages still resolve.
 */

export interface PageHeaderProps {
  /** Small uppercase eyebrow text above the title (e.g., "Center"). */
  eyebrow?: string;
  /** H1 title. */
  title: string;
  /** Optional muted description below the title. */
  description?: string;
  /** Optional leading icon (e.g., lucide-react component). */
  icon?: React.ReactNode;
  /** Optional right-aligned action (e.g., AddConnectorDialog). */
  action?: React.ReactNode;
  /** Optional breadcrumbs rendered above the eyebrow. */
  breadcrumbs?: ReadonlyArray<{ label: string; href?: string }>;
  /** Extra classes appended to the root. */
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  action,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn('flex flex-col gap-3', className)}
      data-testid="page-header"
      data-page-title={title}
    >
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={`${b.label}-${i}`}>
              {i > 0 ? (
                <span aria-hidden="true" className="text-subtle">
                  /
                </span>
              ) : null}
              {b.href ? (
                <a
                  href={b.href}
                  className="rounded text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  data-testid={`page-breadcrumb-${b.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {b.label}
                </a>
              ) : (
                <span aria-current="page" className="text-foreground">
                  {b.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </nav>
      ) : null}

      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          {eyebrow ? (
            <p className="text-2xs uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            {icon ? (
              <span
                aria-hidden="true"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground"
              >
                {icon}
              </span>
            ) : null}
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
          </div>
          {description ? (
            <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-2" data-testid="page-header-action">
            {action}
          </div>
        ) : null}
      </div>
    </header>
  );
}
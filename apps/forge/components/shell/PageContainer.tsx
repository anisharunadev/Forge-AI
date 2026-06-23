import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PageContainerProps {
  readonly children: React.ReactNode;
  /** Skip the max-w-7xl wrapper (for full-bleed pages like the terminal). */
  readonly bare?: boolean;
  /** Small uppercase eyebrow above the title. */
  readonly eyebrow?: string;
  /** Page title — when present, the header block is rendered. */
  readonly title?: string;
  /** Short description under the title. */
  readonly description?: string;
  /** Optional className passthrough. */
  readonly className?: string;
}

/**
 * Per-route page container.
 *
 * Default: `mx-auto w-full max-w-7xl px-6 py-8`. When `eyebrow`,
 * `title`, or `description` are provided, a header block is rendered
 * above the children.
 *
 * Pages with custom chrome (e.g. terminal center) can opt out of the
 * max-w-7xl with `bare`.
 *
 * Note: breadcrumbs live at the shell boundary (between Topbar and
 * main) so they have access to `usePathname()` without each page
 * needing to wire them up.
 */
export function PageContainer({
  children,
  bare,
  eyebrow,
  title,
  description,
  className,
}: PageContainerProps) {
  if (bare) {
    return <div className={className}>{children}</div>;
  }

  const hasHeader = Boolean(eyebrow || title || description);

  return (
    <div
      data-testid="page-container"
      className={cn('mx-auto w-full max-w-7xl px-6 py-8', className)}
    >
      {hasHeader ? (
        <header className="mb-8 space-y-1">
          {eyebrow ? (
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <h1 className="text-24 font-semibold tracking-tight">{title}</h1>
          ) : null}
          {description ? (
            <p className="text-14 text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}

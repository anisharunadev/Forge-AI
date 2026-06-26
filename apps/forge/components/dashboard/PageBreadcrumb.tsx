'use client';

/**
 * PageBreadcrumb — shared top-of-page breadcrumb (Fix 7).
 *
 * Renders a small horizontal trail above the page header. The first
 * crumb is always "Workspace" (links to the first available
 * workspace root). Subsequent crumbs are passed in via props so the
 * component is route-agnostic.
 *
 * Design:
 *   - lucide Home 12 px in --fg-tertiary
 *   - labels: --text-xs --fg-tertiary (links) and --fg-secondary (current)
 *   - chevron-right 10 px in --fg-muted
 *   - sticky below the top shell header when the page scrolls
 *
 * Skill influence:
 *   - `ux` (Breadcrumbs) — used on pages with 2+ levels of depth.
 *   - `ux` (Sticky Navigation) — fixed breadcrumb with safe spacing.
 */

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface BreadcrumbCrumb {
  label: string;
  href?: string;
}

export interface PageBreadcrumbProps {
  crumbs: ReadonlyArray<BreadcrumbCrumb>;
  /** Optional className for the wrapper. */
  className?: string;
}

export function PageBreadcrumb({ crumbs, className }: PageBreadcrumbProps) {
  // Always prepend "Workspace" → "/" (first available workspace page).
  const all: BreadcrumbCrumb[] = [{ label: 'Workspace', href: '/' }, ...crumbs];
  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="page-breadcrumb"
      className={cn(
        'sticky top-0 z-20 -mx-4 flex items-center gap-1.5 bg-[var(--bg-base)]/85 px-4 py-1.5 text-[var(--text-xs)] backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-base)]/70 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8',
        className,
      )}
    >
      <ol className="flex min-w-0 items-center gap-1.5">
        {all.map((c, i) => {
          const isFirst = i === 0;
          const isLast = i === all.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {isFirst ? (
                <Link
                  href={c.href ?? '/'}
                  className="inline-flex items-center gap-1 text-[var(--fg-tertiary)] hover:text-[var(--accent-primary)]"
                >
                  <Home className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{c.label}</span>
                </Link>
              ) : isLast || !c.href ? (
                <span
                  aria-current="page"
                  className="truncate text-[var(--fg-secondary)]"
                  data-testid={`breadcrumb-current`}
                >
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="truncate text-[var(--fg-tertiary)] hover:text-[var(--accent-primary)]"
                >
                  {c.label}
                </Link>
              )}
              {!isLast ? (
                <ChevronRight aria-hidden="true" className="h-2.5 w-2.5 shrink-0 text-[var(--fg-muted)]" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
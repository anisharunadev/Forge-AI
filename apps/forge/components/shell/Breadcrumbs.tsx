import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface BreadcrumbSegment {
  readonly label: string;
  readonly href?: string;
}

export interface BreadcrumbsProps {
  readonly segments: ReadonlyArray<BreadcrumbSegment>;
  /** Optional className passthrough. */
  readonly className?: string;
}

const MAX_VISIBLE = 4;

/** Humanize a URL segment: `epics` -> `Epics`, `draft-prd` -> `Draft prd`. */
function humanize(segment: string): string {
  // Treat route-param placeholders as IDs we don't want to surface.
  if (segment.startsWith('[') && segment.endsWith(']')) return '…';
  const cleaned = segment.replace(/-/g, ' ').replace(/_/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Pathname-derived breadcrumb trail.
 *
 * Pass a pre-computed `segments` array so the component itself stays
 * server-importable; the calling client wrapper derives segments from
 * `usePathname()`.
 *
 * Long trails collapse with a `…` ellipsis at the second position.
 */
export function Breadcrumbs({ segments, className }: BreadcrumbsProps) {
  const items: ReadonlyArray<BreadcrumbSegment> = segments;

  if (items.length === 0) {
    return null;
  }

  // Collapse middle items if we exceed MAX_VISIBLE.
  let visible: ReadonlyArray<BreadcrumbSegment>;
  let showEllipsis = false;
  if (items.length <= MAX_VISIBLE) {
    visible = items;
  } else {
    // Always show first and last; truncate the middle.
    const head = items[0];
    const tail = items.slice(items.length - (MAX_VISIBLE - 1));
    visible =
      head !== undefined ? [head, ...tail] : [...tail];
    showEllipsis = true;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="breadcrumbs"
      className={cn(
        'border-b border-border bg-background/60 px-4 py-2 text-xs md:px-6',
        className,
      )}
    >
      <ol className="mx-auto flex max-w-7xl items-center gap-1.5">
        {/* Home icon always first */}
        <li className="flex items-center gap-1.5">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
            aria-label="Home"
          >
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <ChevronRight
            className="h-3 w-3 text-muted-foreground/60"
            aria-hidden="true"
          />
        </li>

        {visible.map((segment, idx) => {
          const isLast = idx === visible.length - 1;
          const isEllipsisSlot = showEllipsis && idx === 1;
          const href =
            segment.href ??
            (isLast ? undefined : '/' + items.slice(0, items.length - (visible.length - 1 - idx)).map((s) => encodeURIComponent(s.label.toLowerCase().replace(/\s+/g, '-'))).join('/'));

          if (isEllipsisSlot) {
            return (
              <li
                key={`ellipsis-${idx}`}
                className="flex items-center gap-1.5"
              >
                <span className="text-muted-foreground" aria-hidden="true">
                  …
                </span>
                <ChevronRight
                  className="h-3 w-3 text-muted-foreground/60"
                  aria-hidden="true"
                />
              </li>
            );
          }

          return (
            <li
              key={`${segment.label}-${idx}`}
              className="flex items-center gap-1.5"
            >
              {isLast || !href ? (
                <span
                  className="font-medium text-foreground"
                  aria-current="page"
                >
                  {segment.label}
                </span>
              ) : (
                <Link
                  href={href}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {segment.label}
                </Link>
              )}
              {!isLast ? (
                <ChevronRight
                  className="h-3 w-3 text-muted-foreground/60"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Convert a pathname like `/project-intelligence/drafts/abc` into segments. */
export function pathnameToSegments(pathname: string): ReadonlyArray<BreadcrumbSegment> {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    return [{ label: 'Dashboard', href: '/dashboard' }];
  }
  let acc = '';
  return parts.map((part) => {
    acc += '/' + part;
    return {
      label: humanize(decodeURIComponent(part)),
      href: acc,
    };
  });
}

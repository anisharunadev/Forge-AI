'use client';

import { usePathname } from 'next/navigation';

import { Breadcrumbs, pathnameToSegments } from './Breadcrumbs';

/**
 * Thin client wrapper that derives breadcrumbs from the live pathname
 * and hands them to the presentational `<Breadcrumbs>` component.
 */
export function ShellBreadcrumbs() {
  const pathname = usePathname() ?? '/';
  const segments = pathnameToSegments(pathname);
  return <Breadcrumbs segments={segments} />;
}

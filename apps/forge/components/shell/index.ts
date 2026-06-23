/**
 * Barrel export for the shell primitive layer.
 *
 * Components in `components/shell/` are design-system primitives shared
 * across the app. New shell primitives should be exported here so callers
 * can do:
 *
 *   import {
 *     StatusPill, PageHeader, EmptyState, SectionCard,
 *     Sidebar, Topbar, MobileNav, CommandPalette, ThemeToggle,
 *     PageContainer, Breadcrumbs, ShellBreadcrumbs,
 *   } from '@/components/shell';
 *
 * Server-importable data lives in `nav-config.ts`.
 */

// --- Primitives (0.5-02) ---
export { StatusPill } from './StatusPill';
export type { StatusPillProps, StatusPillSize } from './StatusPill';

export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { SectionCard } from './SectionCard';
export type { SectionCardProps } from './SectionCard';

// --- Application shell (0.5-03) ---
export { ShellProvider, useShell } from './ShellProvider';
export { Sidebar, NavList } from './Sidebar';
export { Topbar } from './Topbar';
export { MobileNav } from './MobileNav';
export { CommandPalette } from './CommandPalette';
export { ThemeToggle } from './ThemeToggle';
export { PageContainer } from './PageContainer';
export type { PageContainerProps } from './PageContainer';
export { Breadcrumbs, pathnameToSegments } from './Breadcrumbs';
export type {
  BreadcrumbsProps,
  BreadcrumbSegment,
} from './Breadcrumbs';
export { ShellBreadcrumbs } from './ShellBreadcrumbs';

// --- Navigation config (server-importable data + helpers) ---
export {
  NAV,
  GROUP_LABELS,
  ICONS,
  groupedNav,
  searchNav,
  isNavMatch,
} from './nav-config';
export type { NavItem, NavGroup, IconName } from './nav-config';
export type { GroupedNav } from './nav-config';

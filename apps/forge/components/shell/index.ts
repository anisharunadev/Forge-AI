/**
 * Barrel export for the shell primitive layer.
 *
 * Components in `components/shell/` are design-system primitives shared
 * across the app. New shell primitives should be exported here so callers
 * can do `import { StatusPill, PageHeader, EmptyState, SectionCard } from '@/components/shell'`.
 */
export { StatusPill } from './StatusPill';
export type { StatusPillProps, StatusPillSize } from './StatusPill';

export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { SectionCard } from './SectionCard';
export type { SectionCardProps } from './SectionCard';
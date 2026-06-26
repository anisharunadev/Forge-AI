/**
 * Barrel export for the Step 20 Project Intelligence surface.
 *
 * Replaces the inline four-section layout in
 * `app/project-intelligence/page.tsx` with a sticky context bar +
 * hero + KPI strip + 2-column bento (left = typed artifacts,
 * right = metrics) + per-section empty/loading/error states.
 */

export { ProjectContextBar } from './ProjectContextBar';
export type {
  ProjectContextBarProps,
  ProjectOption,
  HealthState,
} from './ProjectContextBar';

export { HeroBand } from './HeroBand';
export type { HeroBandProps, HeroViewFilter } from './HeroBand';

export { KpiStrip } from './KpiStrip';
export type { KpiStripProps, KpiTile, KpiKey } from './KpiStrip';

/**
 * `defaultKpiTiles` is intentionally NOT re-exported here. It's a
 * server-safe helper from `./kpi-defaults` that returns an array
 * of plain objects (with React-element `icon` props). Importing it
 * through this barrel would mark it as a client export (because
 * `KpiStrip.tsx` is `'use client'`), and server components that
 * call it would throw "Attempted to call defaultKpiTiles() from
 * the server". Server callers should import directly:
 *
 *   import { defaultKpiTiles } from '@/components/project-intelligence/kpi-defaults';
 */

export { SectionEpics } from './SectionEpics';
export type { SectionEpicsProps } from './SectionEpics';

export { SectionBriefs } from './SectionBriefs';
export type { SectionBriefsProps } from './SectionBriefs';

export { SectionDrafts } from './SectionDrafts';
export type { SectionDraftsProps } from './SectionDrafts';

export { SectionActiveStories } from './SectionActiveStories';
export type { SectionActiveStoriesProps } from './SectionActiveStories';

export { StoriesSnapshot } from './StoriesSnapshot';
export type { StoriesSnapshotProps } from './StoriesSnapshot';

export {
  RightColumn,
  defaultVelocity,
  defaultBurndown,
  defaultTeamLoad,
  defaultActivity,
} from './RightColumn';
export type {
  RightColumnProps,
  SprintVelocityDatum,
  BurndownDatum,
  TeamLoadMember,
  ActivityEvent,
} from './RightColumn';

export { FreshProjectEmpty } from './FreshProjectEmpty';
export type { FreshProjectEmptyProps } from './FreshProjectEmpty';

/**
 * Public barrel for the Organization Knowledge components module (Step 29).
 *
 * Consumers should import from here, not the individual files, so that
 * the page surface area stays small and easy to refactor.
 *
 * ponytail: `sample-data` is intentionally NOT re-exported here. The page
 * imports only component exports. Sample-data lives next to the components
 * that use it and should be replaced by real-API hooks before any consumer
 * reaches for it.
 */

export { ScopeSwitcher, scopeLabel } from './scope-switcher';
export type { Scope } from './scope-switcher';

export { OverviewTab } from './overview-tab';

export { TemplateGrid } from './template-grid';

export { RunbookTimeline } from './runbook-timeline';

export { BestPracticesTab } from './best-practices';

export { ArtifactGraph } from './artifact-graph';

export { BacklinksPanel } from './backlinks-panel';

export { NewArtifactModal } from './new-artifact-modal';

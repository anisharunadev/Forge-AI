/**
 * Confluence family — FORA-484 AC #2.
 *
 * Six event types per Plan 3 §3:
 *   confluence.page.observed
 *   confluence.page.indexed
 *   confluence.page.published       → emits ADR or Deployment Plan (RBAC-gated)
 *   confluence.comment.added
 *   confluence.space.scanned
 *
 * Note: per Plan 3, `confluence.page.published` is the trigger for both
 * `adr` (Architect-only) and `deployment_plan` (Architect or DeployAgent).
 * The rule engine resolves both at emit time.
 */

import type { ConnectorFamily } from '../envelope.js';

export const CONFLUENCE_FAMILY: ConnectorFamily = 'confluence';

export const CONFLUENCE_EVENT_TYPES = [
  'confluence.page.observed',
  'confluence.page.indexed',
  'confluence.page.published',
  'confluence.comment.added',
  'confluence.space.scanned',
] as const;
export type ConfluenceEventType = (typeof CONFLUENCE_EVENT_TYPES)[number];

export function isConfluenceEvent(event_type: string): boolean {
  return (CONFLUENCE_EVENT_TYPES as readonly string[]).includes(event_type);
}

export const CONFLUENCE_OPS = [
  'page.get',
  'page.search',
  'page.index',
  'page.publish',
  'comment.add',
  'space.scan',
] as const;
export type ConfluenceOp = (typeof CONFLUENCE_OPS)[number];

export function confluenceEventFor(op: ConfluenceOp): ConfluenceEventType {
  switch (op) {
    case 'page.get':
      return 'confluence.page.observed';
    case 'page.search':
      return 'confluence.space.scanned';
    case 'page.index':
      return 'confluence.page.indexed';
    case 'page.publish':
      return 'confluence.page.published';
    case 'comment.add':
      return 'confluence.comment.added';
    case 'space.scan':
      return 'confluence.space.scanned';
  }
}
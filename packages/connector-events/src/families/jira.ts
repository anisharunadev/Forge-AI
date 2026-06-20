/**
 * Jira family — FORA-484 AC #2.
 *
 * Six event types per Plan 3 §3:
 *   jira.issue.observed
 *   jira.issue.ingested     → emits Requirement (RBAC-gated)
 *   jira.transition.applied
 *   jira.issue.linked
 *   jira.search.executed
 *   jira.health.checked
 *
 * The verb constants are the single source of truth; the emitter
 * helpers validate args before the call lands.
 */

import type { ConnectorFamily } from '../envelope.js';

/** The Jira connector family id (also `connector_id`). */
export const JIRA_FAMILY: ConnectorFamily = 'jira';

/** Canonical Jira verb set, in stable order. */
export const JIRA_EVENT_TYPES = [
  'jira.issue.observed',
  'jira.issue.ingested',
  'jira.transition.applied',
  'jira.issue.linked',
  'jira.search.executed',
  'jira.health.checked',
] as const;
export type JiraEventType = (typeof JIRA_EVENT_TYPES)[number];

/** Assert `event_type` is a Jira event. Throws otherwise. */
export function assertJiraEvent(event_type: string): asserts event_type is JiraEventType {
  if (!(JIRA_EVENT_TYPES as readonly string[]).includes(event_type)) {
    throw new Error(`Not a Jira event_type: ${event_type}`);
  }
}

/** True iff `event_type` is a Jira family event. */
export function isJiraEvent(event_type: string): boolean {
  return (JIRA_EVENT_TYPES as readonly string[]).includes(event_type);
}

/** The Jira connector operation vocabulary — what `request.op` may carry. */
export const JIRA_OPS = [
  'issue.list',
  'issue.search',
  'issue.get',
  'issue.create',
  'issue.update',
  'issue.add_comment',
  'issue.transition',
  'issue.link',
  'project.health',
] as const;
export type JiraOp = (typeof JIRA_OPS)[number];

/** Map a Jira op to its canonical event_type. */
export function jiraEventFor(op: JiraOp): JiraEventType {
  switch (op) {
    case 'issue.list':
    case 'issue.search':
      return 'jira.search.executed';
    case 'issue.get':
      return 'jira.issue.observed';
    case 'issue.create':
    case 'issue.update':
      return 'jira.issue.observed';
    case 'issue.add_comment':
      return 'jira.issue.observed';
    case 'issue.transition':
      return 'jira.transition.applied';
    case 'issue.link':
      return 'jira.issue.linked';
    case 'project.health':
      return 'jira.health.checked';
  }
}

/** Family-side helper for the Jira ingestion → Requirement path. */
export const JIRA_INGESTION_TO_REQUIREMENT = {
  source_event: 'jira.issue.ingested',
  artifact_type: 'requirement' as const,
} as const;
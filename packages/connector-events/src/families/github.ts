/**
 * GitHub family — FORA-484 AC #2.
 *
 * Eight event types per Plan 3 §3:
 *   github.push.received
 *   github.pr.opened              → emits Code Patch (RBAC-gated)
 *   github.pr.review.submitted
 *   github.pr.merged              → emits Code Patch + advances Task Breakdown (RBAC-gated)
 *   github.branch_protection.checked
 *   github.action.run.completed   → emits Test Report or Security Report (RBAC-gated)
 *   github.repo.scanned
 */

import type { ConnectorFamily } from '../envelope.js';

export const GITHUB_FAMILY: ConnectorFamily = 'github';

export const GITHUB_EVENT_TYPES = [
  'github.push.received',
  'github.pr.opened',
  'github.pr.review.submitted',
  'github.pr.merged',
  'github.branch_protection.checked',
  'github.action.run.completed',
  'github.repo.scanned',
] as const;
export type GithubEventType = (typeof GITHUB_EVENT_TYPES)[number];

export function isGithubEvent(event_type: string): boolean {
  return (GITHUB_EVENT_TYPES as readonly string[]).includes(event_type);
}

export const GITHUB_OPS = [
  'push.receive',
  'pr.open',
  'pr.review',
  'pr.merge',
  'branch_protection.check',
  'action_run.completed',
  'repo.scan',
] as const;
export type GithubOp = (typeof GITHUB_OPS)[number];

export function githubEventFor(op: GithubOp): GithubEventType {
  switch (op) {
    case 'push.receive':
      return 'github.push.received';
    case 'pr.open':
      return 'github.pr.opened';
    case 'pr.review':
      return 'github.pr.review.submitted';
    case 'pr.merge':
      return 'github.pr.merged';
    case 'branch_protection.check':
      return 'github.branch_protection.checked';
    case 'action_run.completed':
      return 'github.action.run.completed';
    case 'repo.scan':
      return 'github.repo.scanned';
  }
}
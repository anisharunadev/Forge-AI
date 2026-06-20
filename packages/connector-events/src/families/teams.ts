/**
 * Teams family — FORA-484 AC #2.
 *
 * Four event types per Plan 3 §3:
 *   teams.transcript.received     → emits Requirement (RBAC-gated, MVP-1 path)
 *   teams.message.received
 *   teams.card.actioned
 *   teams.call.recorded
 *
 * Note: there is no Teams MCP server in `mcp-servers/` yet (FORA-484
 * pre-skeleton). The constants here define the wire-format catalog so
 * the Teams MCP can adopt this registry when it ships.
 */

import type { ConnectorFamily } from '../envelope.js';

export const TEAMS_FAMILY: ConnectorFamily = 'teams';

export const TEAMS_EVENT_TYPES = [
  'teams.transcript.received',
  'teams.message.received',
  'teams.card.actioned',
  'teams.call.recorded',
] as const;
export type TeamsEventType = (typeof TEAMS_EVENT_TYPES)[number];

export function isTeamsEvent(event_type: string): boolean {
  return (TEAMS_EVENT_TYPES as readonly string[]).includes(event_type);
}

export const TEAMS_OPS = [
  'transcript.receive',
  'message.receive',
  'card.action',
  'call.record',
] as const;
export type TeamsOp = (typeof TEAMS_OPS)[number];

export function teamsEventFor(op: TeamsOp): TeamsEventType {
  switch (op) {
    case 'transcript.receive':
      return 'teams.transcript.received';
    case 'message.receive':
      return 'teams.message.received';
    case 'card.action':
      return 'teams.card.actioned';
    case 'call.record':
      return 'teams.call.recorded';
  }
}
/**
 * State-change → event_type mapping.
 *
 * Per FORA-50 spec §10 acceptance: "Every transition emits a typed event to the
 * bus and a row to `agent_run_events`." This module is the **only** place that
 * declares which state changes emit which event_type. The Orchestrator consults
 * this map when committing a transition; a unit test asserts that every (state
 * change, event_type) pair is mapped exactly once and every one of the 19
 * event_types is reachable from a state change.
 *
 * Adding a new state change:
 *   1. Add the entry to `STATE_CHANGE_TO_EVENT` below.
 *   2. Run `pnpm test events.test.ts` — the exhaustive-pair test will fail if
 *      you forgot a key or duplicated an event_type.
 *   3. Implement the Orchestrator side that calls `producer.publish` with the
 *      payload shape from `events.ts`.
 */

import { ALL_EVENT_TYPES, type EventType } from './events.js';

/** The Orchestrator's vocabulary of state changes. Every change emits exactly one event. */
export type StateChangeKind =
  | 'run_header_written'
  | 'first_stage_begins'
  | 'stage_begins'
  | 'stage_decision_pending'
  | 'gate_approved'
  | 'gate_rejected'
  | 'stage_sent_back'
  | 'gate_waiting'
  | 'gate_resolved'
  | 'gate_ttl_elapsed'
  | 'advance_to_next_stage'
  | 'stage_cost_reported'
  | 'cost_ceiling_hit'
  | 'unrecoverable_or_operator_abort'
  | 'operator_pause'
  | 'operator_resume'
  | 'last_stage_approved'
  | 'unrecovered_error'
  | 'gate_refused';

/**
 * The exhaustive mapping. Every StateChangeKind has exactly one event_type,
 * and every EventType appears at most once. The exhaustive-pair test asserts both.
 */
export const STATE_CHANGE_TO_EVENT: {
  readonly [K in StateChangeKind]: EventType;
} = {
  run_header_written: 'run_created',
  first_stage_begins: 'run_started',
  stage_begins: 'stage_started',
  stage_decision_pending: 'stage_completed',
  gate_approved: 'stage_approved',
  gate_rejected: 'stage_rejected',
  stage_sent_back: 'stage_returned',
  gate_waiting: 'approval_requested',
  gate_resolved: 'approval_decided',
  gate_ttl_elapsed: 'approval_expired',
  advance_to_next_stage: 'gate_passed',
  stage_cost_reported: 'cost_reported',
  cost_ceiling_hit: 'budget_exceeded',
  unrecoverable_or_operator_abort: 'run_aborted',
  operator_pause: 'run_paused',
  operator_resume: 'run_resumed',
  last_stage_approved: 'run_finished',
  unrecovered_error: 'error',
  gate_refused: 'invalid_transition',
};

/** Reverse map: given an event_type, what state change produced it. */
export const EVENT_TO_STATE_CHANGE: {
  readonly [K in EventType]: StateChangeKind;
} = Object.fromEntries(
  Object.entries(STATE_CHANGE_TO_EVENT).map(([k, v]) => [v, k]),
) as { [K in EventType]: StateChangeKind };

/** Every state change has exactly one event_type, and every event_type is reachable. */
export function assertExhaustiveCoverage(): {
  readonly unmappedStateChanges: ReadonlyArray<StateChangeKind>;
  readonly unreachedEventTypes: ReadonlyArray<EventType>;
} {
  const allKeys = Object.keys(STATE_CHANGE_TO_EVENT) as StateChangeKind[];
  const allValues = Object.values(STATE_CHANGE_TO_EVENT);
  const allEventTypes = new Set<EventType>(ALL_EVENT_TYPES);

  const unmapped: StateChangeKind[] = [];
  for (const k of allKeys) {
    if (!allEventTypes.has(STATE_CHANGE_TO_EVENT[k])) {
      unmapped.push(k);
    }
  }

  const unreached: EventType[] = [];
  for (const et of ALL_EVENT_TYPES) {
    if (!allValues.includes(et)) unreached.push(et);
  }

  return {
    unmappedStateChanges: unmapped,
    unreachedEventTypes: unreached,
  };
}

/** Resolve the event_type for a given state change. Throws if the change is unknown. */
export function eventTypeFor(stateChange: StateChangeKind): EventType {
  const et = STATE_CHANGE_TO_EVENT[stateChange];
  if (!et) throw new Error(`unknown state change: ${stateChange}`);
  return et;
}

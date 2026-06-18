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
import { type EventType } from './events.js';
/** The Orchestrator's vocabulary of state changes. Every change emits exactly one event. */
export type StateChangeKind = 'run_header_written' | 'first_stage_begins' | 'stage_begins' | 'stage_decision_pending' | 'gate_approved' | 'gate_rejected' | 'stage_sent_back' | 'gate_waiting' | 'gate_resolved' | 'gate_ttl_elapsed' | 'advance_to_next_stage' | 'stage_cost_reported' | 'cost_ceiling_hit' | 'unrecoverable_or_operator_abort' | 'operator_pause' | 'operator_resume' | 'last_stage_approved' | 'unrecovered_error' | 'gate_refused';
/**
 * The exhaustive mapping. Every StateChangeKind has exactly one event_type,
 * and every EventType appears at most once. The exhaustive-pair test asserts both.
 */
export declare const STATE_CHANGE_TO_EVENT: {
    readonly [K in StateChangeKind]: EventType;
};
/** Reverse map: given an event_type, what state change produced it. */
export declare const EVENT_TO_STATE_CHANGE: {
    readonly [K in EventType]: StateChangeKind;
};
/** Every state change has exactly one event_type, and every event_type is reachable. */
export declare function assertExhaustiveCoverage(): {
    readonly unmappedStateChanges: ReadonlyArray<StateChangeKind>;
    readonly unreachedEventTypes: ReadonlyArray<EventType>;
};
/** Resolve the event_type for a given state change. Throws if the change is unknown. */
export declare function eventTypeFor(stateChange: StateChangeKind): EventType;

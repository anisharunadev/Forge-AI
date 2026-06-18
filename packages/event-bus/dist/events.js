/**
 * The 19 typed events defined in FORA-50 spec §5.1.
 *
 * Each event has:
 *   - a snake_case `event_type` string (the discriminator),
 *   - a Zod schema for the `payload`,
 *   - a TypeScript type,
 *   - the schema version (currently "1.0.0" for all events).
 *
 * Adding a new event:
 *   1. Add the schema + type here.
 *   2. Add the entry to `EVENT_SCHEMAS` so the producer can look it up by name.
 *   3. Add the (state-change → event_type) mapping in `state-changes.ts` so the
 *      Orchestrator's writer contract is enforced by a unit test.
 *
 * Adding a field to an existing payload is a MINOR bump; consumers continue
 * to read. Removing/renaming/narrowing is a MAJOR bump; emit on a new subject
 * `fora.events.<tenant_id>.<event_type>.v2` and keep the v1 subject for 30 days.
 */
import { z } from 'zod';
import { EventEnvelopeSchema } from './envelope.js';
const CURRENT_VERSION = '1.0.0';
const CURRENT_MAJOR = 1;
// Seven-stage spine — declared first so every payload schema can reference it.
const StageSchema = z.enum([
    'ideation',
    'architect',
    'dev',
    'qa',
    'security',
    'devops',
    'docs',
]);
// ---- Payload schemas (FORA-50 spec §5.1) ---------------------------------
const TriggerSchema = z.object({
    type: z.enum(['manual', 'scheduled', 'webhook', 'event']),
    actor: z.string().min(1),
    payload_ref: z.string().nullable(),
});
export const RunCreatedPayload = z.object({
    run_id: z.string().min(1),
    tenant_id: z.string().min(1),
    goal_id: z.string().min(1),
    trigger: TriggerSchema,
});
export const RunStartedPayload = z.object({
    run_id: z.string().min(1),
    stage: z.string().min(1),
});
export const StageStartedPayload = z.object({
    run_id: z.string().min(1),
    stage: StageSchema,
    owner: z.string().min(1),
    started_at: z.string().datetime({ offset: true }),
});
export const StageCompletedPayload = z.object({
    run_id: z.string().min(1),
    stage: StageSchema,
    artefact_refs: z.array(z.object({
        kind: z.string().min(1),
        url: z.string().min(1),
        sha256: z.string().nullable(),
    })),
    duration_ms: z.number().int().nonnegative(),
});
export const StageApprovedPayload = z.object({
    run_id: z.string().min(1),
    stage: StageSchema,
    approved_by: z.string().min(1),
    artefact_refs: z.array(z.object({
        kind: z.string().min(1),
        url: z.string().min(1),
        sha256: z.string().nullable(),
    })),
});
export const StageRejectedPayload = z.object({
    run_id: z.string().min(1),
    stage: StageSchema,
    rejected_by: z.string().min(1),
    reason: z.string().min(1),
});
export const StageReturnedPayload = z.object({
    run_id: z.string().min(1),
    from_stage: StageSchema,
    to_stage: StageSchema,
    reason: z.string().min(1),
    returned_by: z.string().min(1),
    // Added in FORA-170 so consumers can correlate the return with the
    // originating approval row.
    approval_id: z.string().min(1),
});
export const ApprovalRequestedPayload = z.object({
    run_id: z.string().min(1),
    // Nullable for the launch gate, which is a run-level approval with no
    // originating stage (per FORA-50 §6.1 + ADR-0008 §3).
    stage: StageSchema.nullable(),
    required_role: z.enum(['product', 'ceo', 'cto', 'qa', 'security', 'devops', 'docs', 'board']),
    expires_at: z.string().datetime({ offset: true }),
    artefact_refs: z.array(z.object({
        kind: z.string().min(1),
        url: z.string().min(1),
        sha256: z.string().nullable(),
    })),
    // Added in FORA-170 so consumers can correlate with the approval row and
    // the Paperclip interaction (audit / cost / memory agents).
    approval_id: z.string().min(1),
    gate_kind: z.string().min(1),
    interaction_id: z.string().min(1),
});
export const ApprovalDecidedPayload = z.object({
    run_id: z.string().min(1),
    approval_id: z.string().min(1),
    decision: z.enum(['approved', 'rejected']),
    decided_by: z.string().min(1),
    // Added in FORA-170 — wall-clock stamp for "decided X minutes ago" UX.
    decided_at: z.string().datetime({ offset: true }),
});
export const ApprovalExpiredPayload = z.object({
    run_id: z.string().min(1),
    approval_id: z.string().min(1),
    expired_at: z.string().datetime({ offset: true }),
});
export const GatePassedPayload = z.object({
    run_id: z.string().min(1),
    from_stage: StageSchema,
    to_stage: StageSchema,
});
export const CostReportedPayload = z.object({
    run_id: z.string().min(1),
    stage: StageSchema,
    tokens_in: z.number().int().nonnegative(),
    tokens_out: z.number().int().nonnegative(),
    usd: z.number().nonnegative(),
});
export const BudgetExceededPayload = z.object({
    run_id: z.string().min(1),
    ceiling_usd: z.number().nonnegative(),
    spent_usd: z.number().nonnegative(),
    stage: StageSchema,
});
export const RunAbortedPayload = z.object({
    run_id: z.string().min(1),
    reason: z.string().min(1),
    last_stage: StageSchema,
});
export const RunPausedPayload = z.object({
    run_id: z.string().min(1),
    paused_by: z.string().min(1),
    reason: z.string().nullable(),
});
export const RunResumedPayload = z.object({
    run_id: z.string().min(1),
    resumed_by: z.string().min(1),
});
export const RunFinishedPayload = z.object({
    run_id: z.string().min(1),
    total_cost_usd: z.number().nonnegative(),
    total_duration_ms: z.number().int().nonnegative(),
});
export const ErrorPayload = z.object({
    run_id: z.string().min(1),
    stage: StageSchema.nullable(),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
});
export const InvalidTransitionPayload = z.object({
    run_id: z.string().min(1),
    from_stage: StageSchema,
    to_stage: StageSchema,
    requested_by: z.string().min(1),
});
/** The ordered list of all 19 event types — kept for test asserts + dashboards. */
export const ALL_EVENT_TYPES = [
    'run_created',
    'run_started',
    'stage_started',
    'stage_completed',
    'stage_approved',
    'stage_rejected',
    'stage_returned',
    'approval_requested',
    'approval_decided',
    'approval_expired',
    'gate_passed',
    'cost_reported',
    'budget_exceeded',
    'run_aborted',
    'run_paused',
    'run_resumed',
    'run_finished',
    'error',
    'invalid_transition',
];
// ---- Per-event-type schema registry --------------------------------------
/**
 * Maps every event type to its payload schema. The producer reads from this
 * map to validate before publish; consumers read from it to validate on receipt.
 *
 * To upgrade an event:
 *   - Additive (new optional field) → bump minor; consumers reading the old
 *     minor continue to parse (zod is forward-compatible with extra keys when
 *     `.passthrough()` or `.strict()` is chosen deliberately). For the v1
 *     wire-format we keep `.strict()` and forbid extras to make drift visible.
 *   - Breaking → bump major, add a new entry here, publish on `v2` subject
 *     while keeping `v1` emitting the old payload for 30 days.
 */
export const EVENT_SCHEMAS = {
    run_created: { major: CURRENT_MAJOR, payload: RunCreatedPayload },
    run_started: { major: CURRENT_MAJOR, payload: RunStartedPayload },
    stage_started: { major: CURRENT_MAJOR, payload: StageStartedPayload },
    stage_completed: { major: CURRENT_MAJOR, payload: StageCompletedPayload },
    stage_approved: { major: CURRENT_MAJOR, payload: StageApprovedPayload },
    stage_rejected: { major: CURRENT_MAJOR, payload: StageRejectedPayload },
    stage_returned: { major: CURRENT_MAJOR, payload: StageReturnedPayload },
    approval_requested: { major: CURRENT_MAJOR, payload: ApprovalRequestedPayload },
    approval_decided: { major: CURRENT_MAJOR, payload: ApprovalDecidedPayload },
    approval_expired: { major: CURRENT_MAJOR, payload: ApprovalExpiredPayload },
    gate_passed: { major: CURRENT_MAJOR, payload: GatePassedPayload },
    cost_reported: { major: CURRENT_MAJOR, payload: CostReportedPayload },
    budget_exceeded: { major: CURRENT_MAJOR, payload: BudgetExceededPayload },
    run_aborted: { major: CURRENT_MAJOR, payload: RunAbortedPayload },
    run_paused: { major: CURRENT_MAJOR, payload: RunPausedPayload },
    run_resumed: { major: CURRENT_MAJOR, payload: RunResumedPayload },
    run_finished: { major: CURRENT_MAJOR, payload: RunFinishedPayload },
    error: { major: CURRENT_MAJOR, payload: ErrorPayload },
    invalid_transition: { major: CURRENT_MAJOR, payload: InvalidTransitionPayload },
};
/** The current major schema version. */
export const CURRENT_EVENT_MAJOR = CURRENT_MAJOR;
/** The current full semver. */
export const CURRENT_EVENT_VERSION = CURRENT_VERSION;
/** Build a typed envelope from the inputs and a payload validated against the per-event schema. */
export function buildEnvelope(params) {
    const entry = EVENT_SCHEMAS[params.eventType];
    const parsed = entry.payload.parse(params.payload);
    return {
        v: CURRENT_VERSION,
        event_id: params.eventId,
        run_id: params.runId,
        tenant_id: params.tenantId,
        stage: params.stage,
        event_type: params.eventType,
        occurred_at: params.occurredAt ?? new Date().toISOString(),
        actor: params.actor,
        payload: parsed,
    };
}
/** Parse + validate a wire-format envelope. Throws SchemaValidationError on failure. */
export function parseEnvelope(raw) {
    return EventEnvelopeSchema.parse(raw);
}
//# sourceMappingURL=events.js.map
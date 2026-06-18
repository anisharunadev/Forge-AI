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
import { EventEnvelopeSchema, type Stage } from './envelope.js';
declare const CURRENT_VERSION: "1.0.0";
export declare const RunCreatedPayload: z.ZodObject<{
    run_id: z.ZodString;
    tenant_id: z.ZodString;
    goal_id: z.ZodString;
    trigger: z.ZodObject<{
        type: z.ZodEnum<["manual", "scheduled", "webhook", "event"]>;
        actor: z.ZodString;
        payload_ref: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "manual" | "scheduled" | "webhook" | "event";
        actor: string;
        payload_ref: string | null;
    }, {
        type: "manual" | "scheduled" | "webhook" | "event";
        actor: string;
        payload_ref: string | null;
    }>;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    tenant_id: string;
    goal_id: string;
    trigger: {
        type: "manual" | "scheduled" | "webhook" | "event";
        actor: string;
        payload_ref: string | null;
    };
}, {
    run_id: string;
    tenant_id: string;
    goal_id: string;
    trigger: {
        type: "manual" | "scheduled" | "webhook" | "event";
        actor: string;
        payload_ref: string | null;
    };
}>;
export declare const RunStartedPayload: z.ZodObject<{
    run_id: z.ZodString;
    stage: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    stage: string;
}, {
    run_id: string;
    stage: string;
}>;
export declare const StageStartedPayload: z.ZodObject<{
    run_id: z.ZodString;
    stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    owner: z.ZodString;
    started_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    owner: string;
    started_at: string;
}, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    owner: string;
    started_at: string;
}>;
export declare const StageCompletedPayload: z.ZodObject<{
    run_id: z.ZodString;
    stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    artefact_refs: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        url: z.ZodString;
        sha256: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        kind: string;
        url: string;
        sha256: string | null;
    }, {
        kind: string;
        url: string;
        sha256: string | null;
    }>, "many">;
    duration_ms: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    artefact_refs: {
        kind: string;
        url: string;
        sha256: string | null;
    }[];
    duration_ms: number;
}, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    artefact_refs: {
        kind: string;
        url: string;
        sha256: string | null;
    }[];
    duration_ms: number;
}>;
export declare const StageApprovedPayload: z.ZodObject<{
    run_id: z.ZodString;
    stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    approved_by: z.ZodString;
    artefact_refs: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        url: z.ZodString;
        sha256: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        kind: string;
        url: string;
        sha256: string | null;
    }, {
        kind: string;
        url: string;
        sha256: string | null;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    artefact_refs: {
        kind: string;
        url: string;
        sha256: string | null;
    }[];
    approved_by: string;
}, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    artefact_refs: {
        kind: string;
        url: string;
        sha256: string | null;
    }[];
    approved_by: string;
}>;
export declare const StageRejectedPayload: z.ZodObject<{
    run_id: z.ZodString;
    stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    rejected_by: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    rejected_by: string;
    reason: string;
}, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    rejected_by: string;
    reason: string;
}>;
export declare const StageReturnedPayload: z.ZodObject<{
    run_id: z.ZodString;
    from_stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    to_stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    reason: z.ZodString;
    returned_by: z.ZodString;
    approval_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    reason: string;
    from_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    to_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    returned_by: string;
    approval_id: string;
}, {
    run_id: string;
    reason: string;
    from_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    to_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    returned_by: string;
    approval_id: string;
}>;
export declare const ApprovalRequestedPayload: z.ZodObject<{
    run_id: z.ZodString;
    stage: z.ZodNullable<z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>>;
    required_role: z.ZodEnum<["product", "ceo", "cto", "qa", "security", "devops", "docs", "board"]>;
    expires_at: z.ZodString;
    artefact_refs: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        url: z.ZodString;
        sha256: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        kind: string;
        url: string;
        sha256: string | null;
    }, {
        kind: string;
        url: string;
        sha256: string | null;
    }>, "many">;
    approval_id: z.ZodString;
    gate_kind: z.ZodString;
    interaction_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs" | null;
    artefact_refs: {
        kind: string;
        url: string;
        sha256: string | null;
    }[];
    approval_id: string;
    required_role: "qa" | "security" | "devops" | "docs" | "product" | "ceo" | "cto" | "board";
    expires_at: string;
    gate_kind: string;
    interaction_id: string;
}, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs" | null;
    artefact_refs: {
        kind: string;
        url: string;
        sha256: string | null;
    }[];
    approval_id: string;
    required_role: "qa" | "security" | "devops" | "docs" | "product" | "ceo" | "cto" | "board";
    expires_at: string;
    gate_kind: string;
    interaction_id: string;
}>;
export declare const ApprovalDecidedPayload: z.ZodObject<{
    run_id: z.ZodString;
    approval_id: z.ZodString;
    decision: z.ZodEnum<["approved", "rejected"]>;
    decided_by: z.ZodString;
    decided_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    approval_id: string;
    decision: "approved" | "rejected";
    decided_by: string;
    decided_at: string;
}, {
    run_id: string;
    approval_id: string;
    decision: "approved" | "rejected";
    decided_by: string;
    decided_at: string;
}>;
export declare const ApprovalExpiredPayload: z.ZodObject<{
    run_id: z.ZodString;
    approval_id: z.ZodString;
    expired_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    approval_id: string;
    expired_at: string;
}, {
    run_id: string;
    approval_id: string;
    expired_at: string;
}>;
export declare const GatePassedPayload: z.ZodObject<{
    run_id: z.ZodString;
    from_stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    to_stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    from_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    to_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
}, {
    run_id: string;
    from_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    to_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
}>;
export declare const CostReportedPayload: z.ZodObject<{
    run_id: z.ZodString;
    stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    tokens_in: z.ZodNumber;
    tokens_out: z.ZodNumber;
    usd: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    tokens_in: number;
    tokens_out: number;
    usd: number;
}, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    tokens_in: number;
    tokens_out: number;
    usd: number;
}>;
export declare const BudgetExceededPayload: z.ZodObject<{
    run_id: z.ZodString;
    ceiling_usd: z.ZodNumber;
    spent_usd: z.ZodNumber;
    stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    ceiling_usd: number;
    spent_usd: number;
}, {
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    ceiling_usd: number;
    spent_usd: number;
}>;
export declare const RunAbortedPayload: z.ZodObject<{
    run_id: z.ZodString;
    reason: z.ZodString;
    last_stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    reason: string;
    last_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
}, {
    run_id: string;
    reason: string;
    last_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
}>;
export declare const RunPausedPayload: z.ZodObject<{
    run_id: z.ZodString;
    paused_by: z.ZodString;
    reason: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    reason: string | null;
    paused_by: string;
}, {
    run_id: string;
    reason: string | null;
    paused_by: string;
}>;
export declare const RunResumedPayload: z.ZodObject<{
    run_id: z.ZodString;
    resumed_by: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    resumed_by: string;
}, {
    run_id: string;
    resumed_by: string;
}>;
export declare const RunFinishedPayload: z.ZodObject<{
    run_id: z.ZodString;
    total_cost_usd: z.ZodNumber;
    total_duration_ms: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    total_cost_usd: number;
    total_duration_ms: number;
}, {
    run_id: string;
    total_cost_usd: number;
    total_duration_ms: number;
}>;
export declare const ErrorPayload: z.ZodObject<{
    run_id: z.ZodString;
    stage: z.ZodNullable<z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>>;
    code: z.ZodString;
    message: z.ZodString;
    retryable: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs" | null;
    retryable: boolean;
}, {
    code: string;
    message: string;
    run_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs" | null;
    retryable: boolean;
}>;
export declare const InvalidTransitionPayload: z.ZodObject<{
    run_id: z.ZodString;
    from_stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    to_stage: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
    requested_by: z.ZodString;
}, "strip", z.ZodTypeAny, {
    run_id: string;
    from_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    to_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    requested_by: string;
}, {
    run_id: string;
    from_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    to_stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs";
    requested_by: string;
}>;
export type EventType = 'run_created' | 'run_started' | 'stage_started' | 'stage_completed' | 'stage_approved' | 'stage_rejected' | 'stage_returned' | 'approval_requested' | 'approval_decided' | 'approval_expired' | 'gate_passed' | 'cost_reported' | 'budget_exceeded' | 'run_aborted' | 'run_paused' | 'run_resumed' | 'run_finished' | 'error' | 'invalid_transition';
/** The ordered list of all 19 event types — kept for test asserts + dashboards. */
export declare const ALL_EVENT_TYPES: ReadonlyArray<EventType>;
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
export declare const EVENT_SCHEMAS: {
    readonly [K in EventType]: {
        readonly major: number;
        readonly payload: z.ZodTypeAny;
    };
};
/** The current major schema version. */
export declare const CURRENT_EVENT_MAJOR = 1;
/** The current full semver. */
export declare const CURRENT_EVENT_VERSION: "1.0.0";
/** Type helpers per event_type. */
export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_SCHEMAS)[T]['payload']>;
/** Typed envelope for a specific event_type. */
export type TypedEvent<T extends EventType> = {
    v: typeof CURRENT_VERSION;
    event_id: string;
    run_id: string;
    tenant_id: string;
    stage: Stage | null;
    event_type: T;
    occurred_at: string;
    actor: {
        type: 'agent' | 'user' | 'system';
        id: string;
    };
    payload: EventPayload<T>;
};
/** Build a typed envelope from the inputs and a payload validated against the per-event schema. */
export declare function buildEnvelope<T extends EventType>(params: {
    eventType: T;
    runId: string;
    tenantId: string;
    stage: Stage | null;
    occurredAt?: string;
    actor: {
        type: 'agent' | 'user' | 'system';
        id: string;
    };
    eventId: string;
    payload: unknown;
}): TypedEvent<T>;
/** Parse + validate a wire-format envelope. Throws SchemaValidationError on failure. */
export declare function parseEnvelope(raw: unknown): z.infer<typeof EventEnvelopeSchema>;
export {};

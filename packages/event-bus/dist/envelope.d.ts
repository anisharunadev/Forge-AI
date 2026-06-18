/**
 * Event envelope — the wire-format wrapper around every event published to the bus.
 *
 * Per ADR-0006 §3.2 the envelope is the same shape regardless of event_type:
 *
 *   {
 *     "v": "1.0.0",
 *     "event_id": "evt-<uuid>",
 *     "run_id": "<uuid>",
 *     "tenant_id": "tnt_8XQ…",
 *     "stage": "dev" | null,
 *     "event_type": "stage_completed",
 *     "occurred_at": "2026-06-17T12:34:56.789Z",
 *     "actor": { "type": "agent", "id": "agent:developer" },
 *     "payload": { /* event-specific *\/ }
 *   }
 *
 * Consumers dedupe on `event_id`. The bus guarantees at-least-once delivery;
 * the dedupe contract is the consumer's responsibility.
 */
import { z } from 'zod';
/** Semver-shaped schema version. The major component is the wire-format contract. */
export declare const SchemaVersionSchema: z.ZodString;
/** The seven stage names. Mirrors FORA-50 spec §2.3 + §3.1. */
export declare const StageSchema: z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>;
/** "done" is a terminal run status, not a stage; the envelope carries it as null when N/A. */
export declare const ActorSchema: z.ZodObject<{
    type: z.ZodEnum<["agent", "user", "system"]>;
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "agent" | "user" | "system";
    id: string;
}, {
    type: "agent" | "user" | "system";
    id: string;
}>;
/** Generic envelope — payload is typed at the per-event schema layer (see events/). */
export declare const EventEnvelopeSchema: z.ZodObject<{
    v: z.ZodString;
    event_id: z.ZodString;
    run_id: z.ZodString;
    tenant_id: z.ZodString;
    stage: z.ZodNullable<z.ZodEnum<["ideation", "architect", "dev", "qa", "security", "devops", "docs"]>>;
    event_type: z.ZodString;
    occurred_at: z.ZodString;
    actor: z.ZodObject<{
        type: z.ZodEnum<["agent", "user", "system"]>;
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "agent" | "user" | "system";
        id: string;
    }, {
        type: "agent" | "user" | "system";
        id: string;
    }>;
    payload: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    v: string;
    event_id: string;
    run_id: string;
    tenant_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs" | null;
    event_type: string;
    occurred_at: string;
    actor: {
        type: "agent" | "user" | "system";
        id: string;
    };
    payload?: unknown;
}, {
    v: string;
    event_id: string;
    run_id: string;
    tenant_id: string;
    stage: "ideation" | "architect" | "dev" | "qa" | "security" | "devops" | "docs" | null;
    event_type: string;
    occurred_at: string;
    actor: {
        type: "agent" | "user" | "system";
        id: string;
    };
    payload?: unknown;
}>;
export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type EventEnvelope<TPayload = unknown> = {
    v: SchemaVersion;
    event_id: string;
    run_id: string;
    tenant_id: string;
    stage: Stage | null;
    event_type: string;
    occurred_at: string;
    actor: Actor;
    payload: TPayload;
};
/** Parsed major/minor/patch from a SemVer string. */
export interface ParsedSemver {
    major: number;
    minor: number;
    patch: number;
}
/** Parse a semver into parts. Throws on malformed input. */
export declare function parseSemver(v: string): ParsedSemver;
/** True iff the consumer's `maxMajor` is >= the producer event's major. */
export declare function isVersionSupported(eventVersion: string, consumerMaxMajor: number): boolean;

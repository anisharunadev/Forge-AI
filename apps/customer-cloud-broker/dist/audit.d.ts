/**
 * Audit event factory + sink contract for the customer-cloud-broker
 * (FORA-126 / 0.7.4).
 *
 * Two event kinds share a single sink:
 *
 *   1. `cloud.brokered` — every brokered action emits exactly one
 *      such event with `(actor, tenant_id, cloud, account, action,
 *      response_code, duration_ms, role_fingerprint)`.
 *
 *   2. `cloud.probe.{ok,fail}` — every trust-probe outcome emits
 *      exactly one such event with `(actor=system:probe, tenant_id,
 *      cloud, result, reason?, probe_jti, duration_ms)`. Probe events
 *      are FORA-126.4.
 *
 * Both event kinds carry *no* credential material by construction —
 * the factory rejects fields whose name contains "key", "secret",
 * "session", "token", or "credential".
 *
 * This module is intentionally minimal: it shares the audit-event
 * vocabulary with `apps/identity-broker/src/audit.ts` and emits to a
 * sink that conforms to the same `AuditSink` interface. A future
 * consolidation ADR will merge the two event envelopes; for v1, the
 * broker is a separate service with its own audit producer so the
 * failure modes (broker down) are isolated from the auth broker.
 */
import type { BrokeredResult, Cloud } from './types.js';
/**
 * Redact a value to its short fingerprint. Used when a downstream
 * service accidentally surfaces a credential-shaped field: the broker
 * hashes the value (so we can correlate across events) but never
 * returns the raw string.
 */
export declare function fingerprint(value: string): string;
/** Recursively assert no credential-shaped field is in the payload. */
export declare function assertNoCredentials(value: unknown, path?: string[]): void;
/**
 * Recursively strip credential-shaped fields from a value, returning a
 * new value with those fields *omitted entirely*. The keys are
 * removed (not just the values replaced) so the result is itself
 * free of credential-shaped keys, and the audit factory's
 * `assertNoCredentials` re-check passes on the redacted object.
 *
 * Used by the AWS adapter to sanitise the SDK response before it
 * crosses the broker boundary. The SDK does not normally surface the
 * assumed credential, but some service responses (notably STS) echo
 * the caller's identity in a credential-adjacent shape; the audit
 * factory's `assertNoCredentials` then catches any field we missed.
 */
export declare function redactCredentials(value: unknown): unknown;
export interface CloudBrokeredAuditEvent {
    /** Always `cloud.brokered` for events from this broker. */
    action: 'cloud.brokered';
    /** The agent that requested the action. */
    actor: string;
    tenant_id: string;
    /** One of `aws | azure | gcp`. */
    cloud: Cloud;
    /** Customer account/subscription/project id. */
    account: string;
    /** Cloud-native operation (e.g. `s3:GetObject`). */
    cloud_action: string;
    /** Broker's verdict. */
    response_code: BrokeredResult['response_code'];
    /** Wall-clock duration of the brokered action. */
    duration_ms: number;
    /** Fingerprint of the assumed role / service account — NOT the credential. */
    role_fingerprint: string;
    /** Linked run trace. */
    trace_id: string;
    /** ISO-8601 timestamp. */
    timestamp: string;
    /** Optional extra structured detail. Must be credential-free. */
    metadata?: Record<string, unknown>;
}
export declare function cloudBrokeredEvent(input: {
    result: BrokeredResult;
    actor: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
}): CloudBrokeredAuditEvent;
export type CloudProbeAuditEvent = {
    action: 'cloud.probe.ok';
    actor: 'system:probe';
    tenant_id: string;
    cloud: Cloud;
    result: 'ok';
    reason: null;
    probe_jti: string | null;
    duration_ms: number;
    timestamp: string;
} | {
    action: 'cloud.probe.fail';
    actor: 'system:probe';
    tenant_id: string;
    cloud: Cloud;
    result: 'fail';
    reason: string;
    probe_jti: string | null;
    duration_ms: number;
    timestamp: string;
};
export declare function cloudProbeEvent(input: {
    tenant_id: string;
    cloud: Cloud;
    result: 'ok' | 'fail';
    reason: string | null;
    probe_jti: string | null;
    duration_ms: number;
    timestamp?: string;
}): CloudProbeAuditEvent;
/** Union of all audit events emitted by the customer-cloud-broker. */
export type CloudAuditEvent = CloudBrokeredAuditEvent | CloudProbeAuditEvent;
export interface AuditSink {
    write(event: CloudAuditEvent): Promise<void>;
}
export declare class InMemoryAuditSink implements AuditSink {
    /** Brokered events, in write order. The existing test assertions
     *  read this field directly; probe events go to `probe_events`. */
    readonly events: CloudBrokeredAuditEvent[];
    /** Probe events, in write order. FORA-126.4. */
    readonly probe_events: CloudProbeAuditEvent[];
    write(event: CloudAuditEvent): Promise<void>;
}
export declare class JsonlAuditSink implements AuditSink {
    private readonly path;
    private readonly handle;
    constructor(path: string, opts?: {
        write?: (line: string) => Promise<void>;
    });
    write(event: CloudAuditEvent): Promise<void>;
}

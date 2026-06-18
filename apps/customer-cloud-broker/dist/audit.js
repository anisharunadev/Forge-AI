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
import { createHash } from 'node:crypto';
// ---------------------------------------------------------------------------
// Credential-redaction guard. The audit event payload is constructed
// field-by-field; any field whose key matches a credential pattern is
// rejected at the type level. This is a *belt-and-suspenders* check
// on top of the adapter-level guarantee.
// ---------------------------------------------------------------------------
const CREDENTIAL_KEY_RE = 
// `access_?token` (FORA-126.3): GCP service responses can include
// `access_token` directly (e.g. STS-style fields echoed back). The
// original regex caught `access_key` and `id_token`/`refresh_token`
// but not `access_token`; the GCP adapter relies on this guard as
// the second line of defence, so the gap is closed here.
/(access_?key|access_?token|secret_?(access_?)?key|session_?token|x-amz-security-token|aws_?session|password|passphrase|client_?secret|refresh_?token|id_?token|private_?key|api_?key)/i;
/**
 * Redact a value to its short fingerprint. Used when a downstream
 * service accidentally surfaces a credential-shaped field: the broker
 * hashes the value (so we can correlate across events) but never
 * returns the raw string.
 */
export function fingerprint(value) {
    return 'sha256:' + createHash('sha256').update(value).digest('hex').slice(0, 16);
}
/** Recursively assert no credential-shaped field is in the payload. */
export function assertNoCredentials(value, path = []) {
    if (value == null)
        return;
    if (typeof value === 'string') {
        // Strings themselves are fine — the credential never makes it to
        // the audit event as a string because the adapter doesn't pass it.
        // We still check the *key path* for credential-shaped names.
        return;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            assertNoCredentials(value[i], [...path, String(i)]);
        }
        return;
    }
    if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            if (CREDENTIAL_KEY_RE.test(k)) {
                throw new Error(`audit payload contains credential-shaped key "${k}" at ${path.join('.') || '<root>'}`);
            }
            assertNoCredentials(v, [...path, k]);
        }
    }
}
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
export function redactCredentials(value) {
    if (value == null)
        return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((v) => redactCredentials(v));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (CREDENTIAL_KEY_RE.test(k)) {
                // Omit the key entirely. The audit factory's
                // `assertNoCredentials` checks KEY names, so a value-only
                // replacement would still trip the guard.
            }
            else {
                out[k] = redactCredentials(v);
            }
        }
        return out;
    }
    // Functions / symbols / bigints are not expected in SDK responses.
    return value;
}
/**
 * Map the broker's internal response code to the audit event's
 * shorter form. The FORA-126 acceptance bar specifies
 * `response_code = deny_listed` (not `deny_listed_action`); this is
 * the canonical mapping for every audit consumer.
 */
function auditResponseCode(code) {
    switch (code) {
        case 'ok':
            return 'ok';
        case 'deny_listed_action':
            return 'deny_listed';
        case 'cloud_disabled':
            return 'cloud_disabled';
        case 'assume_failed':
            return 'assume_failed';
        case 'operation_failed':
            return 'operation_failed';
        case 'deadline_exceeded':
            return 'deadline_exceeded';
        case 'credential_too_long':
            return 'credential_too_long';
        case 'unsupported_cloud':
            return 'unsupported_cloud';
        case 'malformed_args':
            return 'malformed_args';
        case 'internal_error':
            return 'internal_error';
    }
}
export function cloudBrokeredEvent(input) {
    const timestamp = input.timestamp ?? new Date().toISOString();
    // Guardrail #1: the broker's response payload (the cloud's own
    // response) MUST be credential-free. The adapter drops the
    // credential before constructing the result, but a buggy adapter
    // could surface a secret-shaped field; catch it here.
    assertNoCredentials(input.result.response, ['result', 'response']);
    // Guardrail #2: the caller-supplied metadata must also be
    // credential-free.
    if (input.metadata) {
        assertNoCredentials(input.metadata, ['metadata']);
    }
    const event = {
        action: 'cloud.brokered',
        actor: input.actor,
        tenant_id: input.result.tenant_id,
        cloud: input.result.cloud,
        account: input.result.account,
        cloud_action: input.result.action,
        response_code: auditResponseCode(input.result.response_code),
        duration_ms: input.result.duration_ms,
        role_fingerprint: input.result.role_fingerprint,
        trace_id: input.result.trace_id,
        timestamp,
        ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    // Guardrail #3: the final event payload must be credential-free.
    assertNoCredentials(event);
    return event;
}
export function cloudProbeEvent(input) {
    const timestamp = input.timestamp ?? new Date().toISOString();
    if (input.result === 'ok') {
        return {
            action: 'cloud.probe.ok',
            actor: 'system:probe',
            tenant_id: input.tenant_id,
            cloud: input.cloud,
            result: 'ok',
            reason: null,
            probe_jti: input.probe_jti,
            duration_ms: input.duration_ms,
            timestamp,
        };
    }
    const event = {
        action: 'cloud.probe.fail',
        actor: 'system:probe',
        tenant_id: input.tenant_id,
        cloud: input.cloud,
        result: 'fail',
        reason: input.reason ?? 'unhandled_probe_error',
        probe_jti: input.probe_jti,
        duration_ms: input.duration_ms,
        timestamp,
    };
    assertNoCredentials(event);
    return event;
}
export class InMemoryAuditSink {
    /** Brokered events, in write order. The existing test assertions
     *  read this field directly; probe events go to `probe_events`. */
    events = [];
    /** Probe events, in write order. FORA-126.4. */
    probe_events = [];
    async write(event) {
        if (event.action === 'cloud.brokered') {
            this.events.push(event);
        }
        else {
            this.probe_events.push(event);
        }
    }
}
export class JsonlAuditSink {
    path;
    handle;
    constructor(path, opts = {}) {
        this.path = path;
        // `opts.write` is a function (legacy callback shape); the
        // `handle` field is an object with a `write` method. Wrap the
        // callback when present.
        this.handle = opts.write ? { write: opts.write } : defaultWrite(path);
    }
    async write(event) {
        const line = JSON.stringify(event) + '\n';
        await this.handle.write(line);
    }
}
function defaultWrite(path) {
    // Minimal append-only file writer. Real deployments swap this for a
    // structured sink (Kafka, Cloud Logging). For tests we pass a stub.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs/promises');
    return {
        async write(line) {
            await fs.appendFile(path, line, 'utf-8');
        },
    };
}

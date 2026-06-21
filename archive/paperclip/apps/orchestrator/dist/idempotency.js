/**
 * Idempotency layer (FORA-50 §4.1 + architecture.md §7).
 *
 * Every mutating endpoint accepts an `Idempotency-Key` header (UUID v4,
 * per FORA-50 rev 2 editorial). The key is stored on a dedicated table
 * (`agent_run_idempotency_keys`) together with a fingerprint of the
 * canonical request body, the response status, and the response body.
 *
 * Three outcomes for a request with a key:
 *
 *   1. First call with this (tenant, key). We execute the handler,
 *      store the response, return it. The unique constraint on
 *      (tenant_id, key) makes the store itself the dedupe index.
 *   2. Replay with the SAME key AND the SAME fingerprint. We return
 *      the stored response without re-running the handler.
 *   3. Replay with the SAME key AND a DIFFERENT fingerprint. We return
 *      `IDEMPOTENCY_CONFLICT` (HTTP 409) — this is the failure mode
 *      architecture.md §7 calls out: a client reused a key by mistake.
 *
 * The fingerprint is SHA-256 over the canonical JSON of the request
 * body (sorted keys, no whitespace). The hashing is done in JS so
 * the layer is portable to any DB.
 */
import { createHash } from 'node:crypto';
import { findIdempotencyRecord, insertIdempotencyRecord } from './repo.js';
import { asIdempotencyKey } from './types.js';
/**
 * UUID v4 format check. Per FORA-50 rev 2: `Idempotency-Key` is a UUID
 * v4 (36 chars, lowercase, hyphenated). The header is rejected up
 * front with `VALIDATION` if the format does not match.
 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isUuidV4(s) {
    return UUID_V4_RE.test(s);
}
/**
 * Canonical fingerprint over a JSON-serializable body. Keys are sorted
 * recursively so `{"a":1,"b":2}` and `{"b":2,"a":1}` hash to the
 * same value. This matches the wire-format the server stores and what
 * a client sees on replay.
 */
export function fingerprint(body) {
    return createHash('sha256').update(canonicalJson(body)).digest('hex');
}
function canonicalJson(v) {
    if (v === null || typeof v !== 'object') {
        return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
        return '[' + v.map(canonicalJson).join(',') + ']';
    }
    const entries = Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return ('{' +
        entries
            .map(([k, val]) => JSON.stringify(k) + ':' + canonicalJson(val))
            .join(',') +
        '}');
}
export async function lookupIdempotency(pool, tenantId, key, body) {
    const fp = fingerprint(body);
    const record = await findIdempotencyRecord(pool, tenantId, key);
    if (!record) {
        return { kind: 'miss' };
    }
    if (record.request_fingerprint !== fp) {
        return { kind: 'conflict', record };
    }
    return { kind: 'replay', record };
}
/**
 * Persist a freshly-completed response so a subsequent replay can be
 * served without re-executing the handler. Called inside the same
 * transaction as the state-changing write when possible; the
 * `agent_run_idempotency_keys` table has no FK to agent_runs so the
 * store can also outlive a soft-deleted run for retention purposes.
 */
export async function recordIdempotency(client, args) {
    await insertIdempotencyRecord(client, {
        key: args.key,
        tenant_id: args.tenantId,
        run_id: args.runId,
        request_fingerprint: args.fingerprintHex,
        response_status: args.responseStatus,
        response_body: args.responseBody,
        created_at: new Date().toISOString(),
    });
}
/**
 * Parse + validate the `Idempotency-Key` header value. Returns the
 * branded key on success, throws a `ValidationError` on failure.
 * The handler maps the throw to a 400 with code `VALIDATION`.
 */
export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
export function parseIdempotencyKey(header) {
    if (!header) {
        throw new ValidationError('Idempotency-Key header is required');
    }
    const trimmed = header.trim();
    if (!isUuidV4(trimmed)) {
        throw new ValidationError('Idempotency-Key must be a UUID v4 (36 chars, lowercase)');
    }
    return asIdempotencyKey(trimmed);
}
//# sourceMappingURL=idempotency.js.map
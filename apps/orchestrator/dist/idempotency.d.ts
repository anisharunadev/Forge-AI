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
import type { Pool, PoolClient } from 'pg';
import type { IdempotencyKey, IdempotencyRecord, RunId, TenantId } from './types.js';
export declare function isUuidV4(s: string): boolean;
/**
 * Canonical fingerprint over a JSON-serializable body. Keys are sorted
 * recursively so `{"a":1,"b":2}` and `{"b":2,"a":1}` hash to the
 * same value. This matches the wire-format the server stores and what
 * a client sees on replay.
 */
export declare function fingerprint(body: unknown): string;
/**
 * Lookup the prior response for a key, if any. Returns:
 *   - `null` if the key has never been used (handler runs normally).
 *   - `{ hit: true, response }` if the key + fingerprint match (replay).
 *   - `{ hit: false, reason: 'conflict' }` if the key exists but the
 *     fingerprint differs — the client reused the key by mistake.
 */
export type IdempotencyLookup = {
    kind: 'miss';
} | {
    kind: 'replay';
    record: IdempotencyRecord;
} | {
    kind: 'conflict';
    record: IdempotencyRecord;
};
export declare function lookupIdempotency(pool: Pool, tenantId: TenantId, key: string, body: unknown): Promise<IdempotencyLookup>;
/**
 * Persist a freshly-completed response so a subsequent replay can be
 * served without re-executing the handler. Called inside the same
 * transaction as the state-changing write when possible; the
 * `agent_run_idempotency_keys` table has no FK to agent_runs so the
 * store can also outlive a soft-deleted run for retention purposes.
 */
export declare function recordIdempotency(client: PoolClient, args: {
    key: IdempotencyKey;
    tenantId: TenantId;
    runId: RunId | null;
    fingerprintHex: string;
    responseStatus: number;
    responseBody: unknown;
}): Promise<void>;
/**
 * Parse + validate the `Idempotency-Key` header value. Returns the
 * branded key on success, throws a `ValidationError` on failure.
 * The handler maps the throw to a 400 with code `VALIDATION`.
 */
export declare class ValidationError extends Error {
    constructor(message: string);
}
export declare function parseIdempotencyKey(header: string | undefined): IdempotencyKey;

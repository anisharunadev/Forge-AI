/**
 * Repository — the single path from the HTTP handlers to Postgres.
 *
 * Every read in this file filters `deleted_at IS NULL` per ADR-0009
 * §6 (the API never returns a soft-deleted row). The 404 returned for
 * a soft-deleted run is deliberate — the audit account still owns the
 * row for retention, but the platform's API treats it as not-found.
 *
 * The seven stage rows are inserted in a single transaction with the
 * run header in `createRun` so a partial insert can never leave the
 * tree inconsistent. The idempotent replay uses INSERT ... ON CONFLICT
 * DO NOTHING against the (run_id, stage) unique from migration 0002.
 */
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { CreateRunRequest, IdempotencyRecord, RunId, RunRecord, RunStatus, StageRecord, TenantId, TriggerPayload } from './types.js';
/**
 * zod schema for the `triggered_by` jsonb column on `agent_runs`. The
 * schema mirrors `createRunBody.triggered_by` in server.ts:99-103 — the
 * create path parses incoming requests with this shape, so the row we
 * read back must satisfy the same contract. Living here (not in
 * server.ts) means a future caller that writes `triggered_by` directly
 * through the repo can re-use the schema without importing the HTTP
 * layer.
 */
export declare const triggerPayloadSchema: z.ZodObject<{
    type: z.ZodEnum<["manual", "slack", "email", "schedule", "api"]>;
    actor: z.ZodString;
    payload_ref: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "manual" | "slack" | "email" | "schedule" | "api";
    actor: string;
    payload_ref?: string | undefined;
}, {
    type: "manual" | "slack" | "email" | "schedule" | "api";
    actor: string;
    payload_ref?: string | undefined;
}>;
/**
 * Typed error thrown when a row's `triggered_by` jsonb value does not
 * match the schema above. The HTTP layer maps this to a 500 with an
 * `INTERNAL` envelope — a malformed jsonb payload is a data-integrity
 * violation, not a client input error, so the API contract is the
 * same as any other unrecoverable DB shape mismatch.
 */
export declare class TriggerPayloadParseError extends Error {
    constructor(message: string);
}
/**
 * Parse the raw `triggered_by` jsonb value into the typed
 * `TriggerPayload` shape. The DB stores jsonb; pg returns it as
 * `Record<string, unknown>`. The create path validates the shape via
 * `createRunBody.triggered_by` in server.ts, so in practice this
 * parser only rejects rows that predate the schema (legacy data) or
 * rows whose jsonb was hand-edited. Throws `TriggerPayloadParseError`
 * on mismatch — a typed error the HTTP layer can surface and the
 * operator can alert on.
 */
export declare function parseTriggerPayload(value: unknown): TriggerPayload;
/**
 * Insert the run header and the seven stage rows in one transaction.
 * Returns the persisted run on success. On retry with the same
 * Idempotency-Key the caller should NOT reach this function — the
 * idempotency layer replays the cached response.
 *
 * If `client` is supplied, the caller owns the transaction and is
 * responsible for BEGIN/COMMIT/ROLLBACK; both the run write and the
 * seven stage inserts run on that connection so the idempotency
 * record (written by the caller on the same client) commits or rolls
 * back atomically with them. Without `client`, this function opens
 * its own transaction; used by tests and any future caller that does
 * not need to share the transaction.
 */
export declare function createRun(pool: Pool, tenantId: TenantId, body: CreateRunRequest, defaultCostCeiling: string, client?: PoolClient): Promise<RunRecord>;
/**
 * Read a run by id within the caller's tenant. Returns `null` if the
 * run does not exist, has been soft-deleted, or belongs to a different
 * tenant. The third case is intentional — the API returns 404, not 403,
 * so we don't leak the existence of cross-tenant rows.
 */
export declare function findRunById(pool: Pool, tenantId: TenantId, runId: RunId): Promise<RunRecord | null>;
/**
 * List the seven stages for a run, in canonical order. Returns `null`
 * when the run does not exist or is soft-deleted (same semantics as
 * findRunById — the API returns 404).
 */
export declare function listStages(pool: Pool, tenantId: TenantId, runId: RunId): Promise<ReadonlyArray<StageRecord> | null>;
/**
 * Atomically update a run's status, scoped by tenant + soft-delete
 * filter. Returns the post-update row, or `null` if the run does not
 * exist / was soft-deleted / belongs to another tenant.
 *
 * The UPDATE ... WHERE tenant_id = ... AND deleted_at IS NULL is the
 * soft-delete invariant: a deleted run is invisible to all writes. The
 * optimistic-concurrency guard `AND status = $expected` makes the
 * transition reject a stale read; the handler returns 409 INVALID_STATE
 * to the client so the operator can re-fetch and retry.
 *
 * If `client` is supplied, the UPDATE runs on that connection so the
 * caller can commit the state change and the idempotency record in a
 * single transaction. Without `client`, this uses the pool directly.
 */
export declare function transitionRunStatus(pool: Pool, tenantId: TenantId, runId: RunId, expected: RunStatus, next: RunStatus, client?: PoolClient): Promise<RunRecord | null>;
/**
 * Crash-recovery read: all non-terminal runs for a tenant. The boot
 * rehydration loop (rehydrate.ts) consumes this and asks the stage
 * engine to resume each run from its last persisted stage.
 *
 * Soft-delete filter is mandatory — the rehydration loop must never
 * pick up a soft-deleted run, even if it was paused mid-flight.
 */
export declare function listActiveRunsForRecovery(pool: Pool, tenantId: TenantId): Promise<ReadonlyArray<RunRecord>>;
/**
 * Read all runs within the caller's tenant, ordered by creation (newest first).
 * FORA-378 adds this so the forge UI can determine if a tenant genuinely has
 * zero runs vs. just lacking the seeded demo run.
 */
export declare function listRuns(pool: Pool, tenantId: TenantId): Promise<ReadonlyArray<RunRecord>>;
/**
 * Fetch an idempotency record by (tenant, key). Returns `null` on miss.
 * Used by the replay path — the second call with the same key returns
 * the cached response.
 */
export declare function findIdempotencyRecord(client: PoolClient | Pool, tenantId: TenantId, key: string): Promise<IdempotencyRecord | null>;
/**
 * Persist an idempotency record. The unique (tenant_id, key) makes
 * the write itself the "have we seen this key?" check — a duplicate
 * key surfaces as a unique-violation that the caller maps to a
 * replay-or-conflict decision.
 */
export declare function insertIdempotencyRecord(client: PoolClient, record: IdempotencyRecord): Promise<void>;

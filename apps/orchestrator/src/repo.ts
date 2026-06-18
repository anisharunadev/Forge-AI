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

import type {
  CreateRunRequest,
  GoalId,
  IdempotencyRecord,
  ProjectId,
  RunId,
  RunRecord,
  RunStatus,
  Stage,
  StageRecord,
  TenantId,
  TriggerPayload,
} from './types.js';
import {
  STAGES_IN_ORDER,
  asGoalId,
  asProjectId,
  asRunId,
  asTenantId,
} from './types.js';

/**
 * zod schema for the `triggered_by` jsonb column on `agent_runs`. The
 * schema mirrors `createRunBody.triggered_by` in server.ts:99-103 — the
 * create path parses incoming requests with this shape, so the row we
 * read back must satisfy the same contract. Living here (not in
 * server.ts) means a future caller that writes `triggered_by` directly
 * through the repo can re-use the schema without importing the HTTP
 * layer.
 */
export const triggerPayloadSchema = z.object({
  type: z.enum(['manual', 'slack', 'email', 'schedule', 'api']),
  actor: z.string().min(1),
  payload_ref: z.string().optional(),
});

/**
 * Typed error thrown when a row's `triggered_by` jsonb value does not
 * match the schema above. The HTTP layer maps this to a 500 with an
 * `INTERNAL` envelope — a malformed jsonb payload is a data-integrity
 * violation, not a client input error, so the API contract is the
 * same as any other unrecoverable DB shape mismatch.
 */
export class TriggerPayloadParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TriggerPayloadParseError';
  }
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
export function parseTriggerPayload(value: unknown): TriggerPayload {
  const parsed = triggerPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new TriggerPayloadParseError(
      `agent_runs.triggered_by failed schema: ${parsed.error.message}`,
    );
  }
  return {
    type: parsed.data.type,
    actor: parsed.data.actor,
    ...(parsed.data.payload_ref !== undefined
      ? { payload_ref: parsed.data.payload_ref }
      : {}),
  };
}

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
export async function createRun(
  pool: Pool,
  tenantId: TenantId,
  body: CreateRunRequest,
  defaultCostCeiling: string,
  client?: PoolClient,
): Promise<RunRecord> {
  const ownClient = client ?? (await pool.connect());
  const releaseOnDone = client === undefined;
  try {
    if (client === undefined) {
      await ownClient.query('BEGIN');
    }
    const insertRun = await ownClient.query<{
      id: string;
      tenant_id: string;
      goal_id: string;
      project_id: string;
      status: RunStatus;
      current_stage: string;
      triggered_by: Record<string, unknown>;
      cost_ceiling_usd: string;
      cost_spent_usd: string;
      started_at: string | null;
      finished_at: string | null;
      deleted_at: string | null;
      archived_at: string | null;
    }>(
      `INSERT INTO agent_runs
         (tenant_id, goal_id, project_id, status, current_stage,
          triggered_by, cost_ceiling_usd, cost_spent_usd)
       VALUES ($1, $2, $3, 'created', 'ideation', $4::jsonb,
               COALESCE($5::numeric, cost_ceiling_usd), 0)
       RETURNING id, tenant_id, goal_id, project_id, status, current_stage,
                 triggered_by, cost_ceiling_usd::text AS cost_ceiling_usd,
                 cost_spent_usd::text AS cost_spent_usd,
                 started_at, finished_at, deleted_at, archived_at`,
      [
        tenantId,
        body.goal_id,
        body.project_id,
        JSON.stringify(body.triggered_by),
        body.cost_ceiling_usd ?? null,
      ],
    );
    const row = insertRun.rows[0];
    if (!row) {
      // Should never happen — INSERT ... RETURNING always returns the row.
      throw new Error('createRun: INSERT returned no rows');
    }
    const runId = row.id;

    // The seven canonical stages on creation. ON CONFLICT DO NOTHING
    // makes the insert idempotent against the (run_id, stage) unique
    // from migration 0002 — a replay of the same INSERT (e.g. from a
    // partial-failure recovery) does not error.
    for (const stage of STAGES_IN_ORDER) {
      await ownClient.query(
        `INSERT INTO agent_run_stages (run_id, stage, status)
           VALUES ($1, $2, 'pending')
           ON CONFLICT (run_id, stage) DO NOTHING`,
        [runId, stage],
      );
    }

    if (client === undefined) {
      await ownClient.query('COMMIT');
    }

    return rowToRun(row);
  } catch (e) {
    if (client === undefined) {
      try {
        await ownClient.query('ROLLBACK');
      } catch {
        // Best-effort rollback; the original error is the actionable one.
      }
    }
    throw e;
  } finally {
    if (releaseOnDone) {
      ownClient.release();
    }
  }
}

/**
 * Read a run by id within the caller's tenant. Returns `null` if the
 * run does not exist, has been soft-deleted, or belongs to a different
 * tenant. The third case is intentional — the API returns 404, not 403,
 * so we don't leak the existence of cross-tenant rows.
 */
export async function findRunById(
  pool: Pool,
  tenantId: TenantId,
  runId: RunId,
): Promise<RunRecord | null> {
  const r = await pool.query<{
    id: string;
    tenant_id: string;
    goal_id: string;
    project_id: string;
    status: RunStatus;
    current_stage: string;
    triggered_by: Record<string, unknown>;
    cost_ceiling_usd: string;
    cost_spent_usd: string;
    started_at: string | null;
    finished_at: string | null;
    deleted_at: string | null;
    archived_at: string | null;
  }>(
    `SELECT id, tenant_id, goal_id, project_id, status, current_stage,
            triggered_by, cost_ceiling_usd::text AS cost_ceiling_usd,
            cost_spent_usd::text AS cost_spent_usd,
            started_at, finished_at, deleted_at, archived_at
       FROM agent_runs
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL`,
    [runId, tenantId],
  );
  const row = r.rows[0];
  return row ? rowToRun(row) : null;
}

/**
 * List the seven stages for a run, in canonical order. Returns `null`
 * when the run does not exist or is soft-deleted (same semantics as
 * findRunById — the API returns 404).
 */
export async function listStages(
  pool: Pool,
  tenantId: TenantId,
  runId: RunId,
): Promise<ReadonlyArray<StageRecord> | null> {
  // The tenant gate is enforced by joining to agent_runs. A soft-deleted
  // run returns zero stage rows, which we map to `null` here.
  const r = await pool.query<{
    id: string;
    run_id: string;
    stage: Stage;
    status: string;
    decision: Record<string, unknown> | null;
    started_at: string | null;
    finished_at: string | null;
  }>(
    `SELECT s.id, s.run_id, s.stage, s.status, s.decision,
            s.started_at, s.finished_at
       FROM agent_run_stages s
       JOIN agent_runs r ON r.id = s.run_id
      WHERE s.run_id = $1
        AND r.tenant_id = $2
        AND r.deleted_at IS NULL
      ORDER BY array_position($3::text[], s.stage::text)`,
    [runId, tenantId, STAGES_IN_ORDER as unknown as string[]],
  );
  if (r.rows.length === 0) {
    return null;
  }
  return r.rows.map((row) => ({
    id: row.id,
    run_id: asRunId(row.run_id),
    stage: row.stage,
    status: row.status as StageRecord['status'],
    decision: (row.decision as StageRecord['decision']) ?? null,
    started_at: row.started_at,
    finished_at: row.finished_at,
  }));
}

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
export async function transitionRunStatus(
  pool: Pool,
  tenantId: TenantId,
  runId: RunId,
  expected: RunStatus,
  next: RunStatus,
  client?: PoolClient,
): Promise<RunRecord | null> {
  const executor = client ?? pool;
  const r = await executor.query<{
    id: string;
    tenant_id: string;
    goal_id: string;
    project_id: string;
    status: RunStatus;
    current_stage: string;
    triggered_by: Record<string, unknown>;
    cost_ceiling_usd: string;
    cost_spent_usd: string;
    started_at: string | null;
    finished_at: string | null;
    deleted_at: string | null;
    archived_at: string | null;
  }>(
    `UPDATE agent_runs
        SET status = $4,
            finished_at = CASE WHEN $4 IN ('done', 'aborted')
                              THEN COALESCE(finished_at, now())
                              ELSE finished_at END,
            started_at = CASE WHEN started_at IS NULL AND $4 = 'running'
                              THEN now() ELSE started_at END
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
        AND status = $3
      RETURNING id, tenant_id, goal_id, project_id, status, current_stage,
                triggered_by, cost_ceiling_usd::text AS cost_ceiling_usd,
                cost_spent_usd::text AS cost_spent_usd,
                started_at, finished_at, deleted_at, archived_at`,
    [runId, tenantId, expected, next],
  );
  const row = r.rows[0];
  return row ? rowToRun(row) : null;
}

/**
 * Crash-recovery read: all non-terminal runs for a tenant. The boot
 * rehydration loop (rehydrate.ts) consumes this and asks the stage
 * engine to resume each run from its last persisted stage.
 *
 * Soft-delete filter is mandatory — the rehydration loop must never
 * pick up a soft-deleted run, even if it was paused mid-flight.
 */
export async function listActiveRunsForRecovery(
  pool: Pool,
  tenantId: TenantId,
): Promise<ReadonlyArray<RunRecord>> {
  const r = await pool.query<{
    id: string;
    tenant_id: string;
    goal_id: string;
    project_id: string;
    status: RunStatus;
    current_stage: string;
    triggered_by: Record<string, unknown>;
    cost_ceiling_usd: string;
    cost_spent_usd: string;
    started_at: string | null;
    finished_at: string | null;
    deleted_at: string | null;
    archived_at: string | null;
  }>(
    `SELECT id, tenant_id, goal_id, project_id, status, current_stage,
            triggered_by, cost_ceiling_usd::text AS cost_ceiling_usd,
            cost_spent_usd::text AS cost_spent_usd,
            started_at, finished_at, deleted_at, archived_at
       FROM agent_runs
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND status NOT IN ('done', 'aborted')`,
    [tenantId],
  );
  return r.rows.map(rowToRun);
}

/**
 * Fetch an idempotency record by (tenant, key). Returns `null` on miss.
 * Used by the replay path — the second call with the same key returns
 * the cached response.
 */
export async function findIdempotencyRecord(
  client: PoolClient | Pool,
  tenantId: TenantId,
  key: string,
): Promise<IdempotencyRecord | null> {
  const r = await client.query<{
    key: string;
    tenant_id: string;
    run_id: string | null;
    request_fingerprint: string;
    response_status: number;
    response_body: unknown;
    created_at: string;
  }>(
    `SELECT key, tenant_id, run_id, request_fingerprint,
            response_status, response_body, created_at
       FROM agent_run_idempotency_keys
      WHERE tenant_id = $1 AND key = $2`,
    [tenantId, key],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    key: row.key as IdempotencyRecord['key'],
    tenant_id: asTenantId(row.tenant_id),
    run_id: row.run_id ? (asRunId(row.run_id) as RunId) : null,
    request_fingerprint: row.request_fingerprint,
    response_status: row.response_status,
    response_body: row.response_body,
    created_at: row.created_at,
  };
}

/**
 * Persist an idempotency record. The unique (tenant_id, key) makes
 * the write itself the "have we seen this key?" check — a duplicate
 * key surfaces as a unique-violation that the caller maps to a
 * replay-or-conflict decision.
 */
export async function insertIdempotencyRecord(
  client: PoolClient,
  record: IdempotencyRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO agent_run_idempotency_keys
       (key, tenant_id, run_id, request_fingerprint,
        response_status, response_body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, now()))`,
    [
      record.key,
      record.tenant_id,
      record.run_id,
      record.request_fingerprint,
      record.response_status,
      JSON.stringify(record.response_body),
      record.created_at,
    ],
  );
}

/** Map a raw SELECT/RETURNING row to the public RunRecord shape. */
function rowToRun(row: {
  id: string;
  tenant_id: string;
  goal_id: string;
  project_id: string;
  status: RunStatus;
  current_stage: string;
  triggered_by: Record<string, unknown>;
  cost_ceiling_usd: string;
  cost_spent_usd: string;
  started_at: string | null;
  finished_at: string | null;
  deleted_at: string | null;
  archived_at: string | null;
}): RunRecord {
  return {
    id: asRunId(row.id),
    tenant_id: asTenantId(row.tenant_id),
    goal_id: asGoalId(row.goal_id) as GoalId,
    project_id: asProjectId(row.project_id) as ProjectId,
    status: row.status,
    current_stage: row.current_stage as RunRecord['current_stage'],
    // The DB stores triggered_by as jsonb; pg returns the parsed
    // value as `Record<string, unknown>`. `parseTriggerPayload`
    // narrows it to the typed `TriggerPayload` shape and throws
    // `TriggerPayloadParseError` on mismatch — a typed error the
    // operator can alert on. The schema mirrors the create-path
    // validator in server.ts, so a freshly-written row will always
    // parse; the parse surfaces legacy data or hand-edited rows.
    triggered_by: parseTriggerPayload(row.triggered_by),
    cost_ceiling_usd: row.cost_ceiling_usd,
    cost_spent_usd: row.cost_spent_usd,
    started_at: row.started_at,
    finished_at: row.finished_at,
    deleted_at: row.deleted_at,
    archived_at: row.archived_at,
  };
}

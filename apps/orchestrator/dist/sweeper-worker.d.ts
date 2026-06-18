/**
 * Cron sweeper worker — FORA-50 §6.3 + ADR-0008 §4 step 7.
 *
 * Drives `tickSweeper` once per minute per tenant. The runtime can
 * either run this in-process (a long-lived setInterval) or as a k8s
 * CronJob that exec's a one-shot binary; both shapes use the same
 * `tickSweeper` function — the difference is whether `start()` is
 * called once or `tickOnce()` is invoked per CronJob run.
 *
 * Production wiring (`bin/fora-orchestrator-worker.mjs`):
 *
 *   - `repo`  = `PgApprovalsRepo(pool)`
 *   - `bus`   = NATS adapter (FORA-136; not in this PR — see follow-up)
 *   - `pager` = PagerDuty adapter (PagerDuty service `orchestrator-approvals`)
 *   - `clock` = `{ now: () => new Date() }`
 *   - `listTenants` = `SELECT id FROM tenants` (loaded lazily)
 *
 * Until the NATS + PagerDuty adapters land, the production binary
 * binds a "recording" / "no-op" bus + pager that LOG every emit / page
 * to stdout. The next follow-up sub-task replaces the no-op bindings
 * with the real adapters; the worker contract does not change.
 *
 * Failure model: a per-tenant tick that throws is logged + skipped;
 * the interval keeps ticking. A failure of `listTenants` aborts the
 * tick (no work to do) and retries on the next interval. This matches
 * the v0.1 sweeper contract — TTL enforcement is on the row, not on
 * the worker, so a missed tick is recoverable on the next minute.
 */
import type { Pool } from 'pg';
import type { ApprovalsRepo, Clock, EventBus, Pager } from './ports.js';
import { type SweepResult } from './sweeper.js';
import type { TenantId } from './types.js';
export interface SweeperWorkerDeps {
    pool: Pool;
    repo: ApprovalsRepo;
    bus: EventBus;
    pager: Pager;
    clock: Clock;
    /**
     * Enumerate the tenants to sweep. Called once per tick. The
     * default reads `SELECT id FROM tenants`. Tests inject a static
     * list.
     */
    listTenants?: () => Promise<ReadonlyArray<TenantId>>;
    /** Tick interval (ms). Default 60_000 — one sweep per minute. */
    intervalMs?: number;
    /** Per-tenant page limit (rows per tick). Default 500. */
    pageLimit?: number;
    /**
     * Structured logger. Default writes a single JSON line per tick +
     * per tenant outcome. Pass any pino-shaped logger.
     */
    logger?: (line: Record<string, unknown>) => void;
}
export interface SweeperWorker {
    /** Start the interval. Idempotent under repeat calls. */
    start(): void;
    /** Stop the interval; safe to call when not started. */
    stop(): Promise<void>;
    /**
     * Run one full sweep cycle (one call to `listTenants`, then
     * `tickSweeper` per tenant). Returns the per-tenant outcomes so
     * tests can assert. Safe to call while the interval is running —
     * the interval ticks fire-and-forget; manual ticks run sequentially.
     */
    tickOnce(): Promise<ReadonlyArray<TenantTickOutcome>>;
    /** True if the interval has been started and not stopped. */
    isRunning(): boolean;
}
export interface TenantTickOutcome {
    tenantId: TenantId;
    result: SweepResult;
    /** Set when `tickSweeper` threw for this tenant. The interval
     *  continues; the error is logged + the outcome is recorded. */
    error?: {
        message: string;
    };
}
export declare function buildSweeperWorker(deps: SweeperWorkerDeps): SweeperWorker;

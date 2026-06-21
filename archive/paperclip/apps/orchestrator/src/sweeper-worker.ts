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
import { tickSweeper, type SweepResult } from './sweeper.js';
import type { TenantId } from './types.js';
import { asTenantId } from './types.js';

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
  error?: { message: string };
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_PAGE_LIMIT = 500;

/**
 * Default tenant enumerator — reads every tenant id from `tenants`.
 * The migration does not install a soft-delete on tenants today; if
 * v1.1 adds one, extend the query with `WHERE deleted_at IS NULL`.
 */
async function defaultListTenants(pool: Pool): Promise<ReadonlyArray<TenantId>> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM tenants`,
  );
  return r.rows.map((row) => asTenantId(row.id));
}

const defaultLogger = (line: Record<string, unknown>): void => {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({ level: 'info', service: 'orchestrator-sweeper', ...line }),
  );
};

export function buildSweeperWorker(deps: SweeperWorkerDeps): SweeperWorker {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const pageLimit = deps.pageLimit ?? DEFAULT_PAGE_LIMIT;
  const listTenants = deps.listTenants ?? (() => defaultListTenants(deps.pool));
  const logger = deps.logger ?? defaultLogger;

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  /**
   * Serialise manual + interval ticks so two ticks cannot interleave
   * their per-tenant loops on the same pool. A tick that is already
   * in flight is awaited; an interval tick that fires while a manual
   * tick is running waits for the manual tick to complete.
   */
  let tickChain: Promise<void> = Promise.resolve();

  const runTick = async (): Promise<ReadonlyArray<TenantTickOutcome>> => {
    const tickStartedAt = deps.clock.now();
    const tenants = await listTenants();
    const outcomes: TenantTickOutcome[] = [];
    for (const tenantId of tenants) {
      try {
        const result = await tickSweeper(
          { repo: deps.repo, bus: deps.bus, pager: deps.pager, clock: deps.clock },
          { tenantId, pageLimit },
        );
        outcomes.push({ tenantId, result });
        logger({
          msg: 'sweep tick',
          tenant_id: tenantId,
          scanned: result.scanned,
          paged_at_50: result.pagedAt50.length,
          expired: result.expired.length,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        outcomes.push({
          tenantId,
          result: { pagedAt50: [], expired: [], scanned: 0 },
          error: { message },
        });
        logger({
          level: 'error',
          msg: 'sweep tick failed',
          tenant_id: tenantId,
          err: message,
        });
      }
    }
    logger({
      msg: 'sweep cycle complete',
      tenants: tenants.length,
      duration_ms: deps.clock.now().getTime() - tickStartedAt.getTime(),
      at: tickStartedAt.toISOString(),
    });
    return outcomes;
  };

  const schedule = (): void => {
    if (timer !== null) return;
    timer = setInterval(() => {
      tickChain = tickChain.then(async () => {
        await runTick();
      }).catch((e) => {
        logger({
          level: 'error',
          msg: 'sweep cycle failed',
          err: e instanceof Error ? e.message : String(e),
        });
      });
    }, intervalMs);
    // unref() so the timer does not keep the event loop alive on
    // shutdown — `stop()` is the only path that ends the loop.
    if (typeof timer.unref === 'function') timer.unref();
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      schedule();
      logger({ msg: 'sweeper worker started', interval_ms: intervalMs });
    },
    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      running = false;
      // Drain any in-flight tick so we do not leave a tail of work
      // hitting the pool after the binary starts to shut down.
      try {
        await tickChain;
      } catch {
        // The error was already logged on the failed chain; swallow
        // here so stop() does not throw on shutdown.
      }
      logger({ msg: 'sweeper worker stopped' });
    },
    tickOnce(): Promise<ReadonlyArray<TenantTickOutcome>> {
      const next = tickChain.then(runTick);
      tickChain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    isRunning(): boolean {
      return running;
    },
  };
}
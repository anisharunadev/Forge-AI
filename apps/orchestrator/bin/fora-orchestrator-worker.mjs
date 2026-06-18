#!/usr/bin/env node
/**
 * Fora Orchestrator — sweeper worker entry point.
 *
 * FORA-172 (0.1.4.e). Runs the TTL sweeper every minute per tenant
 * against a live Postgres pool. This binary is the long-lived shape;
 * the k8s CronJob shape would `import { tickSweeper }` and call it
 * once per minute per tenant instead — the contract is the same.
 *
 * Bindings:
 *   - `repo`    = `PgApprovalsRepo(pool)`             (FORA-168)
 *   - `pager`   = `PagerDutyPager` when `FORA_PAGERDUTY_ROUTING_KEY`
 *                 is set; otherwise a log-only stub.
 *   - `bus`     = `NatsApprovalEventBus` when `FORA_NATS_URL` is
 *                 set; otherwise a log-only stub.
 *
 * The log-only stubs emit one JSON line per emit / page so an operator
 * can tail the binary and see what would have been published. Wiring
 * the real adapters is one env var each; this file does not branch
 * per-adapter.
 *
 * Env vars (mirror `bin/fora-orchestrator.mjs`):
 *
 *   - `FORA_DATABASE_URL`           (required)
 *   - `FORA_ORCHESTRATOR_LOG_LEVEL` (default `info`)
 *   - `FORA_SWEEPER_INTERVAL_MS`    (default 60_000)
 *   - `FORA_SWEEPER_PAGE_LIMIT`     (default 500)
 *   - `FORA_PAGERDUTY_ROUTING_KEY`  (optional — enables real PagerDuty)
 *   - `FORA_PAGERDUTY_BASE_URL`     (optional — sandbox override)
 *   - `FORA_NATS_URL`               (optional — enables real NATS)
 */

import { Pool } from 'pg';
import { runMigrations } from '@fora/db-migrator';

import { loadConfig } from '../dist/index.js';
import {
  PgApprovalsRepo,
  PagerDutyPager,
  buildSweeperWorker,
} from '../dist/index.js';

const config = loadConfig();

const pool = new Pool({
  connectionString: config.databaseUrl,
  // The sweeper is a low-fanout worker; a small pool keeps the
  // soft-delete invariant predictable and avoids hogging connections
  // on a shared Postgres.
  max: 4,
});

// Apply migrations on boot so a fresh deployment has the
// `agent_run_approvals` table before the first tick. Idempotent: a
// re-run against a migrated DB returns applied=[].
try {
  const result = await runMigrations(pool);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: 'info',
      service: 'orchestrator-sweeper',
      msg: 'migrations applied',
      applied: result.applied,
      verified: result.verified.length,
    }),
  );
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: 'fatal',
      service: 'orchestrator-sweeper',
      msg: 'migration runner failed',
      err: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(1);
}

// --- Pager binding (PagerDuty or log-only) -----------------------------
const pagerDutyRoutingKey = process.env['FORA_PAGERDUTY_ROUTING_KEY'];
const pager = pagerDutyRoutingKey
  ? new PagerDutyPager({
      routingKey: pagerDutyRoutingKey,
      ...(process.env['FORA_PAGERDUTY_BASE_URL']
        ? { baseUrl: process.env['FORA_PAGERDUTY_BASE_URL'] }
        : {}),
    })
  : {
      async pageApprover(args) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            level: 'info',
            service: 'orchestrator-sweeper',
            msg: 'pager.pageApprover (log-only; set FORA_PAGERDUTY_ROUTING_KEY for real)',
            args,
          }),
        );
        return { pageId: `log-${args.idempotencyKey}` };
      },
    };

// --- Bus binding (NATS or log-only) -----------------------------------
// The NATS adapter lives behind a dynamic import so dev runs without
// the broker do not pull in the `nats` client. Production wires the
// real adapter once `FORA_NATS_URL` is set.
let bus;
let natsBundle = null;
const natsUrl = process.env['FORA_NATS_URL'];
if (natsUrl) {
  const adapters = await import('../dist/adapters/event-bus-nats.js');
  const { connectNatsApprovalEventBus } = adapters;
  const connection = await connectNatsApprovalEventBus({ url: natsUrl });
  bus = connection.bus;
  natsBundle = connection.bundle;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: 'info',
      service: 'orchestrator-sweeper',
      msg: 'NATS bus bound',
      url: natsUrl,
    }),
  );
} else {
  bus = {
    async emit(event) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          level: 'info',
          service: 'orchestrator-sweeper',
          msg: 'bus.emit (log-only; set FORA_NATS_URL for real)',
          event,
        }),
      );
    },
  };
}

const repo = new PgApprovalsRepo(pool);
const clock = { now: () => new Date() };

const worker = buildSweeperWorker({
  pool,
  repo,
  bus,
  pager,
  clock,
  intervalMs: parseInt(process.env['FORA_SWEEPER_INTERVAL_MS'] ?? '60000', 10),
  pageLimit: parseInt(process.env['FORA_SWEEPER_PAGE_LIMIT'] ?? '500', 10),
});

worker.start();

// --- Graceful shutdown ------------------------------------------------
// Drain any in-flight tick before the pool closes. SIGTERM is what
// k8s sends; SIGINT covers `npm run dev` Ctrl-C.
const shutdown = async (signal) => {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({ level: 'info', service: 'orchestrator-sweeper', msg: 'shutdown', signal }),
  );
  await worker.stop();
  if (natsBundle) {
    try {
      await natsBundle.close();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          level: 'warn',
          service: 'orchestrator-sweeper',
          msg: 'NATS drain failed',
          err: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
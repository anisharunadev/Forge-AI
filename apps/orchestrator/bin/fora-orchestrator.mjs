#!/usr/bin/env node
/**
 * Fora Orchestrator — production entry point.
 *
 * Loads config, applies migrations (idempotent — the runner is a no-op
 * on a migrated DB), opens the Postgres pool, and starts the Fastify
 * server. Crash recovery runs once at boot, before the listener is
 * opened; the recovery tickets are logged (FORA-135's stage engine
 * will own the actual resume).
 */

import { Pool } from 'pg';
import { runMigrations } from '@fora/db-migrator';

import {
  buildServer,
  buildRecoveryTickets,
  loadConfig,
  PgApprovalsRepo,
  PagerDutyPager,
  PaperclipHttpClient,
} from '../dist/index.js';

const config = loadConfig();

const pool = new Pool({
  connectionString: config.databaseUrl,
  // pg defaults to 10; the orchestrator is a low-fanout service and
  // a small pool keeps the soft-delete invariant predictable.
  max: 8,
});

// Apply migrations before the listener opens. The runner is idempotent;
// a re-run against a migrated DB returns applied=[] and is a no-op.
try {
  const result = await runMigrations(pool);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: 'info',
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
      msg: 'migration runner failed',
      err: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(1);
}

// --- Approvals ports wiring (FORA-137) --------------------------------
const repo = new PgApprovalsRepo(pool);
const clock = { now: () => new Date() };

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
            msg: 'pager.pageApprover (log-only; set FORA_PAGERDUTY_ROUTING_KEY for real)',
            args,
          }),
        );
        return { pageId: `log-${args.idempotencyKey}` };
      },
    };

const paperclip = new PaperclipHttpClient({
  apiKey: process.env['PAPERCLIP_API_KEY'] ?? 'dummy',
  baseUrl: process.env['PAPERCLIP_API_URL'] ?? 'http://localhost:3000',
});

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
          msg: 'bus.emit (log-only; set FORA_NATS_URL for real)',
          event,
        }),
      );
    },
  };
}

const app = await buildServer({
  config,
  pool,
  approvals: { repo, clock, pager, paperclip, bus },
});
await app.listen({ port: config.port, host: config.host });
// eslint-disable-next-line no-console
console.log(
  JSON.stringify({
    level: 'info',
    msg: 'orchestrator listening',
    port: config.port,
    host: config.host,
  }),
);

// Crash recovery: list non-terminal runs and log the resume tickets.
// FORA-135 will replace this with the actual engine resume; today we
// just prove the boot path can rebuild state from the DB.
const tenantIdHeader = process.env['FORA_BOOT_RECOVERY_TENANT_ID'];
if (tenantIdHeader) {
  const tickets = await buildRecoveryTickets(pool, tenantIdHeader);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'boot recovery tickets',
      tenant_id: tenantIdHeader,
      count: tickets.length,
      tickets: tickets.map((t) => ({
        run_id: t.run.id,
        current_stage: t.run.current_stage,
        resume_from_stage: t.resumeFrom.stage,
        resume_from_status: t.resumeFrom.status,
      })),
    }),
  );
}

// Graceful shutdown — close pool + listener on SIGINT/SIGTERM.
const shutdown = async (signal) => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }));
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

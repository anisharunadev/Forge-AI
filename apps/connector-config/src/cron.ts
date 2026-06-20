/**
 * @fora/connector-config — cron registration surface (FORA-545).
 *
 * Implements the cron descriptors the orchestrator / k8s CronJob
 * installer reads so the orphan-risk and 90-day re-attestation
 * sweepers run on a schedule without the deployment system
 * having to parse shell strings.
 *
 * Spec source: FORA-391 Plan 4 §4 (override rules) + FORA-545.
 *
 * ---- Two registrations -----------------------------------------------------
 *
 *   connector-config-orphan-sweep           — daily, 03:00 UTC
 *     Runs `detectOrphanRisk` for every active
 *     `(tenant, connector, auth_method)` tuple. Emits
 *     `connector.binding.orphan_risk` for every override whose
 *     tenant default is missing or revoked. The audit forwarder
 *     (FORA-36) deduplicates by `event_id`; re-running on the
 *     same override yields no new events on the second pass
 *     (the sweeper is keyed on `(binding_id, day)` via the
 *     mint-then-dedup pattern; for v0.1 the audit row count is
 *     the upper bound).
 *
 *   connector-config-attestation-sweep      — daily, 04:00 UTC
 *     Runs `detectExpiredAttestations` for every active
 *     `(tenant, connector)` tuple. Marks expired rows as
 *     `status='attesting'` and emits
 *     `connector.binding.attestation_expired`. The audit
 *     forwarder dedupes by `event_id`; re-running on the same
 *     snapshot is a no-op (the sweeper is monotonic — once an
 *     attestation is past due it stays past due until the
 *     Architect re-attests via the admin API).
 *
 * ---- Why a TS descriptor (not Python) --------------------------------------
 *
 * The connector-config sweepers are pure TS async functions;
 * shelling to Python would add a runtime dep + a desync risk.
 * The descriptor is a pure data shape — no business logic —
 * so the orchestrator can register the k8s CronJob without
 * importing `@fora/db-pool` or `@fora/connector-config`.
 *
 * The sync-plane-job worker (`apps/sync-plane-job/
 * src/nightly_cron.ts`) is the precedent for the descriptor
 * shape; this file mirrors that contract.
 */

import type { AuthMethod, ConnectorId } from './types.js';

// ---------------------------------------------------------------------------
// Cron descriptor shape (mirrors sync-plane-job)
// ---------------------------------------------------------------------------

/**
 * The cron registration descriptor the orchestrator / k8s
 * CronJob installer reads. Pure data; no side effects.
 */
export interface ConnectorCronDescriptor {
  readonly name: string;
  readonly schedule: string;
  readonly command: ReadonlyArray<string>;
  readonly shared_with: ReadonlyArray<string>;
  readonly idempotent: boolean;
  readonly audit_event_type: string;
  readonly registered_at: string;
}

// ---------------------------------------------------------------------------
// Schedule constants
// ---------------------------------------------------------------------------

/**
 * Cron schedule (5-field, UTC) for the orphan-risk sweep.
 * 03:00 UTC = low-traffic window (the customer-cloud-broker
 * 5-min probe runs all day; the FORA-204 daily drift report
 * closes at ~01:00 UTC; this slot leaves 90 min of headroom
 * between the drift report and the orphan sweep).
 */
const ORPHAN_SWEEP_SCHEDULE = '0 3 * * *';

/**
 * Cron schedule for the 90-day re-attestation sweep.
 * 04:00 UTC — one hour after orphan sweep so the two sweeps
 * don't contend for the same audit-forwarder write window.
 */
const ATTESTATION_SWEEP_SCHEDULE = '0 4 * * *';

/**
 * The CLI argv the orchestrator invokes. The first element is
 * the package bin name; the second is the action verb.
 * `pnpm --filter @fora/connector-config sweep:orphan` and
 * `pnpm --filter @fora/connector-config sweep:attestation`
 * resolve to the same `bin/daily_sweep.mjs` entry point.
 */
const SWEEP_COMMAND: ReadonlyArray<string> = [
  'pnpm',
  '--filter',
  '@fora/connector-config',
  'sweep',
];

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Build the connector-config cron registration descriptors.
 *
 * Two registrations are returned — the orchestrator registers
 * each one as a separate k8s CronJob. Both are idempotent;
 * running the sweep twice on the same wall-clock day yields
 * the same audit row count (the `connector.binding.audit`
 * table has a uniqueness constraint on `event_id`).
 *
 * `now` is injected so tests can assert on a deterministic
 * `registered_at` timestamp without leaking wall-clock drift.
 */
export function registerConnectorCrons(
  now: () => Date = () => new Date(),
): ReadonlyArray<ConnectorCronDescriptor> {
  const registered_at = now().toISOString();
  return [
    {
      name: 'connector-config-orphan-sweep',
      schedule: ORPHAN_SWEEP_SCHEDULE,
      command: [...SWEEP_COMMAND, 'orphan'],
      shared_with: ['FORA-545', 'FORA-391.3'],
      idempotent: true,
      audit_event_type: 'connector.binding.orphan_risk',
      registered_at,
    },
    {
      name: 'connector-config-attestation-sweep',
      schedule: ATTESTATION_SWEEP_SCHEDULE,
      command: [...SWEEP_COMMAND, 'attestation'],
      shared_with: ['FORA-545', 'FORA-391.3'],
      idempotent: true,
      audit_event_type: 'connector.binding.attestation_expired',
      registered_at,
    },
  ];
}

// ---------------------------------------------------------------------------
// Sweep worker (production wiring)
// ---------------------------------------------------------------------------

/**
 * The sweep argument. The orchestrator passes the action verb
 * (`orphan` or `attestation`) the k8s CronJob argv carried;
 * the worker walks the matching (tenant, connector) pairs and
 * invokes the right sweeper.
 *
 * The worker is intentionally narrow — it does NOT take a
 * `tenant_id` filter. The cron sweep must cover every active
 * tenant; a per-tenant cron is a deployment mistake (every
 * tenant would need its own CronJob).
 */
export type SweepAction = 'orphan' | 'attestation';

/**
 * The per-sweep result. Persisted to the evidence JSON the
 * close-gate reviewer reads; the smoke test asserts the
 * shape.
 */
export interface SweepRunResult {
  readonly action: SweepAction;
  readonly started_at: string;
  readonly duration_ms: number;
  readonly tenants_scanned: number;
  readonly connector_pairs_scanned: number;
  readonly orphan_events_emitted: number;
  readonly attestation_events_emitted: number;
  readonly errors: ReadonlyArray<string>;
}

/**
 * Walk every active `(tenant_id, connector_id, auth_method)`
 * tuple and run the orphan-risk sweeper. Production wires the
 * real `@fora/db-pool` `TenantAwarePool`; tests wire the
 * `FakeScopedClient` from `./test/fakes.js`.
 *
 * Returns the per-run summary. The audit forwarder is the
 * durable record; this function does not log to stdout beyond
 * the returned summary so the cron worker can pipe the
 * evidence JSON to disk.
 *
 * NOTE: For v0.1 the worker takes the audit sink + client as
 * arguments so the smoke test can run with the in-memory
 * audit sink + fake client. Production wires the real
 * `@fora/db-pool` and the FORA-36 forwarder in
 * `apps/connector-config/bin/daily_sweep.mjs`.
 */
export interface ConnectorSweepWorkerArgs {
  readonly client: import('@fora/db-pool').ScopedClient;
  readonly audit: import('./audit.js').ConnectorBindingAuditSink;
  readonly now?: () => Date;
}

/**
 * Walk the active tenants + connectors and run the orphan-risk
 * sweeper for every `(tenant, connector, auth_method)` triple.
 * The audit forwarder (FORA-36) deduplicates by `event_id`;
 * re-running on the same day yields the same event_ids in
 * the audit table (the forA-36 dedup is on `(event_id)` per
 * ADR-0009 §5).
 */
export async function runOrphanSweep(
  args: ConnectorSweepWorkerArgs,
): Promise<SweepRunResult> {
  return runSweep('orphan', args);
}

/**
 * Walk the active tenants + connectors and run the 90-day
 * re-attestation sweeper for every `(tenant, connector)`
 * pair. The auth_method walk is unnecessary — the sweeper's
 * SQL filters by `(tenant_id, connector_id, status,
 * attestation_expires_at < now())` regardless of method.
 */
export async function runAttestationSweep(
  args: ConnectorSweepWorkerArgs,
): Promise<SweepRunResult> {
  return runSweep('attestation', args);
}

/**
 * The shared sweep worker. Walks the active
 * `(tenant_id, connector_id)` pairs and invokes the right
 * sweeper for each pair.
 *
 * For v0.1 the tenant/connector enumeration is a SQL query
 * the worker issues directly via `args.client`. Production
 * wires `@fora/db-pool`; the smoke wires the fake.
 */
async function runSweep(
  action: SweepAction,
  args: ConnectorSweepWorkerArgs,
): Promise<SweepRunResult> {
  const t0 = (args.now ?? (() => new Date()))().getTime();
  const started_at = new Date(t0).toISOString();
  const errors: string[] = [];

  // Enumerate every active (tenant, connector) pair. The
  // sweeper handles each pair separately so the audit
  // forwarder's per-event dedup key (`event_id`) lines up
  // with the per-pair emit.
  const tenantConnectorResult = await args.client.query<{
    tenant_id: string;
    connector_id: string;
    auth_method: string;
  }>(
    `SELECT DISTINCT tenant_id, connector_id, auth_method
       FROM connector_binding
      WHERE status = 'active'`,
    [],
  );

  const tenants = new Set<string>();
  let orphan_events = 0;
  let attestation_events = 0;

  for (const row of tenantConnectorResult.rows) {
    tenants.add(row.tenant_id);
    try {
      if (action === 'orphan') {
        // Re-import dynamically to avoid a circular import at
        // module-load time (override.ts imports audit.ts which
        // is a sibling of this module).
        const { detectOrphanRisk } = await import('./override.js');
        const emitted = await detectOrphanRisk({
          client: args.client,
          audit: args.audit,
          tenant_id: row.tenant_id as import('@fora/db-pool').TenantId,
          connector_id: row.connector_id as ConnectorId,
          auth_method: row.auth_method as AuthMethod,
        });
        orphan_events += emitted.length;
      } else {
        const { detectExpiredAttestations } = await import('./override.js');
        const emitted = await detectExpiredAttestations({
          client: args.client,
          audit: args.audit,
          tenant_id: row.tenant_id as import('@fora/db-pool').TenantId,
          connector_id: row.connector_id as ConnectorId,
        });
        attestation_events += emitted.length;
      }
    } catch (err) {
      errors.push(
        `${row.tenant_id}/${row.connector_id}: ${(err as Error).message}`,
      );
    }
  }

  const duration_ms = (args.now ?? (() => new Date()))().getTime() - t0;
  return {
    action,
    started_at,
    duration_ms,
    tenants_scanned: tenants.size,
    connector_pairs_scanned: tenantConnectorResult.rows.length,
    orphan_events_emitted: orphan_events,
    attestation_events_emitted: attestation_events,
    errors,
  };
}

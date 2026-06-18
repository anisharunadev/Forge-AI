/**
 * TTL sweeper — FORA-50 §6.3 + ADR-0008 §4 step 7.
 *
 * The sweeper runs on a cron (FORA-136 event bus + a separate
 * scheduler; in v1 the runtime calls `tickSweeper` from a `setInterval`
 * or a cron worker). Every tick:
 *
 *   1. For every `pending` row whose `expires_at <= now()`:
 *      - Set `status = 'expired'`.
 *      - Emit `approval_expired` to the bus.
 *      - Page the operator (PagerDuty service `orchestrator-approvals`).
 *      - Do NOT auto-cancel; the operator can extend or cancel.
 *
 *   2. For every row at >= 50% TTL that has not yet been paged at 50%
 *      AND `pagesAt50Percent(tier) === true`:
 *      - Mark `paged_at_50_percent = true`.
 *      - Page the approver once (idempotency key derived from approvalId).
 *
 * The sweeper is the contract for TTL — the TTL is enforced on the row,
 * not in Paperclip. A replay of the sweeper against the same wall-clock
 * is a no-op (markPagedAt50Percent is idempotent; expire is monotonic).
 */

import {
  GATES,
  pagesAt50Percent,
  type RoleOfRecord,
  type TtlTier,
} from './gates.js';
import type { ApprovalsRepo, Clock, EventBus, Pager } from './ports.js';
import type { ApprovalRecord } from './router-types.js';
import type { IdempotencyKey, RunId, TenantId } from './types.js';

export interface SweeperDeps {
  repo: ApprovalsRepo;
  bus: EventBus;
  pager: Pager;
  clock: Clock;
}

/** Result returned to the cron worker so it can log / alert. */
export interface SweepResult {
  pagedAt50: ReadonlyArray<string>;
  expired: ReadonlyArray<string>;
  scanned: number;
}

/** Tick the sweeper once. Idempotent against the same `clock.now()`. */
export async function tickSweeper(
  deps: SweeperDeps,
  args: { tenantId?: TenantId; pageLimit?: number } = {},
): Promise<SweepResult> {
  const asOf = deps.clock.now();
  const limit = args.pageLimit ?? 500;
  const pending = await deps.repo.listPendingForSweep({
    tenantId: args.tenantId,
    asOf,
    limit,
  });

  const pagedAt50: string[] = [];
  const expired: string[] = [];

  for (const row of pending) {
    const expiresAtMs = new Date(row.expires_at).getTime();
    const requestedAtMs = new Date(row.requested_at).getTime();
    const totalTtlMs = expiresAtMs - requestedAtMs;
    if (totalTtlMs <= 0) {
      // A row with non-positive TTL is malformed; expire it now so
      // it does not wedge the sweeper.
      await expireRow(deps, row);
      expired.push(row.id);
      continue;
    }

    const ageMs = asOf.getTime() - requestedAtMs;
    const halfTtlReached = ageMs >= totalTtlMs / 2;
    const expiredNow = asOf.getTime() >= expiresAtMs;

    if (expiredNow) {
      await expireRow(deps, row);
      expired.push(row.id);
      continue;
    }

    if (halfTtlReached && !row.paged_at_50_percent) {
      const tier = tierForRole(row.required_role);
      if (tier && pagesAt50Percent(tier)) {
        await deps.pager.pageApprover({
          approvalId: row.id,
          runId: row.run_id as unknown as RunId,
          role: row.required_role,
          reason: 'ttl_50_percent',
          idempotencyKey: `pager-50:${row.id}` as IdempotencyKey,
        });
        await deps.repo.markPagedAt50Percent({
          approvalId: row.id,
          tenantId: row.tenant_id as unknown as TenantId,
        });
        pagedAt50.push(row.id);
      }
    }
  }

  return { pagedAt50, expired, scanned: pending.length };
}

/**
 * Internal: expire one row. The repo's `expire` call is atomic with
 * the run header transition (paused). The event is emitted after the
 * write succeeds so the bus cannot advertise an expiry that the DB
 * did not persist.
 */
async function expireRow(
  deps: SweeperDeps,
  row: ApprovalRecord,
): Promise<void> {
  const now = deps.clock.now();
  await deps.repo.expire({
    approvalId: row.id,
    tenantId: row.tenant_id as unknown as TenantId,
    expiredAt: now,
  });
  await deps.bus.emit({
    type: 'approval_expired',
    tenantId: row.tenant_id as unknown as TenantId,
    runId: row.run_id as unknown as RunId,
    approvalId: row.id,
    expiredAt: now.toISOString(),
  });
  await deps.pager.pageApprover({
    approvalId: row.id,
    runId: row.run_id as unknown as RunId,
    role: row.required_role,
    reason: 'ttl_100_percent_expired',
    idempotencyKey: `pager-exp:${row.id}` as IdempotencyKey,
  });
}

/**
 * Map a `required_role` back to its TTL tier. The role → tier mapping
 * is fixed in the gate table; we invert it here so the row schema
 * stays narrow (the tier is derived, not stored).
 */
function tierForRole(role: RoleOfRecord): TtlTier | null {
  const gate = GATES.find((g) => g.required_role === role);
  return gate ? gate.ttl : null;
}

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
import type { ApprovalsRepo, Clock, EventBus, Pager } from './ports.js';
import type { TenantId } from './types.js';
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
export declare function tickSweeper(deps: SweeperDeps, args?: {
    tenantId?: TenantId;
    pageLimit?: number;
}): Promise<SweepResult>;

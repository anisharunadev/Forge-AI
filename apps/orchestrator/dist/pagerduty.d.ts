/**
 * PagerDuty V2 Events API adapter for the `Pager` port.
 *
 * FORA-171 (0.1.4.d). Sub-task of [FORA-137](/FORA/issues/FORA-137).
 *
 * Maps `pageApprover()` → `POST {baseUrl}/v2/enqueue` against service
 * `orchestrator-approvals` (per FORA-50 §6.3). The PagerDuty
 * `dedup_key` is the sweeper's `idempotencyKey` so a replay is a
 * no-op at the PagerDuty side (PagerDuty updates the existing
 * incident rather than creating a new one).
 *
 * Severity mapping:
 *   - `ttl_50_percent`         → `warning`  (approver nudge)
 *   - `ttl_100_percent_expired`→ `error`    (run paused; needs action)
 *
 * The adapter is intentionally thin: no queue, no background worker.
 * The sweeper calls `pageApprover` synchronously. PagerDuty's own
 * dedup window (default 24 h) covers a sweeper replay at the same
 * wall-clock; the PagerDuty dashboard collapses the duplicates.
 *
 * Configuration:
 *   - `routingKey`  — PagerDuty Events API v2 integration key. The
 *                     adapter refuses to start without one.
 *   - `baseUrl`     — defaults to `https://events.pagerduty.com`
 *                     (sandbox / private deployments override).
 *   - `fetchImpl`   — test seam. Defaults to `globalThis.fetch`.
 *   - `maxRetries`  — retries on 5xx or network error. Default 3.
 *
 * Failure model:
 *   - 2xx                  → resolve with `{ pageId }`. The pageId is
 *                            the `dedup_key` (the PagerDuty
 *                            incident-side id is opaque).
 *   - 4xx                  → throw `PagerDutyClientError` (no retry —
 *                            the body is wrong; retrying will not
 *                            help).
 *   - 5xx / network error  → throw `PagerDutyServerError` after
 *                            `maxRetries` attempts; the sweeper logs
 *                            and moves on. The approval is still
 *                            pending; the next sweeper tick re-pages
 *                            (the `dedup_key` keeps PagerDuty from
 *                            double-paging).
 *
 * Idempotency contract — matches the sweeper's page-once rule:
 *   - The sweeper derives the idempotencyKey from the approval id
 *     (`pager-50:{id}` / `pager-exp:{id}`) and passes it through.
 *   - The adapter forwards it as PagerDuty `dedup_key`.
 *   - A replay with the same `dedup_key` updates the same incident
 *     on PagerDuty; locally, the adapter is a pure pass-through so
 *     the return value is deterministic on replay.
 */
import type { Clock, Pager } from './ports.js';
import type { IdempotencyKey, RunId } from './types.js';
/** PagerDuty V2 payload severity levels (subset we use). */
export type PagerDutySeverity = 'warning' | 'error';
/** Approver-paging reasons the sweeper can fire. */
export type PageReason = 'ttl_50_percent' | 'ttl_100_percent_expired';
/** Configuration for `PagerDutyPager`. */
export interface PagerDutyPagerConfig {
    /** PagerDuty Events API v2 integration key (a 32-char hex string). */
    routingKey: string;
    /** PagerDuty API base. Defaults to `https://events.pagerduty.com`. */
    baseUrl?: string;
    /** Fetch implementation (test seam). Defaults to `globalThis.fetch`. */
    fetchImpl?: typeof fetch;
    /** Clock (test seam). Default wall-clock via `Date.now()`. */
    clock?: Clock;
    /** Max retry attempts on 5xx or network error. Default 3. */
    maxRetries?: number;
    /** Initial backoff in ms; doubled per retry. Default 200. */
    retryBaseMs?: number;
}
/**
 * Map the sweeper's page reason to a PagerDuty severity. The mapping
 * is fixed by FORA-50 §6.3: 50% TTL is a nudge (warning); 100% TTL
 * expired is a run-paused incident (error).
 */
export declare function severityForReason(reason: PageReason): PagerDutySeverity;
/**
 * Thrown on 4xx responses. The body PagerDuty returns is included for
 * debugging; the sweeper does not retry.
 */
export declare class PagerDutyClientError extends Error {
    readonly typed: {
        code: 'PAGERDUTY_CLIENT_ERROR';
        message: string;
        status: number;
        body: string;
    };
    constructor(typed: {
        code: 'PAGERDUTY_CLIENT_ERROR';
        message: string;
        status: number;
        body: string;
    });
}
/**
 * Thrown on 5xx responses or network errors after the retry budget
 * is exhausted. The sweeper catches and logs; the approval is still
 * pending and the next tick re-pages (PagerDuty dedupe keeps the
 * side effect to a single incident).
 */
export declare class PagerDutyServerError extends Error {
    readonly typed: {
        code: 'PAGERDUTY_SERVER_ERROR';
        message: string;
        status: number | null;
        attempts: number;
    };
    constructor(typed: {
        code: 'PAGERDUTY_SERVER_ERROR';
        message: string;
        status: number | null;
        attempts: number;
    });
}
/**
 * The PagerDuty V2 adapter. Stateless; the constructor validates the
 * routing key and the methods are pure pass-throughs.
 */
export declare class PagerDutyPager implements Pager {
    private readonly routingKey;
    private readonly baseUrl;
    private readonly fetchImpl;
    private readonly clock;
    private readonly maxRetries;
    private readonly retryBaseMs;
    constructor(config: PagerDutyPagerConfig);
    pageApprover(args: {
        approvalId: string;
        runId: RunId;
        role: import('./gates.js').RoleOfRecord;
        reason: PageReason;
        idempotencyKey: IdempotencyKey;
    }): Promise<{
        pageId: string;
    }>;
    private buildSummary;
    /**
     * Send the body with exponential backoff on 5xx / network errors.
     * 4xx raises `PagerDutyClientError` immediately (no retry — the
     * body is wrong; retrying with the same body will fail the same
     * way).
     */
    private sendWithRetry;
    private sleep;
}

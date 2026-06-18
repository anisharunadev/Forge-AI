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

/** Default PagerDuty Events API v2 base. */
const DEFAULT_BASE_URL = 'https://events.pagerduty.com';

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
export function severityForReason(reason: PageReason): PagerDutySeverity {
  switch (reason) {
    case 'ttl_50_percent':
      return 'warning';
    case 'ttl_100_percent_expired':
      return 'error';
  }
}

/**
 * Body posted to PagerDuty V2. Schema is the public Events API v2
 * shape — see https://developer.pagerduty.com/docs/events-api-v2.
 */
interface PagerDutyEnqueueBody {
  /** Always "trigger" for the pageApprover path. */
  event_action: 'trigger';
  /** PagerDuty integration key. */
  routing_key: string;
  /**
   * PagerDuty dedupe key. Same key → same incident. We use the
   * sweeper's idempotencyKey so the sweeper's "page once" rule maps
   * 1:1 to PagerDuty's own dedupe window.
   */
  dedup_key: string;
  payload: {
    summary: string;
    source: 'orchestrator-approvals';
    severity: PagerDutySeverity;
    custom_details: {
      approvalId: string;
      runId: string;
      role: string;
      reason: PageReason;
      idempotencyKey: string;
      /** ISO-8601 wall-clock the page fired at. */
      firedAt: string;
    };
  };
}

/**
 * Successful PagerDuty response. The `dedup_key` echoes the request;
 * we surface it as the `pageId` so the sweeper's "page-once" log
 * records a stable id.
 */
interface PagerDutyEnqueueResponse {
  status: 'success';
  message: string;
  dedup_key: string;
}

/**
 * Thrown on 4xx responses. The body PagerDuty returns is included for
 * debugging; the sweeper does not retry.
 */
export class PagerDutyClientError extends Error {
  constructor(
    public readonly typed: {
      code: 'PAGERDUTY_CLIENT_ERROR';
      message: string;
      status: number;
      body: string;
    },
  ) {
    super(typed.message);
    this.name = 'PagerDutyClientError';
  }
}

/**
 * Thrown on 5xx responses or network errors after the retry budget
 * is exhausted. The sweeper catches and logs; the approval is still
 * pending and the next tick re-pages (PagerDuty dedupe keeps the
 * side effect to a single incident).
 */
export class PagerDutyServerError extends Error {
  constructor(
    public readonly typed: {
      code: 'PAGERDUTY_SERVER_ERROR';
      message: string;
      status: number | null;
      attempts: number;
    },
  ) {
    super(typed.message);
    this.name = 'PagerDutyServerError';
  }
}

/**
 * The PagerDuty V2 adapter. Stateless; the constructor validates the
 * routing key and the methods are pure pass-throughs.
 */
export class PagerDutyPager implements Pager {
  private readonly routingKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(config: PagerDutyPagerConfig) {
    if (!config.routingKey) {
      throw new Error('PagerDutyPager: routingKey is required');
    }
    this.routingKey = config.routingKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.clock = config.clock ?? { now: () => new Date() };
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 200;
  }

  async pageApprover(args: {
    approvalId: string;
    runId: RunId;
    role: import('./gates.js').RoleOfRecord;
    reason: PageReason;
    idempotencyKey: IdempotencyKey;
  }): Promise<{ pageId: string }> {
    const body: PagerDutyEnqueueBody = {
      event_action: 'trigger',
      routing_key: this.routingKey,
      dedup_key: args.idempotencyKey,
      payload: {
        summary: this.buildSummary(args),
        source: 'orchestrator-approvals',
        severity: severityForReason(args.reason),
        custom_details: {
          approvalId: args.approvalId,
          runId: args.runId,
          role: args.role,
          reason: args.reason,
          idempotencyKey: args.idempotencyKey,
          firedAt: this.clock.now().toISOString(),
        },
      },
    };

    const response = await this.sendWithRetry(body);
    // The `dedup_key` echoes the request — we return it as the pageId
    // so the sweeper's `paged` log records a stable, replayable id.
    return { pageId: response.dedup_key };
  }

  // ---- internals -----------------------------------------------------

  private buildSummary(args: {
    approvalId: string;
    runId: RunId;
    role: import('./gates.js').RoleOfRecord;
    reason: PageReason;
  }): string {
    const verb =
      args.reason === 'ttl_50_percent' ? 'needs review' : 'has expired';
    return `Orchestrator approval ${args.approvalId} ${verb} (run=${args.runId}, role=${args.role})`;
  }

  /**
   * Send the body with exponential backoff on 5xx / network errors.
   * 4xx raises `PagerDutyClientError` immediately (no retry — the
   * body is wrong; retrying with the same body will fail the same
   * way).
   */
  private async sendWithRetry(
    body: PagerDutyEnqueueBody,
  ): Promise<PagerDutyEnqueueResponse> {
    const url = `${this.baseUrl}/v2/enqueue`;
    let lastError: { status: number | null; message: string } | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt > 0) {
        await this.sleep(this.retryBaseMs * Math.pow(2, attempt - 1));
      }
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          // 2xx — PagerDuty's body is { status, message, dedup_key }.
          // We re-parse rather than trust the shape; a malformed body
          // means PagerDuty shipped a breaking change.
          const json = (await res.json()) as Partial<PagerDutyEnqueueResponse>;
          if (json.status !== 'success' || !json.dedup_key) {
            throw new PagerDutyServerError({
              code: 'PAGERDUTY_SERVER_ERROR',
              message: `PagerDuty returned 2xx but malformed body: ${JSON.stringify(json)}`,
              status: res.status,
              attempts: attempt + 1,
            });
          }
          return {
            status: 'success',
            message: json.message ?? 'Event processed',
            dedup_key: json.dedup_key,
          };
        }
        if (res.status >= 400 && res.status < 500) {
          // 4xx — client error. No retry.
          const text = await res.text();
          throw new PagerDutyClientError({
            code: 'PAGERDUTY_CLIENT_ERROR',
            message: `PagerDuty rejected the page (HTTP ${res.status}): ${text}`,
            status: res.status,
            body: text,
          });
        }
        // 5xx — record and retry.
        const text = await res.text().catch(() => '');
        lastError = { status: res.status, message: text };
        continue;
      } catch (e) {
        if (e instanceof PagerDutyClientError) {
          // Re-throw without retry.
          throw e;
        }
        // Network / parse error — record and retry.
        lastError = {
          status: null,
          message: e instanceof Error ? e.message : String(e),
        };
        continue;
      }
    }

    throw new PagerDutyServerError({
      code: 'PAGERDUTY_SERVER_ERROR',
      message: `PagerDuty enqueue failed after ${this.maxRetries} attempts: ${
        lastError?.message ?? 'unknown error'
      }`,
      status: lastError?.status ?? null,
      attempts: this.maxRetries,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

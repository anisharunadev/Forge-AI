/**
 * Paperclip HTTP client adapter — FORA-169.
 *
 * Implements the `PaperclipClient` port (`./ports.ts`) against the
 * Paperclip REST API. Sub-task of FORA-137 (Human-approval router).
 *
 * Wire contract (ADR-0008 §4 step 3):
 *
 *   POST {PAPERCLIP_API_URL}/api/issues/{issueId}/interactions
 *   Headers:
 *     Authorization: Bearer $PAPERCLIP_API_KEY
 *     X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID  (audit trail)
 *     Content-Type: application/json
 *   Body:
 *     {
 *       kind: 'request_confirmation' | 'request_board_approval',
 *       idempotencyKey: 'approval:{run_id}:{stage}|:rev{N}',
 *       target: { type: 'issue_document', issueId, key: 'plan', revisionId },
 *       continuationPolicy: 'wake_assignee' | 'wake_assignee_on_accept',
 *       payload: { version: 1, title, prompt, role, artefactRefs, ttlSeconds },
 *       // Only on reissue(): the prior interaction id, so Paperclip's
 *       // audit log records the supersede chain.
 *       metadata?: { superseded_interaction_id: string },
 *     }
 *
 * Behaviour:
 *
 *   - 5xx is retried with exponential backoff (250ms → 500ms → 1s),
 *     max 3 attempts, then a `PaperclipHttpError` with code
 *     `UPSTREAM_UNAVAILABLE`. The router treats this as transient:
 *     the row is already persisted (ADR-0008 §4 step 1), so the
 *     sweeper retries on the next minute; no event is lost.
 *   - 4xx is surfaced as a typed `PaperclipHttpError` with the API's
 *     code preserved (e.g. `VALIDATION`, `IDEMPOTENCY_CONFLICT`).
 *     The router maps these to 502 with the API code in the audit
 *     envelope; they do NOT silently retry.
 *   - A duplicate `idempotencyKey` is the API's dedupe boundary —
 *     the call returns the original `interactionId`. The router
 *     records that id on `agent_run_approvals.paperclip_interaction_id`,
 *     so a re-run of `routeGate` does not create a second card.
 *
 * Test seam: the constructor accepts a `fetchImpl` so unit tests can
 * inject a stub without monkey-patching globalThis.fetch.
 */
import type { PaperclipClient } from './ports.js';
import type { PaperclipInteraction } from './router-types.js';
export interface PaperclipHttpClientConfig {
    /** Base URL of the Paperclip API, e.g. `https://paperclip.example.com`. */
    apiUrl: string;
    /** Bearer token injected via `PAPERCLIP_API_KEY`. */
    apiKey: string;
    /** Run id stamped on every call for audit (ADR-0008 §4 step 4). */
    runId: string;
    /** Max attempts on a 5xx. Default 3 (1 initial + 2 retries). */
    maxAttempts?: number;
    /** Base delay for exponential backoff in ms. Default 250. */
    backoffBaseMs?: number;
    /** Fetch impl. Defaults to global fetch; tests inject a stub. */
    fetchImpl?: typeof fetch;
    /** Optional sleep seam; defaults to `setTimeout`. Tests inject a no-op. */
    sleep?: (ms: number) => Promise<void>;
}
export interface PaperclipInteractionResponse {
    interactionId: string;
}
/**
 * Typed error. `code` is one of:
 *   - `VALIDATION` — 4xx other than `IDEMPOTENCY_CONFLICT`. Mapped to
 *     502 by the upstream router layer; do NOT retry.
 *   - `IDEMPOTENCY_CONFLICT` — the API saw a reused key with a
 *     different body. Should never happen for a deterministic
 *     router; surfaced for the audit log.
 *   - `UPSTREAM_UNAVAILABLE` — 5xx after the retry budget is
 *     exhausted. Treated as transient by the router; the sweeper
 *     retries on the next minute.
 *   - `NETWORK` — fetch threw (DNS, TLS, abort). Same treatment as
 *     `UPSTREAM_UNAVAILABLE`.
 */
export type PaperclipHttpErrorCode = 'VALIDATION' | 'IDEMPOTENCY_CONFLICT' | 'UPSTREAM_UNAVAILABLE' | 'NETWORK';
export declare class PaperclipHttpError extends Error {
    readonly code: PaperclipHttpErrorCode;
    readonly httpStatus?: number | undefined;
    readonly apiCode?: string | undefined;
    constructor(code: PaperclipHttpErrorCode, message: string, httpStatus?: number | undefined, apiCode?: string | undefined);
}
export declare class PaperclipHttpClient implements PaperclipClient {
    private readonly config;
    constructor(config: PaperclipHttpClientConfig);
    issue(args: {
        issueId: string;
        interaction: PaperclipInteraction;
    }): Promise<{
        interactionId: string;
    }>;
    reissue(args: {
        issueId: string;
        interaction: PaperclipInteraction;
        supersededInteractionId: string;
    }): Promise<{
        interactionId: string;
    }>;
    private postInteraction;
}

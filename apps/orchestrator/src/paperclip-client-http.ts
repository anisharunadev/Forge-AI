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
 * Wire shape we POST. Matches ADR-0008 §4 step 3 + the Paperclip
 * interactions endpoint. `targetIssueId` from the typed
 * `PaperclipInteraction` lives in the URL path; everything else is
 * in the body. `metadata` only appears on `reissue()`.
 */
interface InteractionRequestBody {
  kind: PaperclipInteraction['kind'];
  idempotencyKey: string;
  target: PaperclipInteraction['target'];
  continuationPolicy: PaperclipInteraction['continuationPolicy'];
  payload: PaperclipInteraction['payload'] & { version: 1 };
  metadata?: { superseded_interaction_id: string };
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
export type PaperclipHttpErrorCode =
  | 'VALIDATION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'NETWORK';

export class PaperclipHttpError extends Error {
  constructor(
    public readonly code: PaperclipHttpErrorCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly apiCode?: string,
  ) {
    super(message);
    this.name = 'PaperclipHttpError';
  }
}

interface ResolvedConfig {
  apiUrl: string;
  apiKey: string;
  runId: string;
  maxAttempts: number;
  backoffBaseMs: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export class PaperclipHttpClient implements PaperclipClient {
  private readonly config: ResolvedConfig;

  constructor(config: PaperclipHttpClientConfig) {
    if (!config.apiUrl) {
      throw new Error('PaperclipHttpClient: apiUrl is required');
    }
    if (!config.apiKey) {
      throw new Error('PaperclipHttpClient: apiKey is required');
    }
    if (!config.runId) {
      throw new Error('PaperclipHttpClient: runId is required');
    }
    this.config = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      runId: config.runId,
      maxAttempts: config.maxAttempts ?? 3,
      backoffBaseMs: config.backoffBaseMs ?? 250,
      fetchImpl: config.fetchImpl ?? globalThis.fetch.bind(globalThis),
      sleep: config.sleep ?? defaultSleep,
    };
  }

  async issue(args: {
    issueId: string;
    interaction: PaperclipInteraction;
  }): Promise<{ interactionId: string }> {
    return this.postInteraction(args.issueId, args.interaction, undefined);
  }

  async reissue(args: {
    issueId: string;
    interaction: PaperclipInteraction;
    supersededInteractionId: string;
  }): Promise<{ interactionId: string }> {
    return this.postInteraction(
      args.issueId,
      args.interaction,
      args.supersededInteractionId,
    );
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  private async postInteraction(
    issueId: string,
    interaction: PaperclipInteraction,
    supersededInteractionId: string | undefined,
  ): Promise<{ interactionId: string }> {
    const body: InteractionRequestBody = {
      kind: interaction.kind,
      idempotencyKey: interaction.idempotencyKey,
      target: interaction.target,
      continuationPolicy: interaction.continuationPolicy,
      payload: {
        ...interaction.payload,
        version: 1,
      },
      ...(supersededInteractionId !== undefined
        ? {
            metadata: {
              superseded_interaction_id: supersededInteractionId,
            },
          }
        : {}),
    };

    const url = joinUrl(this.config.apiUrl, `/api/issues/${issueId}/interactions`);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.config.apiKey}`,
      // ADR-0008 §4 step 4: every Paperclip call carries the run id so
      // the audit log can join a row back to the heartbeat that issued it.
      'x-paperclip-run-id': this.config.runId,
    };

    let lastError: PaperclipHttpError | undefined;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await this.config.fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch (e) {
        // Network-layer failure (DNS, TLS, abort). Retry until the
        // budget is exhausted; then surface as `NETWORK`.
        lastError = new PaperclipHttpError(
          'NETWORK',
          `Paperclip fetch failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        if (attempt < this.config.maxAttempts) {
          await this.config.sleep(this.config.backoffBaseMs * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }

      if (response.status >= 500) {
        // 5xx — transient. Retry with backoff.
        lastError = new PaperclipHttpError(
          'UPSTREAM_UNAVAILABLE',
          `Paperclip returned ${response.status}`,
          response.status,
        );
        if (attempt < this.config.maxAttempts) {
          await this.config.sleep(this.config.backoffBaseMs * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }

      if (response.status >= 400) {
        // 4xx — do NOT retry. Map the API's `code` if present.
        const apiEnvelope = await readErrorEnvelope(response);
        const apiCode = apiEnvelope?.error.code;
        const code: PaperclipHttpErrorCode =
          apiCode === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'VALIDATION';
        throw new PaperclipHttpError(
          code,
          `Paperclip returned ${response.status}: ${apiCode ?? 'no code'}`,
          response.status,
          apiCode,
        );
      }

      // 2xx — parse the body. The wire format is `{ data: { interactionId } }`.
      const json = (await response.json()) as unknown;
      const interactionId = extractInteractionId(json);
      if (!interactionId) {
        throw new PaperclipHttpError(
          'VALIDATION',
          `Paperclip returned 2xx without an interactionId: ${JSON.stringify(json)}`,
          response.status,
        );
      }
      return { interactionId };
    }

    // Unreachable, but the type system needs it.
    throw (
      lastError ??
      new PaperclipHttpError('UPSTREAM_UNAVAILABLE', 'Paperclip request failed')
    );
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmedBase}${path}`;
}

/**
 * Wire types matching the Paperclip REST API. Committed to a single
 * shape per response kind — no dual-shape probing.
 */
interface PaperclipEnvelope<T> {
  data: T;
}
interface PaperclipErrorEnvelope {
  error: { code: string; message: string };
}
interface PaperclipInteractionData {
  interactionId: string;
}

async function readErrorEnvelope(response: Response): Promise<PaperclipErrorEnvelope | null> {
  const json = (await response.json()) as Partial<PaperclipErrorEnvelope> | unknown;
  if (
    typeof json === 'object' &&
    json !== null &&
    'error' in json &&
    typeof (json as { error: unknown }).error === 'object' &&
    (json as { error: unknown }).error !== null &&
    typeof (json as { error: { code: unknown } }).error.code === 'string' &&
    typeof (json as { error: { message: unknown } }).error.message === 'string'
  ) {
    return json as PaperclipErrorEnvelope;
  }
  return null;
}

function extractInteractionId(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) {
    return undefined;
  }

  // 1. Real API format: { id: string, ... } or { interactionId: string, ... }
  const direct = json as { id?: unknown; interactionId?: unknown };
  if (typeof direct.id === 'string') {
    return direct.id;
  }
  if (typeof direct.interactionId === 'string') {
    return direct.interactionId;
  }

  // 2. Legacy/Mock format: { data: { interactionId: string } }
  const env = json as Partial<PaperclipEnvelope<PaperclipInteractionData>>;
  if (env?.data && typeof env.data.interactionId === 'string') {
    return env.data.interactionId;
  }

  return undefined;
}

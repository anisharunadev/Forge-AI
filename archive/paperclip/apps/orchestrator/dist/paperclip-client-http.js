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
export class PaperclipHttpError extends Error {
    code;
    httpStatus;
    apiCode;
    constructor(code, message, httpStatus, apiCode) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.apiCode = apiCode;
        this.name = 'PaperclipHttpError';
    }
}
export class PaperclipHttpClient {
    config;
    constructor(config) {
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
    async issue(args) {
        return this.postInteraction(args.issueId, args.interaction, undefined);
    }
    async reissue(args) {
        return this.postInteraction(args.issueId, args.interaction, args.supersededInteractionId);
    }
    // ---------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------
    async postInteraction(issueId, interaction, supersededInteractionId) {
        const body = {
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
        const headers = {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey}`,
            // ADR-0008 §4 step 4: every Paperclip call carries the run id so
            // the audit log can join a row back to the heartbeat that issued it.
            'x-paperclip-run-id': this.config.runId,
        };
        let lastError;
        for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
            let response;
            try {
                response = await this.config.fetchImpl(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });
            }
            catch (e) {
                // Network-layer failure (DNS, TLS, abort). Retry until the
                // budget is exhausted; then surface as `NETWORK`.
                lastError = new PaperclipHttpError('NETWORK', `Paperclip fetch failed: ${e instanceof Error ? e.message : String(e)}`);
                if (attempt < this.config.maxAttempts) {
                    await this.config.sleep(this.config.backoffBaseMs * 2 ** (attempt - 1));
                    continue;
                }
                throw lastError;
            }
            if (response.status >= 500) {
                // 5xx — transient. Retry with backoff.
                lastError = new PaperclipHttpError('UPSTREAM_UNAVAILABLE', `Paperclip returned ${response.status}`, response.status);
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
                const code = apiCode === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'VALIDATION';
                throw new PaperclipHttpError(code, `Paperclip returned ${response.status}: ${apiCode ?? 'no code'}`, response.status, apiCode);
            }
            // 2xx — parse the body. The wire format is `{ data: { interactionId } }`.
            const json = (await response.json());
            const interactionId = extractInteractionId(json);
            if (!interactionId) {
                throw new PaperclipHttpError('VALIDATION', `Paperclip returned 2xx without an interactionId: ${JSON.stringify(json)}`, response.status);
            }
            return { interactionId };
        }
        // Unreachable, but the type system needs it.
        throw (lastError ??
            new PaperclipHttpError('UPSTREAM_UNAVAILABLE', 'Paperclip request failed'));
    }
}
function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function joinUrl(base, path) {
    const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${trimmedBase}${path}`;
}
async function readErrorEnvelope(response) {
    const json = (await response.json());
    if (typeof json === 'object' &&
        json !== null &&
        'error' in json &&
        typeof json.error === 'object' &&
        json.error !== null &&
        typeof json.error.code === 'string' &&
        typeof json.error.message === 'string') {
        return json;
    }
    return null;
}
function extractInteractionId(json) {
    if (typeof json !== 'object' || json === null) {
        return undefined;
    }
    // 1. Real API format: { id: string, ... } or { interactionId: string, ... }
    const direct = json;
    if (typeof direct.id === 'string') {
        return direct.id;
    }
    if (typeof direct.interactionId === 'string') {
        return direct.interactionId;
    }
    // 2. Legacy/Mock format: { data: { interactionId: string } }
    const env = json;
    if (env?.data && typeof env.data.interactionId === 'string') {
        return env.data.interactionId;
    }
    return undefined;
}
//# sourceMappingURL=paperclip-client-http.js.map
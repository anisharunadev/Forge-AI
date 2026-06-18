/**
 * FORA-36 audit-sink forwarder for the secrets-mcp.
 *
 * Replaces the in-memory sink in production. Implements the
 * `AuditSink` contract from `./broker.ts` and POSTs each event to the
 * FORA-36 append-only event store at `{baseUrl}/v1/audit/events`.
 *
 * The POST shape follows ADR-0003 §8.1 and the identity-broker's
 * `ForaAuditSink` pattern (FORA-160). The secrets-mcp event is
 * translated:
 *
 *   SecretAuditEvent           FORA-36 envelope
 *   ──────────────             ────────────────
 *   tenant_id                  tenant_id
 *   actor                      actor
 *   agent_type        →        metadata.agent_type
 *   secret_ref                 metadata.secret_ref
 *   fingerprint       →        metadata.fingerprint  (allow only)
 *   value_len         →        metadata.value_len    (allow only)
 *   reason            →        metadata.reason       (deny only)
 *   action                      action
 *   decision                    decision
 *   trace_id                    trace_id
 *   timestamp                   timestamp
 *   metadata           →        metadata  (merged; secret fields above win on conflict)
 *                              principal = "agent"   (the secrets-mcp is invoked by an agent)
 *                              scopes_used = []      (the secrets-mcp does not consume IAM scopes)
 *
 * Important: the secrets-mcp `AuditSink.emit(...)` is `void` (synchronous),
 * unlike the identity-broker's `append(...)` which is `Promise<void>`.
 * The forwarder therefore fires the HTTP POST in the background and
 * never blocks the broker path. Failures (timeouts, 4xx, 5xx) are
 * logged to stderr so the audit forwarder is observable in operations
 * but never breaks a `resolve` / `rotate` call.
 *
 * The raw secret value is NEVER present in the envelope: the broker
 * only puts `fingerprint` and `value_len` on the event, never the
 * value. A defensive `assertNoCredentials` walks the serialised body
 * and refuses to POST if a credential-shaped substring is present —
 * this is the same guardrail used by the customer-cloud-broker
 * (FORA-126). The check is defence-in-depth, not the source of truth:
 * the broker's emit call must never carry a raw value.
 *
 * The fetch implementation is injectable so tests can assert post
 * shape and retry behaviour without binding to a real socket.
 */

import type { AuditSink, SecretAuditEvent } from "./broker.js";

/** Reused guardrail from the customer-cloud-broker
 *  (`apps/customer-cloud-broker/src/audit.ts::assertNoCredentials`).
 *  Tight regex — `Key` is allowed (S3 object key) but `AccessKeyId`
 *  is rejected. */
const CREDENTIAL_KEY_REGEX =
  /(access_?key|secret_?(access_?)?key|session_?token|x-amz-security-token|aws_?session|password|passphrase|client_?secret|refresh_?token|id_?token|private_?key|api_?key)/i;
/** AWS STS session credentials start with this prefix; AWS access key
 *  ids start with `AKIA`. Block both as a defence-in-depth check. */
const AWS_CREDENTIAL_REGEX = /(AKIA[0-9A-Z]{16}|FwoGZXIvYXdz[A-Za-z0-9/+=]+)/;

function assertNoCredentials(payload: string): void {
  if (CREDENTIAL_KEY_REGEX.test(payload)) {
    throw new Error(
      "ForaAuditSink: refusing to POST — payload contains a credential-shaped key",
    );
  }
  if (AWS_CREDENTIAL_REGEX.test(payload)) {
    throw new Error(
      "ForaAuditSink: refusing to POST — payload contains an AWS credential substring",
    );
  }
}

export interface ForaAuditSinkOptions {
  /** Base URL of the FORA-36 audit service. */
  baseUrl: string;
  /** Optional service-to-service bearer token. */
  token?: string | null;
  /** Test seam: replace fetch. */
  fetchImpl?: typeof fetch;
  /** Retry on 5xx / network errors. Default: 3 attempts. */
  maxAttempts?: number;
  /** Base backoff in ms (exponential). Default: 100. */
  baseBackoffMs?: number;
  /** Per-attempt timeout in ms. Default: 5000. */
  perAttemptTimeoutMs?: number;
}

export class ForaAuditSink implements AuditSink {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly perAttemptTimeoutMs: number;

  constructor(opts: ForaAuditSinkOptions) {
    if (!opts.baseUrl) {
      throw new Error("ForaAuditSink: baseUrl is required");
    }
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 100;
    this.perAttemptTimeoutMs = opts.perAttemptTimeoutMs ?? 5000;
  }

  /** Fire-and-forget POST. The broker's emit is synchronous; this
   *  implementation must not block or throw into the caller's
   *  resolve / rotate path. */
  emit(event: SecretAuditEvent): void {
    const envelope = this.toEnvelope(event);
    const body = JSON.stringify(envelope);
    // Defence in depth: refuse to POST if the body contains a
    // credential substring. This is the last line of defence — the
    // broker's emit call must never carry a raw value, but if a
    // future regression does, we drop the event rather than
    // exfiltrate it.
    try {
      assertNoCredentials(body);
    } catch (err) {
      this.logFailure("credential-shape-detected", event, err);
      return;
    }
    void this.postWithRetry(body, event);
  }

  /** Translate the secrets-mcp event into the FORA-36 envelope. */
  private toEnvelope(event: SecretAuditEvent): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      ...(event.metadata ?? {}),
      agent_type: event.agent_type,
      secret_ref: event.secret_ref,
    };
    if (event.fingerprint) metadata.fingerprint = event.fingerprint;
    if (event.value_len !== undefined) metadata.value_len = event.value_len;
    if (event.reason) metadata.reason = event.reason;
    return {
      actor: event.actor,
      tenant_id: event.tenant_id,
      principal: "agent",
      scopes_used: [],
      action: event.action,
      decision: event.decision,
      trace_id: event.trace_id,
      timestamp: event.timestamp,
      metadata,
    };
  }

  private async postWithRetry(
    body: string,
    original: SecretAuditEvent,
  ): Promise<void> {
    const url = `${this.baseUrl}/v1/audit/events`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.perAttemptTimeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status >= 200 && res.status < 300) return;
        if (res.status >= 400 && res.status < 500) {
          try { await res.text(); } catch { /* ignore */ }
          this.logFailure(`4xx-${res.status}`, original, new Error(`ForaAuditSink POST ${url} -> ${res.status}`));
          return;
        }
        lastErr = new Error(`ForaAuditSink POST ${url} -> ${res.status}`);
        try { await res.text(); } catch { /* ignore */ }
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (err instanceof Error && err.name === "AbortError") {
          lastErr = new Error(
            `ForaAuditSink POST ${url} timed out after ${this.perAttemptTimeoutMs}ms`,
          );
        }
      }
      if (attempt < this.maxAttempts) {
        const delay = this.baseBackoffMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
    this.logFailure(
      `retry-exhaust-${this.maxAttempts}`,
      original,
      lastErr instanceof Error ? lastErr : new Error(String(lastErr)),
    );
  }

  private logFailure(reason: string, event: SecretAuditEvent, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[fora-mcp-secrets] audit-forwarder ${reason} ` +
        `action=${event.action} tenant=${event.tenant_id} ` +
        `trace=${event.trace_id}: ${message}\n`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

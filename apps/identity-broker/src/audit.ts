/**
 * Audit sinks for the identity-broker.
 *
 * Per ADR-0003 §8.1, every identity event is appended. v1 ships a
 * `JsonlAuditSink` (file-system fallback) plus a `ForaAuditSink` that posts
 * to FORA-36's append-only event store (FORA-160). The broker picks the
 * sink at boot via `FORA_AUDIT_SINK=fora|jsonl`; the JSONL sink is always
 * the test default and the FORA-36 outage fallback.
 *
 * Required fields on every event (per ADR-0003 §8.1):
 *   actor, tenant_id, principal, action, scopes_used, decision, trace_id,
 *   timestamp.
 *
 * The append contract is preserved across both sinks: events are append-only,
 * carry every required field, and never mutate a previously written row.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type AuthAction =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.token.minted'
  | 'auth.session.revoked'
  // Agent IAM outcomes (FORA-125 / 0.7.3). The `iam.*` namespace is the
  // broker's policy outcome; the `auth.*` namespace is the session
  // lifecycle. Both share the same event shape (ADR-0003 §8.1).
  | 'iam.granted'
  | 'iam.denied'
  | 'iam.unbound_mcp';

export type Decision = 'allow' | 'deny';

export interface AuthAuditEvent {
  actor: string;
  tenant_id: string;
  principal: 'board_user' | 'agent' | 'cloud_operator';
  action: AuthAction;
  scopes_used: string[];
  decision: Decision;
  trace_id: string;
  timestamp: string;
  /** Optional structured metadata. */
  metadata?: Record<string, unknown>;
}

export interface AuditSink {
  append(event: AuthAuditEvent): Promise<void>;
  /** Tail the last N events for tests. */
  tail(n: number): Promise<AuthAuditEvent[]>;
  /** Close any open file handles. */
  close(): Promise<void>;
}

export class JsonlAuditSink implements AuditSink {
  private readonly path: string;
  private handle: import('node:fs/promises').FileHandle | null = null;
  private buffer: AuthAuditEvent[] = [];

  constructor(path: string) {
    this.path = path;
  }

  async append(event: AuthAuditEvent): Promise<void> {
    // Pre-condition: every required field is present. This is a P0 invariant.
    if (!event.actor) throw new Error('audit: actor required');
    if (!event.tenant_id) throw new Error('audit: tenant_id required');
    if (!event.principal) throw new Error('audit: principal required');
    if (!event.action) throw new Error('audit: action required');
    if (!Array.isArray(event.scopes_used)) throw new Error('audit: scopes_used required');
    if (!event.decision) throw new Error('audit: decision required');
    if (!event.trace_id) throw new Error('audit: trace_id required');
    if (!event.timestamp) throw new Error('audit: timestamp required');
    const line = JSON.stringify(event) + '\n';
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, line, 'utf-8');
    this.buffer.push(event);
  }

  async tail(n: number): Promise<AuthAuditEvent[]> {
    return this.buffer.slice(-n);
  }

  async close(): Promise<void> {
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
  }
}

/**
 * HTTP client sink for the FORA-36 append-only event store.
 *
 * Implements the `AuditSink` contract by POSTing each event to
 * `{baseUrl}/v1/audit/events` with a service-to-service bearer token. The
 * payload shape matches FORA-36's `append_event(...)` signature
 * (FORA-160, ADR-0003 §8.1):
 *
 *   { actor, tenant_id, principal, action, scopes_used, decision,
 *     trace_id, timestamp, metadata }
 *
 * Behaviour:
 *   - Retries 5xx and network errors with exponential backoff
 *     (3 attempts: 100ms, 200ms, 400ms).
 *   - Does NOT retry 4xx; a malformed event is a caller bug, not a
 *     transient failure, and FORA-36's validator is the source of truth.
 *   - Times out at 5s per attempt via AbortController.
 *   - Buffers the last 256 successful events in memory so `tail(n)` still
 *     works for tests against a network sink. The buffer is bounded so a
 *     long-running process does not grow without limit.
 *   - `close()` is a no-op (no open file handles; no in-flight queue).
 *
 * The fetch implementation is injectable so tests can assert post shape
 * and retry behaviour without binding to a real socket.
 */
export class ForaAuditSink implements AuditSink {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly perAttemptTimeoutMs: number;
  private readonly bufferSize: number;
  private buffer: AuthAuditEvent[] = [];

  constructor(opts: {
    baseUrl: string;
    token?: string | null;
    fetchImpl?: typeof fetch;
    maxAttempts?: number;
    baseBackoffMs?: number;
    perAttemptTimeoutMs?: number;
    bufferSize?: number;
  }) {
    if (!opts.baseUrl) throw new Error('audit: ForaAuditSink requires a baseUrl');
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 100;
    this.perAttemptTimeoutMs = opts.perAttemptTimeoutMs ?? 5000;
    this.bufferSize = opts.bufferSize ?? 256;
  }

  async append(event: AuthAuditEvent): Promise<void> {
    // Same pre-condition as JsonlAuditSink: every required field is present.
    if (!event.actor) throw new Error('audit: actor required');
    if (!event.tenant_id) throw new Error('audit: tenant_id required');
    if (!event.principal) throw new Error('audit: principal required');
    if (!event.action) throw new Error('audit: action required');
    if (!Array.isArray(event.scopes_used)) throw new Error('audit: scopes_used required');
    if (!event.decision) throw new Error('audit: decision required');
    if (!event.trace_id) throw new Error('audit: trace_id required');
    if (!event.timestamp) throw new Error('audit: timestamp required');

    const body = JSON.stringify({
      actor: event.actor,
      tenant_id: event.tenant_id,
      principal: event.principal,
      action: event.action,
      scopes_used: event.scopes_used,
      decision: event.decision,
      trace_id: event.trace_id,
      timestamp: event.timestamp,
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
    });
    const url = `${this.baseUrl}/v1/audit/events`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.perAttemptTimeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status >= 200 && res.status < 300) {
          this.pushBuffer(event);
          return;
        }
        // 4xx is a caller bug — do not retry.
        if (res.status >= 400 && res.status < 500) {
          // Drain the body to avoid a leaked socket; ignore the content.
          try {
            await res.text();
          } catch {
            // ignore
          }
          throw new Error(`audit: ForaAuditSink POST ${url} -> ${res.status}`);
        }
        // 5xx is transient — fall through to retry.
        lastErr = new Error(`audit: ForaAuditSink POST ${url} -> ${res.status}`);
        try {
          await res.text();
        } catch {
          // ignore
        }
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof Error && /ForaAuditSink POST/.test(err.message) && /-> 4\d\d/.test(err.message)) {
          throw err; // already-formatted 4xx error
        }
        lastErr = err;
        if (err instanceof Error && err.name === 'AbortError') {
          lastErr = new Error(`audit: ForaAuditSink POST ${url} timed out after ${this.perAttemptTimeoutMs}ms`);
        }
      }
      if (attempt < this.maxAttempts) {
        const delay = this.baseBackoffMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`audit: ForaAuditSink POST ${url} failed after ${this.maxAttempts} attempts`);
  }

  async tail(n: number): Promise<AuthAuditEvent[]> {
    return this.buffer.slice(-n);
  }

  async close(): Promise<void> {
    // No open file handles; nothing to flush. Intentionally a no-op so the
    // sink matches the JsonlAuditSink lifecycle shape.
  }

  private pushBuffer(event: AuthAuditEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) {
      this.buffer = this.buffer.slice(-this.bufferSize);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** In-memory sink for tests. */
export class InMemoryAuditSink implements AuditSink {
  private readonly events: AuthAuditEvent[] = [];
  async append(event: AuthAuditEvent): Promise<void> {
    this.events.push(event);
  }
  async tail(n: number): Promise<AuthAuditEvent[]> {
    return this.events.slice(-n);
  }
  async close(): Promise<void> {
    // no-op
  }
  all(): AuthAuditEvent[] {
    return [...this.events];
  }
}

/**
 * @fora/object-store — Audit emitter.
 *
 * Every adapter method that touches a cloud SDK must call `recordAudit`
 * (or `recordDenied` on a prefix violation) before returning. The default
 * emitter is a JSON-line `console.log`, but callers can swap it for a
 * structured logger (Datadog, Loki, the audit-log account) at construction
 * time.
 */

import type { TenancyDeniedEvent } from './context.js';

export type AuditEvent =
  | TenancyDeniedEvent
  | {
      event: 'tenancy.allowed';
      tenant_id: string;
      principal: 'board_user' | 'agent' | 'cloud_operator';
      trace_id: string;
      resource: 'object_store';
      operation: TenancyDeniedEvent['operation'];
      log_safe_key: string;
      ts: string;
    };

export type AuditSink = (event: AuditEvent) => void;

/** Default sink: JSON line to stdout. Swap in production. */
export const stdoutSink: AuditSink = (event) => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(event));
};

/** No-op sink for tests where audit noise is unwanted. */
export const silentSink: AuditSink = () => {};

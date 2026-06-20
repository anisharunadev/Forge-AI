/**
 * Cross-connector lifecycle events — FORA-484 AC #3.
 *
 * Sixteen verbs grouped into six concerns:
 *   - binding lifecycle  : binding.{created,rotated,revoked,overridden}
 *   - health probe       : health.checked
 *   - call boundaries    : call.{started,succeeded,failed}
 *   - rate-limit         : rate_limit.{consumed,throttled}
 *   - circuit breaker    : circuit.{opened,half_open,closed}
 *   - webhook            : webhook.{received,verified,rejected}
 *
 * These events are not family-scoped: every connector emits them.
 * The `connector_id` field discriminates. The helpers here build the
 * envelopes; the call sites are the binding registry, the breaker, and
 * the per-MCP wrappers.
 */

import type { ConnectorEvent, ConnectorFamily, Outcome } from './envelope.js';
import { digestOf, makeEventId } from './chain.js';
import type { ConnectorEventStore } from './store.js';

/** A standard actor for system-initiated lifecycle events. */
export const SYSTEM_ACTOR = {
  type: 'system' as const,
  id: 'system:connector-events',
  role: 'system',
};

/** Build the `request` shape for a lifecycle event. */
function buildRequest(op: string, args: unknown) {
  return { op, args_hash: digestOf(args ?? {}) };
}

/**
 * Emit `connector.binding.<verb>` for a binding lifecycle change.
 * `verb` ∈ {created, rotated, revoked, overridden}.
 */
export async function emitBindingLifecycle(input: {
  store: ConnectorEventStore;
  verb: 'created' | 'rotated' | 'revoked' | 'overridden';
  connector_id: ConnectorFamily;
  tenant_id: string;
  project_id: string;
  binding_id: string;
  outcome?: Outcome;
  reason_code?: string;
  args?: unknown;
  actor?: ConnectorEvent['actor'];
}): Promise<ConnectorEvent> {
  const event_type = `connector.binding.${input.verb}` as const;
  return input.store.append({
    event_id: makeEventId(),
    event_type,
    schema_version: '1.0.0',
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    connector_id: input.connector_id,
    binding_id: input.binding_id,
    actor: input.actor ?? SYSTEM_ACTOR,
    outcome: input.outcome ?? 'success',
    reason_code: input.reason_code ?? '',
    latency_ms: 0,
    request: buildRequest(`binding.${input.verb}`, input.args ?? {}),
    response: null,
    artifacts_emitted: [],
  });
}

/** Emit `connector.health.checked` — used by the per-connector liveness probe. */
export async function emitHealthChecked(input: {
  store: ConnectorEventStore;
  connector_id: ConnectorFamily;
  tenant_id: string;
  project_id: string;
  binding_id: string;
  ok: boolean;
  latency_ms: number;
  args?: unknown;
}): Promise<ConnectorEvent> {
  return input.store.append({
    event_id: makeEventId(),
    event_type: 'connector.health.checked',
    schema_version: '1.0.0',
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    connector_id: input.connector_id,
    binding_id: input.binding_id,
    actor: SYSTEM_ACTOR,
    outcome: input.ok ? 'success' : 'failure',
    reason_code: input.ok ? '' : 'health_check_failed',
    latency_ms: input.latency_ms,
    request: buildRequest('health.check', input.args ?? {}),
    response: null,
    artifacts_emitted: [],
  });
}

/** Emit `connector.rate_limit.consumed` for every throttled-call accounting tick. */
export async function emitRateLimit(input: {
  store: ConnectorEventStore;
  verb: 'consumed' | 'throttled';
  connector_id: ConnectorFamily;
  tenant_id: string;
  project_id: string;
  binding_id: string;
  tokens_remaining: number;
  bucket: string;
}): Promise<ConnectorEvent> {
  return input.store.append({
    event_id: makeEventId(),
    event_type: `connector.rate_limit.${input.verb}` as const,
    schema_version: '1.0.0',
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    connector_id: input.connector_id,
    binding_id: input.binding_id,
    actor: SYSTEM_ACTOR,
    outcome: input.verb === 'consumed' ? 'success' : 'denied',
    reason_code: input.verb === 'throttled' ? 'rate_limited' : '',
    latency_ms: 0,
    request: buildRequest('rate_limit.tick', { bucket: input.bucket, tokens_remaining: input.tokens_remaining }),
    response: null,
    artifacts_emitted: [],
  });
}

/** Emit `connector.circuit.<state>` for the breaker transitions. */
export async function emitCircuitTransition(input: {
  store: ConnectorEventStore;
  state: 'opened' | 'half_open' | 'closed';
  connector_id: ConnectorFamily;
  tenant_id: string;
  project_id: string;
  binding_id: string;
  reason_code?: string;
}): Promise<ConnectorEvent> {
  return input.store.append({
    event_id: makeEventId(),
    event_type: `connector.circuit.${input.state}` as const,
    schema_version: '1.0.0',
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    connector_id: input.connector_id,
    binding_id: input.binding_id,
    actor: SYSTEM_ACTOR,
    outcome: 'success',
    reason_code: input.reason_code ?? '',
    latency_ms: 0,
    request: buildRequest('circuit.transition', { state: input.state }),
    response: null,
    artifacts_emitted: [],
  });
}

/** Emit `connector.webhook.<verb>` for inbound webhook processing. */
export async function emitWebhook(input: {
  store: ConnectorEventStore;
  verb: 'received' | 'verified' | 'rejected';
  connector_id: ConnectorFamily;
  tenant_id: string;
  project_id: string;
  binding_id: string;
  reason_code?: string;
  args?: unknown;
}): Promise<ConnectorEvent> {
  return input.store.append({
    event_id: makeEventId(),
    event_type: `connector.webhook.${input.verb}` as const,
    schema_version: '1.0.0',
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    connector_id: input.connector_id,
    binding_id: input.binding_id,
    actor: SYSTEM_ACTOR,
    outcome: input.verb === 'rejected' ? 'denied' : 'success',
    reason_code: input.reason_code ?? '',
    latency_ms: 0,
    request: buildRequest(`webhook.${input.verb}`, input.args ?? {}),
    response: null,
    artifacts_emitted: [],
  });
}

/** All lifecycle verbs, exported for consumers that need to enumerate them. */
export const LIFECYCLE_VERBS = [
  'connector.binding.created',
  'connector.binding.rotated',
  'connector.binding.revoked',
  'connector.binding.overridden',
  'connector.health.checked',
  'connector.call.started',
  'connector.call.succeeded',
  'connector.call.failed',
  'connector.rate_limit.consumed',
  'connector.rate_limit.throttled',
  'connector.circuit.opened',
  'connector.circuit.half_open',
  'connector.circuit.closed',
  'connector.webhook.received',
  'connector.webhook.verified',
  'connector.webhook.rejected',
] as const;
export type LifecycleVerbList = (typeof LIFECYCLE_VERBS)[number];
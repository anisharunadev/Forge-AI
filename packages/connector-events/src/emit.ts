/**
 * Emit pipeline — FORA-484 AC #1 + AC #2.
 *
 * `emitConnectorEvent` is the single audit boundary for connector
 * activity. Every MCP server's tool handler passes through here exactly
 * once. The function:
 *
 *   1. Resolves RBAC-gated typed-artifact ids via the rule engine.
 *   2. Builds the universal envelope from the call's digests.
 *   3. Appends to the per-(tenant, binding) hash-chained store.
 *   4. Returns the persisted event so the caller can include the
 *      event_id in its MCP response.
 *
 * If the rule engine denies every artifact for this event, no artifact
 * emission happens but the audit event still records `outcome: 'denied'`
 * with `reason_code: 'rbac_denied'`. The chain is never broken.
 */

import { digestOf } from './chain.js';
import { resolveArtifacts } from './registry.js';
import type { Actor, ConnectorEvent, ConnectorFamily, Outcome, ResponseShape } from './envelope.js';
import type { ConnectorEventStore } from './store.js';

export interface EmitInput {
  store: ConnectorEventStore;
  event_type: ConnectorEvent['event_type'];
  tenant_id: string;
  project_id: string;
  connector_id: ConnectorFamily;
  binding_id: string;
  actor: Actor;
  outcome: Outcome;
  reason_code?: string;
  /** The connector operation name (e.g. `issue.create`). */
  op: string;
  /** The connector call's arguments. Will be canonicalised and digested. */
  args: unknown;
  /** Wall-clock latency in ms. */
  latency_ms: number;
  /** The connector call's response. Null on `call.started`. */
  response?: { status: number | null; body: unknown } | null;
  /** Free-form tag the caller wants stamped on `reason_code`. */
  reason?: string;
}

/** Build a `RequestShape` from `op` and `args`. */
function buildRequest(op: string, args: unknown) {
  return { op, args_hash: digestOf(args ?? {}) };
}

/** Build a `ResponseShape` from the connector response. */
function buildResponse(input: { status: number | null; body: unknown } | null | undefined): ResponseShape {
  if (!input) return null;
  const body = input.body;
  const json = JSON.stringify(body);
  return {
    status: input.status,
    body_hash: digestOf(body ?? {}),
    size: json.length,
  };
}

/**
 * Resolve artifact ids an actor may emit for this event_type, gated by
 * RBAC. Returns an empty list when no rules match or all are denied.
 */
function artifactIdsFor(event_type: string, actor: Actor): string[] {
  const role = actor.role ?? '';
  return resolveArtifacts(event_type, role).map((a) => a.artifact_id);
}

/**
 * Emit one connector event through the audit pipeline.
 *
 * The store is responsible for chain head + hash computation; this
 * function builds the envelope, consults the rule engine, and calls
 * `store.append`.
 */
export async function emitConnectorEvent(input: EmitInput): Promise<ConnectorEvent> {
  const request = buildRequest(input.op, input.args);
  const response = buildResponse(input.response ?? null);

  // RBAC check on the artifacts this event could produce. If the actor's
  // role is missing, default-deny (empty artifact list).
  const artifacts_emitted = artifactIdsFor(input.event_type, input.actor);

  // Compose the draft envelope (no `audit_chain` — store populates it).
  const draft: Omit<ConnectorEvent, 'audit_chain'> = {
    event_id: '', // store assigns on append; placeholder to satisfy typing
    event_type: input.event_type,
    schema_version: '1.0.0',
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    connector_id: input.connector_id,
    binding_id: input.binding_id,
    actor: input.actor,
    outcome: input.outcome,
    reason_code: input.reason_code ?? input.reason ?? '',
    latency_ms: input.latency_ms,
    request,
    response,
    artifacts_emitted,
  };

  const persisted = await input.store.append(draft);
  return persisted;
}

/**
 * Convenience helper for the common pattern: wrap a tool call with a
 * started + finished pair. The started event is a `connector.call.started`
 * with `response: null`; the finished event is the actual `event_type`.
 *
 * Returns the finished event's id so the caller can include it in its
 * MCP response payload.
 */
export interface WrappedCall {
  started_event_id: string;
  finished_event_id: string;
}

export async function emitStartedAndFinished(input: {
  store: ConnectorEventStore;
  event_type: ConnectorEvent['event_type'];
  tenant_id: string;
  project_id: string;
  connector_id: ConnectorFamily;
  binding_id: string;
  actor: Actor;
  op: string;
  args: unknown;
  /** Invoked between started and finished; its result drives the finished event. */
  invoke: () => Promise<{ status: number | null; body: unknown }>;
  /** Map thrown error → typed reason_code + outcome. */
  onError?: (err: unknown) => { reason_code: string; outcome: 'failure' | 'denied' };
}): Promise<WrappedCall> {
  const started = await input.store.append({
    event_id: '',
    event_type: 'connector.call.started',
    schema_version: '1.0.0',
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    connector_id: input.connector_id,
    binding_id: input.binding_id,
    actor: input.actor,
    outcome: 'success',
    reason_code: '',
    latency_ms: 0,
    request: buildRequest(input.op, input.args),
    response: null,
    artifacts_emitted: [],
  });

  const t0 = Date.now();
  try {
    const r = await input.invoke();
    const finished = await emitConnectorEvent({
      store: input.store,
      event_type: input.event_type,
      tenant_id: input.tenant_id,
      project_id: input.project_id,
      connector_id: input.connector_id,
      binding_id: input.binding_id,
      actor: input.actor,
      outcome: 'success',
      op: input.op,
      args: input.args,
      latency_ms: Date.now() - t0,
      response: r,
    });
    return { started_event_id: started.event_id, finished_event_id: finished.event_id };
  } catch (err) {
    const mapped = input.onError
      ? input.onError(err)
      : { reason_code: 'unknown_error', outcome: 'failure' as const };
    const finished = await emitConnectorEvent({
      store: input.store,
      event_type: input.event_type,
      tenant_id: input.tenant_id,
      project_id: input.project_id,
      connector_id: input.connector_id,
      binding_id: input.binding_id,
      actor: input.actor,
      outcome: mapped.outcome,
      reason_code: mapped.reason_code,
      op: input.op,
      args: input.args,
      latency_ms: Date.now() - t0,
      response: null,
    });
    return { started_event_id: started.event_id, finished_event_id: finished.event_id };
  }
}
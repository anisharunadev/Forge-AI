/**
 * Fastify server for the customer-cloud-broker (FORA-126 / 0.7.4).
 *
 * Routes:
 *   POST /broker/action       Broker a single ToolCall envelope
 *   POST /broker/probe        Re-probe a tenant's cloud trust
 *   POST /credentials/resolve Per-(tenant, server) credential material
 *                             (FORA-48 §3.5 / FORA-448 — scope guard)
 *   GET  /healthz             Liveness
 *   GET  /readyz              Readiness (deny-list + trust store + audit sink healthy)
 *   GET  /metrics             Prometheus text exposition
 *
 * The broker is intentionally a *separate* service from the
 * identity-broker. Killing this broker halts all cloud-brokered
 * actions; the platform (and the identity-broker) keeps running —
 * the FORA-126 acceptance bar #5.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AwsActionArgsSchema,
  AzureActionArgsSchema,
  GcpActionArgsSchema,
  SonarQubeActionArgsSchema,
  type BrokeredRequest,
  type Cloud,
} from './types.js';
import { brokerAction, type BrokerDeps } from './broker.js';
import type { BrokerConfig } from './config.js';

export interface BuildServerDeps extends BrokerDeps {
  config: BrokerConfig;
}

// ---------------------------------------------------------------------------
// Request schemas. The action args are a discriminated union on `cloud`.
// ---------------------------------------------------------------------------

const ActionArgsSchema = z.discriminatedUnion('cloud', [
  AwsActionArgsSchema,
  AzureActionArgsSchema,
  GcpActionArgsSchema,
  SonarQubeActionArgsSchema,
]);

const BrokeredRequestSchema = z
  .object({
    trace_id: z.string().min(1),
    tenant_id: z.string().min(1),
    principal: z.literal('agent'),
    agent_type: z.string().min(1),
    mcp: z.literal('customer-cloud-broker'),
    action: z.string().min(1),
    args: ActionArgsSchema,
    scopes_used: z.array(z.string()),
    deadline_ms: z.number().int().positive().optional(),
  })
  .strict();

const ProbeRequestSchema = z
  .object({
    tenant_id: z.string().min(1),
    cloud: z.enum(['aws', 'azure', 'gcp', 'sonarqube']),
  })
  .strict();

export async function buildServer(deps: BuildServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.env !== 'test' });
  // Capture raw body for audit-log signing in the future.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      e.statusCode = 400;
      done(e, undefined);
    }
  });

  app.get('/healthz', async () => ({ ok: true, service: 'customer-cloud-broker' }));

  app.get('/readyz', async () => {
    // v1 always reports ready; a real readiness probe would check
    // the deny-list load, trust store load, and audit sink health.
    return { ok: true };
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return deps.metrics.render();
  });

  app.post('/broker/action', async (req, reply) => {
    const parsed = BrokeredRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'malformed_request', detail: parsed.error.flatten() };
    }
    const request: BrokeredRequest = parsed.data;
    // Map the parsed `args` back to the right concrete type. The
    // discriminated union narrows correctly inside the dispatcher.
    const result = await brokerAction(request, deps);
    // Map `deny_listed_action` / `cloud_disabled` to HTTP 403 per the
    // FORA-126 acceptance bar; everything else is 200 so the agent
    // sees a uniform response envelope.
    const httpStatus = result.response_code === 'ok' ? 200 : 403;
    reply.code(httpStatus);
    return result;
  });

  app.post('/broker/probe', async (req, reply) => {
    const parsed = ProbeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'malformed_request', detail: parsed.error.flatten() };
    }
    const trust = deps.trust_store.get(parsed.data.tenant_id, parsed.data.cloud as Cloud);
    if (!trust) {
      reply.code(404);
      return { error: 'no_trust_record', tenant_id: parsed.data.tenant_id, cloud: parsed.data.cloud };
    }
    // v1 returns the trust record directly; the canary assume lands
    // in FORA-126.4.
    return trust;
  });

  // ---- /credentials/resolve (FORA-48 §3.5 / FORA-448) ------------------
  //
  // Per-tenant scope-guard chokepoint for the mcp-router. The router calls
  // this after the identity-broker validates the tenant and before the
  // upstream MCP process is spawned. We mint the per-(tenant, server)
  // credential material the transport will hand to the MCP server. The
  // credential is opaque to the router; the transport reads it from
  // `ctx.credential` and forwards it upstream.
  //
  // v1 mints a stub `{kind: 'stub', server_name, tenant_id, issued_at_ms,
  // expires_at_ms}` with a 5-minute TTL. The contract for the response
  // shape is the broker's; a future ADR lands the real federation token.
  // The stub is enough to prove the wire path and AC #3.
  //
  // Failure modes:
  //   - tenant has no trust record on any cloud → `{ok:false, reason:
  //     'cloud_disabled'}` (HTTP 200, so the router can shape it as
  //     `credential_denied`).
  //   - trust record exists but is in a non-active state → same shape.
  //   - malformed body → 400 (treated by the adapter as
  //     `client_error_400`).
  //
  // The route does NOT emit a `cloud.brokered` audit event (that contract
  // is for /broker/action). It emits nothing for v1; a future follow-up
  // adds a `credential.minted` event for observability.
  const CredentialsResolveSchema = z
    .object({
      tenant_id: z.string().min(1),
      server_name: z.string().min(1),
      trace_id: z.string().min(1).optional(),
    })
    .strict();
  const CREDENTIAL_TTL_MS = 5 * 60 * 1000;
  app.post<{ Body: unknown }>('/credentials/resolve', async (req, reply) => {
    const parsed = CredentialsResolveSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, reason: 'malformed_request' };
    }
    const { tenant_id, server_name } = parsed.data;
    // The trust store is keyed by (tenant, cloud). A scope-guard call
    // doesn't carry a cloud discriminator; the v1 contract is "the tenant
    // must have at least one active trust record". If none, deny.
    const clouds: readonly Cloud[] = ['aws', 'azure', 'gcp', 'sonarqube'];
    const active = clouds
      .map((c) => deps.trust_store.get(tenant_id, c))
      .find((t) => t && t.trust_state === 'active');
    if (!active) {
      return reply.send({
        ok: false,
        reason: 'cloud_disabled',
        tenant_id,
        server_name,
      });
    }
    const issued_at_ms = Date.now();
    return reply.send({
      ok: true,
      tenant_id,
      server_name,
      credential: {
        kind: 'stub',
        server_name,
        tenant_id,
        issued_at_ms,
        expires_at_ms: issued_at_ms + CREDENTIAL_TTL_MS,
        role_fingerprint: active.role_ref,
      },
    });
  });

  return app;
}

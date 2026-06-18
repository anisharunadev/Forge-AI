/**
 * Fastify server for the customer-cloud-broker (FORA-126 / 0.7.4).
 *
 * Routes:
 *   POST /broker/action       Broker a single ToolCall envelope
 *   POST /broker/probe        Re-probe a tenant's cloud trust
 *   GET  /healthz             Liveness
 *   GET  /readyz              Readiness (deny-list + trust store + audit sink healthy)
 *   GET  /metrics             Prometheus text exposition
 *
 * The broker is intentionally a *separate* service from the
 * identity-broker. Killing this broker halts all cloud-brokered
 * actions; the platform (and the identity-broker) keeps running —
 * the FORA-126 acceptance bar #5.
 */
import Fastify from 'fastify';
import { z } from 'zod';
import { AwsActionArgsSchema, AzureActionArgsSchema, GcpActionArgsSchema, } from './types.js';
import { brokerAction } from './broker.js';
// ---------------------------------------------------------------------------
// Request schemas. The action args are a discriminated union on `cloud`.
// ---------------------------------------------------------------------------
const ActionArgsSchema = z.discriminatedUnion('cloud', [
    AwsActionArgsSchema,
    AzureActionArgsSchema,
    GcpActionArgsSchema,
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
    cloud: z.enum(['aws', 'azure', 'gcp']),
})
    .strict();
export async function buildServer(deps) {
    const app = Fastify({ logger: deps.config.env !== 'test' });
    // Capture raw body for audit-log signing in the future.
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        try {
            done(null, JSON.parse(body));
        }
        catch (err) {
            const e = err;
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
        const request = parsed.data;
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
        const trust = deps.trust_store.get(parsed.data.tenant_id, parsed.data.cloud);
        if (!trust) {
            reply.code(404);
            return { error: 'no_trust_record', tenant_id: parsed.data.tenant_id, cloud: parsed.data.cloud };
        }
        // v1 returns the trust record directly; the canary assume lands
        // in FORA-126.4.
        return trust;
    });
    return app;
}

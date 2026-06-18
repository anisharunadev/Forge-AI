/**
 * Orchestrator Fastify server — the six FORA-50 §4.1 endpoints.
 *
 *   POST /v1/runs                create
 *   GET  /v1/runs/{id}           read header + current stage
 *   GET  /v1/runs/{id}/stages    list seven stage rows
 *   POST /v1/runs/{id}/pause     operator pause
 *   POST /v1/runs/{id}/resume    operator resume
 *   POST /v1/runs/{id}/cancel    operator cancel
 *   GET  /healthz                liveness
 *
 * The four mutating endpoints require an `Idempotency-Key` header (UUID
 * v4 per FORA-50 rev 2). All writes go through `repo.ts` which carries
 * the soft-delete invariant. The error envelope matches FORA-50 §4.1:
 *
 *   { "error": { "code": "INVALID_TRANSITION", "message": "...", "request_id": "..." } }
 *
 * Auth model: the Orchestrator trusts the upstream gateway to have
 * verified the JWT and stamped `x-fora-tenant-id` on the request.
 * ADR-0003 §4.2 binds the db-pool to the verified claim; a v1.1 ADR
 * moves JWT validation in-process.
 */
import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { lookupIdempotency, parseIdempotencyKey, recordIdempotency, ValidationError, fingerprint, } from './idempotency.js';
import { createRun, findRunById, listStages, transitionRunStatus, } from './repo.js';
import { canTransition, isTerminal, nextStatus } from './state-machine.js';
import { asRunId, STAGES_IN_ORDER, } from './types.js';
import { decide, ApprovalAlreadyDecidedError, RouterError, } from './index.js';
/**
 * zod schemas for request bodies. The schemas are the public input
 * contract; the handler maps each to the typed shapes in types.ts.
 */
const createRunBody = z.object({
    goal_id: z.string().min(1),
    project_id: z.string().min(1),
    triggered_by: z.object({
        type: z.enum(['manual', 'slack', 'email', 'schedule', 'api']),
        actor: z.string().min(1),
        payload_ref: z.string().optional(),
    }),
    cost_ceiling_usd: z
        .string()
        .regex(/^\d{1,8}(\.\d{1,2})?$/, 'cost_ceiling_usd must be a numeric string')
        .optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const decideParams = z.object({
    id: z.string().uuid(),
    approvalId: z.string().min(1),
});
const returnParams = z.object({
    id: z.string().uuid(),
    stage: z.enum(STAGES_IN_ORDER),
});
const decideBody = z.object({
    decision: z.enum(['accept', 'reject', 'request_changes']),
    reason: z.string().min(1),
    decided_by: z.object({
        actor: z.string().min(1),
        role: z.string().min(1), // RoleOfRecord | 'board'
    }),
    return_to: z
        .object({
        to_stage: z.enum(STAGES_IN_ORDER),
        required_role: z.string().min(1),
    })
        .optional(),
    advance_to: z.enum([...STAGES_IN_ORDER, 'done']).optional(),
});
const returnBody = z.object({
    to_stage: z.enum(STAGES_IN_ORDER),
    reason: z.string().min(1),
});
/**
 * The shared header that authenticates a request to a tenant. In
 * production this is `x-fora-tenant-id` set by the gateway after JWT
 * verification (ADR-0003 §4.2). The test seam injects a deterministic
 * tenant without going through the gateway.
 */
const TENANT_HEADER = 'x-fora-tenant-id';
const IDEMPOTENCY_HEADER = 'idempotency-key';
const REQUEST_ID_HEADER = 'x-request-id';
export async function buildServer(deps) {
    const app = Fastify({
        logger: deps.config.env !== 'test'
            ? { level: deps.config.logLevel }
            : false,
        // Trust the gateway; do not enforce client IPs.
        trustProxy: true,
    });
    const now = deps.now ?? (() => Date.now());
    // --- Default tenant extractor (production) ----------------------------
    const extractTenant = deps.extractTenant ?? defaultExtractTenant;
    // --- Global error handler ---------------------------------------------
    // Maps the typed errors thrown by `requireTenant` /
    // `requireIdempotencyKey` to the right HTTP status + envelope. The
    // handler-level early returns handle the happy validation paths; this
    // setErrorHandler is the safety net for any code path that forgets to
    // gate the call site.
    app.setErrorHandler((err, req, reply) => {
        const requestId = headerString(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
        if (err instanceof AuthError) {
            void errorEnvelope(reply, 401, 'VALIDATION', err.message, requestId);
            return;
        }
        if (err instanceof ValidationErrorWithId) {
            void errorEnvelope(reply, 400, 'VALIDATION', err.message, requestId);
            return;
        }
        app.log.error({ err, request_id: requestId }, 'unhandled error');
        void errorEnvelope(reply, 500, 'INTERNAL', err instanceof Error ? err.message : 'unknown error', requestId);
    });
    // --- /healthz --------------------------------------------------------
    app.get('/healthz', async () => ({
        ok: true,
        service: 'orchestrator',
        version: '0.1.0',
        at: new Date(now()).toISOString(),
    }));
    // --- POST /v1/runs (create) ------------------------------------------
    app.post('/v1/runs', async (req, reply) => {
        const requestId = headerString(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
        const tenantId = requireTenant(extractTenant(req), requestId);
        const idemKey = requireIdempotencyKey(headerString(req.headers[IDEMPOTENCY_HEADER]), requestId);
        const parsed = createRunBody.safeParse(req.body);
        if (!parsed.success) {
            return errorEnvelope(reply, 400, 'VALIDATION', parsed.error.message, requestId);
        }
        const body = {
            goal_id: parsed.data.goal_id,
            project_id: parsed.data.project_id,
            triggered_by: {
                type: parsed.data.triggered_by.type,
                actor: parsed.data.triggered_by.actor,
                ...(parsed.data.triggered_by.payload_ref !== undefined
                    ? { payload_ref: parsed.data.triggered_by.payload_ref }
                    : {}),
            },
            ...(parsed.data.cost_ceiling_usd !== undefined
                ? { cost_ceiling_usd: parsed.data.cost_ceiling_usd }
                : {}),
        };
        // Replay path — same key + same body returns the cached response.
        const fp = fingerprint(body);
        const lookup = await lookupIdempotency(deps.pool, tenantId, idemKey, body);
        if (lookup.kind === 'conflict') {
            return errorEnvelope(reply, 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused with a different request body', requestId);
        }
        if (lookup.kind === 'replay') {
            reply.header('idempotent-replay', 'true');
            return reply
                .status(lookup.record.response_status)
                .send(lookup.record.response_body);
        }
        // First call — execute the handler and persist the response.
        // Both the run insert (createRun) and the idempotency record
        // (recordIdempotency) share this single transaction; either both
        // commit or both roll back. Without this, a crash between the
        // inner COMMIT and the outer COMMIT would leave an orphan run
        // with no idempotency record — a retry would then create a
        // second run, violating FORA-134 acceptance #3.
        const client = await deps.pool.connect();
        let run;
        try {
            await client.query('BEGIN');
            run = await createRun(deps.pool, tenantId, body, deps.config.defaultCostCeilingUsd, client);
            await recordIdempotency(client, {
                key: idemKey,
                tenantId,
                runId: run.id,
                fingerprintHex: fp,
                responseStatus: 201,
                responseBody: run,
            });
            await client.query('COMMIT');
        }
        catch (e) {
            try {
                await client.query('ROLLBACK');
            }
            catch {
                // best-effort
            }
            return errorEnvelope(reply, 500, 'INTERNAL', e instanceof Error ? e.message : 'createRun failed', requestId);
        }
        finally {
            client.release();
        }
        return reply.status(201).send(run);
    });
    // --- GET /v1/runs/{id} -----------------------------------------------
    app.get('/v1/runs/:id', async (req, reply) => {
        const requestId = headerString(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
        const tenantId = requireTenant(extractTenant(req), requestId);
        const parsed = idParam.safeParse(req.params);
        if (!parsed.success) {
            return errorEnvelope(reply, 400, 'VALIDATION', 'invalid run id', requestId);
        }
        const run = await findRunById(deps.pool, tenantId, asRunId(parsed.data.id));
        if (!run) {
            return errorEnvelope(reply, 404, 'NOT_FOUND', 'run not found', requestId);
        }
        return reply.status(200).send(run);
    });
    // --- GET /v1/runs/{id}/stages ----------------------------------------
    app.get('/v1/runs/:id/stages', async (req, reply) => {
        const requestId = headerString(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
        const tenantId = requireTenant(extractTenant(req), requestId);
        const parsed = idParam.safeParse(req.params);
        if (!parsed.success) {
            return errorEnvelope(reply, 400, 'VALIDATION', 'invalid run id', requestId);
        }
        const stages = await listStages(deps.pool, tenantId, asRunId(parsed.data.id));
        if (stages === null) {
            return errorEnvelope(reply, 404, 'NOT_FOUND', 'run not found', requestId);
        }
        return reply.status(200).send({ stages });
    });
    // --- POST /v1/runs/{id}/{verb} ----------------------------------------
    // Single registration for the three lifecycle verbs (pause / resume
    // / cancel) — they share the same body shape and the same idempotency
    // contract; only the verb-specific state-machine lookup differs.
    for (const verb of ['pause', 'resume', 'cancel']) {
        app.post(`/v1/runs/:id/${verb}`, async (req, reply) => {
            const requestId = headerString(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
            const tenantId = requireTenant(extractTenant(req), requestId);
            const idemKey = requireIdempotencyKey(headerString(req.headers[IDEMPOTENCY_HEADER]), requestId);
            const parsed = idParam.safeParse(req.params);
            if (!parsed.success) {
                return errorEnvelope(reply, 400, 'VALIDATION', 'invalid run id', requestId);
            }
            // The idempotency fingerprint for verbs is the canonical tuple
            // (verb, runId) — the body is empty for these endpoints, so the
            // fingerprint is over the URL path + verb. A POST /pause with
            // the same key but a different run id is a conflict.
            const fp = fingerprint({ verb, run_id: parsed.data.id });
            const lookup = await lookupIdempotency(deps.pool, tenantId, idemKey, { verb, run_id: parsed.data.id });
            if (lookup.kind === 'conflict') {
                return errorEnvelope(reply, 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused with a different request', requestId);
            }
            if (lookup.kind === 'replay') {
                reply.header('idempotent-replay', 'true');
                return reply
                    .status(lookup.record.response_status)
                    .send(lookup.record.response_body);
            }
            // Load the run to check the current status. The lifecycle guard
            // (`canTransition`) rejects verbs that are not valid for the
            // current status; we surface the failure as 409 INVALID_TRANSITION.
            const run = await findRunById(deps.pool, tenantId, asRunId(parsed.data.id));
            if (!run) {
                return errorEnvelope(reply, 404, 'NOT_FOUND', 'run not found', requestId);
            }
            if (isTerminal(run.status)) {
                return errorEnvelope(reply, 409, 'INVALID_TRANSITION', `run is in terminal status "${run.status}"; verb "${verb}" is not allowed`, requestId);
            }
            if (!canTransition(verb, run.status)) {
                return errorEnvelope(reply, 409, 'INVALID_TRANSITION', `verb "${verb}" is not allowed from status "${run.status}"`, requestId);
            }
            const next = nextStatus(verb, run.status);
            // The state change and the idempotency record share one
            // transaction: transitionRunStatus runs on `client` and
            // recordIdempotency writes on the same connection. A crash
            // between the two writes no longer leaves an orphan state
            // change — both rollback together, and a retry with the same
            // key sees the prior (unchanged) run and either replays the
            // state change (if the row hadn't moved yet) or returns the
            // cached response (if it had). Without this, a retry would
            // see `run.status` already at `next`, fail canTransition, and
            // return a confusing 409 instead of the cached replay.
            const client = await deps.pool.connect();
            let updated;
            try {
                await client.query('BEGIN');
                // Atomic transition: UPDATE ... WHERE status = expected.
                // A race (operator pause + operator cancel in parallel)
                // loses to the first writer; the loser sees 0 rows updated
                // and returns 409.
                const result = await transitionRunStatus(deps.pool, tenantId, run.id, run.status, next, client);
                if (!result) {
                    await client.query('ROLLBACK');
                    return errorEnvelope(reply, 409, 'INVALID_TRANSITION', `run status changed concurrently; expected "${run.status}", re-read and retry`, requestId);
                }
                await recordIdempotency(client, {
                    key: idemKey,
                    tenantId,
                    runId: result.id,
                    fingerprintHex: fp,
                    responseStatus: 200,
                    responseBody: result,
                });
                await client.query('COMMIT');
                updated = result;
            }
            catch (e) {
                try {
                    await client.query('ROLLBACK');
                }
                catch {
                    // best-effort
                }
                return errorEnvelope(reply, 500, 'INTERNAL', e instanceof Error ? e.message : `${verb} failed`, requestId);
            }
            finally {
                client.release();
            }
            return reply.status(200).send(updated);
        });
    }
    // --- POST /v1/runs/{id}/approvals/{approvalId}/decide ----------------
    app.post('/v1/runs/:id/approvals/:approvalId/decide', async (req, reply) => {
        const requestId = headerString(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
        const tenantId = requireTenant(extractTenant(req), requestId);
        const idemKey = requireIdempotencyKey(headerString(req.headers[IDEMPOTENCY_HEADER]), requestId);
        const params = decideParams.safeParse(req.params);
        if (!params.success) {
            return errorEnvelope(reply, 400, 'VALIDATION', 'invalid params', requestId);
        }
        const body = decideBody.safeParse(req.body);
        if (!body.success) {
            return errorEnvelope(reply, 400, 'VALIDATION', body.error.message, requestId);
        }
        // Idempotency fingerprint: decide triple (approvalId, decision, reason).
        // The router does its own replay logic in router.ts, but the HTTP
        // layer owns the request-level idempotency record.
        const fp = fingerprint(body.data);
        const lookup = await lookupIdempotency(deps.pool, tenantId, idemKey, body.data);
        if (lookup.kind === 'conflict') {
            return errorEnvelope(reply, 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused with a different request body', requestId);
        }
        if (lookup.kind === 'replay') {
            reply.header('idempotent-replay', 'true');
            return reply
                .status(lookup.record.response_status)
                .send(lookup.record.response_body);
        }
        try {
            const outcome = await decide(deps.approvals, {
                approvalId: params.data.approvalId,
                tenantId,
                decision: body.data.decision,
                reason: body.data.reason,
                decidedBy: {
                    actor: body.data.decided_by.actor,
                    role: body.data.decided_by.role,
                },
                returnTo: body.data.return_to
                    ? {
                        toStage: body.data.return_to.to_stage,
                        requiredRole: body.data.return_to.required_role,
                    }
                    : undefined,
                advanceTo: body.data.advance_to,
                idempotencyKey: idemKey,
            });
            // Persist for replay.
            const client = await deps.pool.connect();
            try {
                await recordIdempotency(client, {
                    key: idemKey,
                    tenantId,
                    runId: asRunId(params.data.id),
                    fingerprintHex: fp,
                    responseStatus: 200,
                    responseBody: outcome,
                });
            }
            finally {
                client.release();
            }
            return reply.status(200).send(outcome);
        }
        catch (e) {
            if (e instanceof ApprovalAlreadyDecidedError) {
                return errorEnvelope(reply, 409, 'INVALID_TRANSITION', e.message, requestId);
            }
            if (e instanceof RouterError) {
                const status = e.code === 'APPROVAL_NOT_FOUND' ? 404 : 400;
                const code = e.code === 'APPROVAL_NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION';
                return errorEnvelope(reply, status, code, e.message, requestId);
            }
            throw e;
        }
    });
    // --- POST /v1/runs/{id}/stages/{stage}/return -----------------------
    app.post('/v1/runs/:id/stages/:stage/return', async (req, reply) => {
        const requestId = headerString(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
        const tenantId = requireTenant(extractTenant(req), requestId);
        const idemKey = requireIdempotencyKey(headerString(req.headers[IDEMPOTENCY_HEADER]), requestId);
        const params = returnParams.safeParse(req.params);
        if (!params.success) {
            return errorEnvelope(reply, 400, 'VALIDATION', 'invalid params', requestId);
        }
        const body = returnBody.safeParse(req.body);
        if (!body.success) {
            return errorEnvelope(reply, 400, 'VALIDATION', body.error.message, requestId);
        }
        const fp = fingerprint(body.data);
        const lookup = await lookupIdempotency(deps.pool, tenantId, idemKey, body.data);
        if (lookup.kind === 'conflict') {
            return errorEnvelope(reply, 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused with a different request body', requestId);
        }
        if (lookup.kind === 'replay') {
            reply.header('idempotent-replay', 'true');
            return reply
                .status(lookup.record.response_status)
                .send(lookup.record.response_body);
        }
        // Resolve the pending approval for this stage.
        const approval = await deps.approvals.repo.findPendingByStage({
            runId: asRunId(params.data.id),
            stage: params.data.stage,
            tenantId,
        });
        if (!approval) {
            return errorEnvelope(reply, 404, 'NOT_FOUND', `no pending approval found for stage ${params.data.stage}`, requestId);
        }
        try {
            const outcome = await decide(deps.approvals, {
                approvalId: approval.id,
                tenantId,
                decision: 'request_changes',
                reason: body.data.reason,
                decidedBy: { actor: 'operator', role: 'board' },
                returnTo: {
                    toStage: body.data.to_stage,
                    requiredRole: approval.required_role, // return to the same role that requested it?
                },
                idempotencyKey: idemKey,
            });
            // Persist for replay.
            const client = await deps.pool.connect();
            try {
                await recordIdempotency(client, {
                    key: idemKey,
                    tenantId,
                    runId: asRunId(params.data.id),
                    fingerprintHex: fp,
                    responseStatus: 200,
                    responseBody: outcome,
                });
            }
            finally {
                client.release();
            }
            return reply.status(200).send(outcome);
        }
        catch (e) {
            if (e instanceof ApprovalAlreadyDecidedError) {
                return errorEnvelope(reply, 409, 'INVALID_TRANSITION', e.message, requestId);
            }
            if (e instanceof RouterError) {
                const status = e.code === 'APPROVAL_NOT_FOUND' ? 404 : 400;
                const code = e.code === 'APPROVAL_NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION';
                return errorEnvelope(reply, status, code, e.message, requestId);
            }
            throw e;
        }
    });
    return app;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function headerString(v) {
    if (typeof v === 'string')
        return v;
    if (Array.isArray(v) && typeof v[0] === 'string')
        return v[0];
    return undefined;
}
function defaultExtractTenant(req) {
    const v = req.headers[TENANT_HEADER];
    if (typeof v !== 'string')
        return null;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
}
function requireTenant(value, requestId) {
    if (!value) {
        // The handler will map this to a 401 via errorEnvelope on the
        // caller side; we throw a typed error to keep the call sites
        // short.
        throw new AuthError(`missing ${TENANT_HEADER} header`, requestId);
    }
    return value;
}
function requireIdempotencyKey(value, requestId) {
    try {
        return parseIdempotencyKey(value);
    }
    catch (e) {
        if (e instanceof ValidationError) {
            throw new ValidationErrorWithId(e.message, requestId);
        }
        throw e;
    }
}
class AuthError extends Error {
    requestId;
    constructor(message, requestId) {
        super(message);
        this.requestId = requestId;
        this.name = 'AuthError';
    }
}
class ValidationErrorWithId extends Error {
    requestId;
    constructor(message, requestId) {
        super(message);
        this.requestId = requestId;
        this.name = 'ValidationErrorWithId';
    }
}
function errorEnvelope(reply, httpStatus, code, message, requestId) {
    return reply.status(httpStatus).send({
        error: { code, message, request_id: requestId },
    });
}
/**
 * Wrap an async handler so a thrown AuthError or ValidationErrorWithId
 * returns the right HTTP status instead of 500. The handler-level
 * `try/catch` in each route already maps ValidationError; this helper
 * is a safety net for any future route that forgets.
 */
export function mapAuthAndValidationErrors(reply, requestId) {
    return (err) => {
        if (err instanceof AuthError) {
            return errorEnvelope(reply, 401, 'VALIDATION', err.message, requestId);
        }
        if (err instanceof ValidationErrorWithId) {
            return errorEnvelope(reply, 400, 'VALIDATION', err.message, requestId);
        }
        return errorEnvelope(reply, 500, 'INTERNAL', err instanceof Error ? err.message : 'unknown error', requestId);
    };
}
// Silence unused-import warnings for helpers that are exported for
// test consumers but not directly used in this file.
void lifecycleVerbCheck;
void timingSafeEqual;
void createHmac;
/** Compile-time-only check: the verb list is closed. */
function lifecycleVerbCheck(_v) { }
//# sourceMappingURL=server.js.map
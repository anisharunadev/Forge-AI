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
 * Auth model — ADR-0003 §4.2 v1.1 (FORA-526):
 *
 * The Orchestrator verifies JWTs in-process. A Fastify preHandler hook
 * (`jwtAuthHook` below) reads `Authorization: Bearer <jwt>`, calls
 * `JwtValidator.verify` (jose + JWKS at `config.jwtVerifierUrl`), and
 * stamps the typed `JwtPrincipal` on `request.tenantContext`. The legacy
 * `x-fora-tenant-id` header is REMOVED from the trust boundary — it
 * is honoured only when `FORA_REQUIRE_JWT=false` for local dev. The
 * gateway is no longer required; the service can be deployed behind
 * an untrusted LB / sidecar.
 */
import type { Pool } from 'pg';
import { type FastifyInstance } from 'fastify';
import type { OrchestratorConfig } from './config.js';
import { type ApprovalsRepo, type Clock, type EventBus, type Pager, type PaperclipClient } from './index.js';
import { type AttachEventsWebSocketOptions } from './ws.js';
import { JwtValidator, type JwtPrincipal } from './jwt-validator.js';
export interface OrchestratorDeps {
    config: OrchestratorConfig;
    pool: Pool;
    /**
     * Ports for the human-approval router (FORA-137). In production
     * these are wired to Postgres, NATS, PagerDuty, and Paperclip HTTP.
     */
    approvals: {
        repo: ApprovalsRepo;
        paperclip: PaperclipClient;
        bus: EventBus;
        pager: Pager;
        clock: Clock;
    };
    /**
     * FORA-526: an explicit `JwtValidator` instance. Production builds
     * it from `config.jwtVerifierUrl / jwtIssuer / jwtAudience / jwtClockToleranceSec`
     * inside `buildServer`; tests can inject a fake to avoid the JWKS
     * round-trip. Required when `config.requireJwt` is true (the default).
     */
    jwtValidator?: JwtValidator;
    /**
     * FORA-514: the realtime WS endpoint. When provided, `buildServer`
     * attaches a `GET /v1/events` handler that forwards NATS events to
     * authenticated tenant clients. Production wires this to NATS via
     * `@fora/event-bus`; tests can omit it (REST-only) or supply a
     * fake subscriber.
     */
    ws?: Omit<AttachEventsWebSocketOptions, 'registry'> & {
        /** Override the per-tenant connection cap (default 10). */
        cap?: number;
    };
    /**
     * Override the tenant extractor for tests. In production the
     * preHandler hook (`jwtAuthHook`) stamps `request.tenantContext`
     * after a successful JWT verify; this seam lets tests bypass JWT
     * verification entirely by setting `config.requireJwt=false` and
     * returning a deterministic tenant from the legacy `x-fora-tenant-id`
     * header.
     */
    extractTenant?: (req: {
        headers: Record<string, unknown>;
    }) => string | null;
    /** Override `new Date()` for tests. */
    now?: () => number;
}
/**
 * FORA-526 — module augmentation that surfaces the JWT-verified
 * principal on every `FastifyRequest`. The preHandler hook stamps
 * this; the rest of the server reads `request.tenantContext` via
 * the `extractTenant` closure.
 */
declare module 'fastify' {
    interface FastifyRequest {
        tenantContext?: JwtPrincipal;
    }
}
export declare function buildServer(deps: OrchestratorDeps): Promise<FastifyInstance>;
/**
 * The setErrorHandler at the top of `buildServer` is the only safety
 * net that maps AuthError / ValidationErrorWithId to 401 / 400. Each
 * route already validates its inputs inline (see `requireTenant` /
 * `requireIdempotencyKey`); a `preHandler` would only duplicate that
 * work. We intentionally do not export `mapAuthAndValidationErrors` —
 * keeping the function would invite a future route to register it
 * without the matching setErrorHandler branch.
 */

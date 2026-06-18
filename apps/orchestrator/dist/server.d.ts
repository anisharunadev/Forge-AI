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
import type { Pool } from 'pg';
import { type FastifyInstance } from 'fastify';
import type { OrchestratorConfig } from './config.js';
import { type ApprovalsRepo, type Clock, type EventBus, type Pager, type PaperclipClient } from './index.js';
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
     * Override the gateway-claim extractor for tests. In production the
     * gateway upstream stamps `x-fora-tenant-id` after verifying the JWT
     * (ADR-0003 §4.2); the test seam returns a deterministic tenant.
     */
    extractTenant?: (req: {
        headers: Record<string, unknown>;
    }) => string | null;
    /** Override `new Date()` for tests. */
    now?: () => number;
}
export declare function buildServer(deps: OrchestratorDeps): Promise<FastifyInstance>;
/**
 * Wrap an async handler so a thrown AuthError or ValidationErrorWithId
 * returns the right HTTP status instead of 500. The handler-level
 * `try/catch` in each route already maps ValidationError; this helper
 * is a safety net for any future route that forgets.
 */
export declare function mapAuthAndValidationErrors(reply: {
    status: (n: number) => {
        send: (b: unknown) => unknown;
    };
}, requestId: string): (err: unknown) => unknown;

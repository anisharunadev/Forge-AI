/**
 * @fora/db-pool — public types.
 *
 * The pool wrapper is the runtime gate between the identity-broker
 * (which mints a tenant-bound JWT) and the database (which trusts
 * `current_setting('app.tenant_id')`). The wrapper enforces that the
 * request envelope's `tenant_id` equals the verified claim's `tenant_id`
 * before it lends a connection; on mismatch it emits `tenancy.denied` and
 * refuses the checkout.
 *
 * See FORA-163, ADR-0003 §4.2, and FORA-124 acceptance bar #2.
 */

import { z } from 'zod';

// ---- Tenancy primitives ---------------------------------------------------

/** UUID-shaped tenant id. We validate format to fail fast on typos. */
export const TenantIdSchema = z.string().uuid({
  message: 'tenant_id must be a UUID (per ADR-0003 §4.5: tenant_id is a primary-key prefix)',
});
export type TenantId = z.infer<typeof TenantIdSchema>;

/** UUID-shaped actor identifier (user:<idp-id> or agent:<type>:<run-id>). */
export const ActorIdSchema = z.string().min(1);
export type ActorId = z.infer<typeof ActorIdSchema>;

/**
 * Sentinel value placed on every connection when no tenant is bound.
 *
 * Per FORA-163: "Restores the connection to a 'no tenant' sentinel so a
 * stray checkout cannot read across tenants." The RLS policy from
 * 0.7.2a compares `tenant_id = current_setting('app.tenant_id')::uuid`,
 * so the sentinel must be a syntactically valid UUID that maps to no real
 * tenant — a row whose `tenant_id` equals the sentinel is impossible by
 * construction.
 */
export const NO_TENANT_SENTINEL: TenantId = '00000000-0000-0000-0000-000000000000';

// ---- Claim + envelope -----------------------------------------------------

/**
 * The verified claim (decoded from the broker's JWT) that names the tenant
 * the request is bound to. The claim is the source of truth — the envelope
 * is just a request-side carrier.
 */
export interface Claim {
  /** Tenant the claim grants access to. */
  tenant_id: TenantId;
  /** Principal type — drives audit row shape. */
  principal: 'board_user' | 'agent' | 'cloud_operator';
  /** Subject — `user:<idp-user-id>` or `agent:<type>:<run-id>`. */
  sub: ActorId;
  /** Roles claimed (e.g. `developer`, `security-engineer`). */
  roles: string[];
  /** MCP scopes claimed (e.g. `mcp:github:read`). */
  scopes: string[];
  /** Run/trace id — links audit rows to the run. */
  trace_id: string;
}

/**
 * The request envelope — the per-request value the caller asserts. The
 * wrapper verifies `envelope.tenant_id === claim.tenant_id` synchronously
 * and refuses to lend a connection on mismatch.
 */
export interface RequestEnvelope {
  tenant_id: TenantId;
}

/**
 * The full request context: claim (verified by the broker) plus envelope
 * (the caller-provided per-request value). They must match on `tenant_id`.
 */
export interface RequestContext {
  claim: Claim;
  envelope: RequestEnvelope;
}

// ---- Error types ----------------------------------------------------------

/**
 * Thrown when `envelope.tenant_id !== claim.tenant_id`. The wrapper never
 * checks out a connection in this case. The audit sink receives a
 * `tenancy.denied` event before this error is raised.
 */
export class TenantClaimMismatchError extends Error {
  readonly code = 'tenant_claim_mismatch';
  readonly claim_tenant_id: TenantId;
  readonly envelope_tenant_id: TenantId;
  readonly actor: ActorId;
  readonly trace_id: string;

  constructor(args: {
    claim_tenant_id: TenantId;
    envelope_tenant_id: TenantId;
    actor: ActorId;
    trace_id: string;
  }) {
    super(
      `tenant claim mismatch: envelope.tenant_id=${args.envelope_tenant_id} ` +
        `does not match claim.tenant_id=${args.claim_tenant_id} ` +
        `(actor=${args.actor}, trace_id=${args.trace_id})`,
    );
    this.name = 'TenantClaimMismatchError';
    this.claim_tenant_id = args.claim_tenant_id;
    this.envelope_tenant_id = args.envelope_tenant_id;
    this.actor = args.actor;
    this.trace_id = args.trace_id;
  }
}

/**
 * Thrown when a request lands on the pool without a context. This is a
 * caller bug: every entry point must carry a `RequestContext`. The error
 * is named explicitly so the lint rule that catches "bypassing the wrapper"
 * can match on it.
 */
export class MissingRequestContextError extends Error {
  readonly code = 'missing_request_context';
  constructor() {
    super(
      'db-pool: query() called without a RequestContext. ' +
        'Every DB-touching code path must go through TenantAwarePool.query(ctx, ...).',
    );
    this.name = 'MissingRequestContextError';
  }
}

// ---- Audit ---------------------------------------------------------------

/**
 * The minimal audit event the wrapper emits. The shape mirrors the
 * identity-broker's `AuthAuditEvent` (ADR-0003 §8.1) and the FORA-36
 * append-only contract. Consumers that need richer metadata pass it in
 * `metadata`; the wrapper never logs secret values.
 */
export interface TenancyAuditEvent {
  actor: ActorId;
  tenant_id: TenantId;
  principal: Claim['principal'];
  action: 'tenancy.denied' | 'tenancy.pool.connect' | 'tenancy.pool.sentinel_set';
  scopes_used: string[];
  decision: 'allow' | 'deny';
  trace_id: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * The audit sink contract. The default in-process implementation is
 * `InMemoryAuditSink` (for tests); production wires the FORA-36 event
 * store via the broker's `ForaAuditSink` (see apps/identity-broker).
 */
export interface AuditSink {
  append(event: TenancyAuditEvent): Promise<void>;
  close(): Promise<void>;
}

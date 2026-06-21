/**
 * In-process JWT validation — ADR-0003 v1.1 update (FORA-526).
 *
 * Replaces the v0.1 trust model (the upstream gateway stamps
 * `x-fora-tenant-id` after JWT verification) with in-process verification
 * so the Orchestrator can be deployed behind an untrusted LB / sidecar.
 *
 * Verifies a FORA-issued access token against the JWKS published by the
 * identity-broker (`{FORA_JWT_VERIFIER_URL}/.well-known/jwks.json`),
 * enforces the `iss` / `aud` / `exp` / claim-set contract, and returns a
 * typed `JwtPrincipal` the Fastify hook stamps on `request`.
 *
 * The wire format and claim set are owned by `@fora/session-tokens` (the
 * broker's `TokenIssuer.mint`). The schema here is intentionally a copy
 * so this module stays a leaf and the Orchestrator does not import the
 * broker's runtime. The two schemas are kept in sync by ADR-0003 §3.2 +
 * the ADR-0003 v1.1 amendment.
 */

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  errors as joseErrors,
} from 'jose';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Claim schema (mirror of @fora/session-tokens SessionClaims)
// ---------------------------------------------------------------------------

export const PrincipalSchema = z.enum(['board_user', 'agent', 'cloud_operator']);
export type Principal = z.infer<typeof PrincipalSchema>;

const SessionClaimsSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.string().min(1),
  tenant_id: z.string().min(1),
  principal: PrincipalSchema,
  roles: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  trace_id: z.string().min(1),
  cnf: z.object({ jkt: z.string().min(1) }),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
});
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

// ---------------------------------------------------------------------------
// Typed errors (mapped to HTTP 401 VALIDATION by the Fastify hook)
// ---------------------------------------------------------------------------

/**
 * The discrete failure modes for JWT verification. The hook maps each to
 * the JSON error envelope `{code: 'VALIDATION', ...}` with HTTP 401;
 * the distinction is surfaced in the audit log (when the orchestrator
 * emits one in v1.2) and in the `request_id` correlation header.
 */
export type JwtErrorCode = 'EXPIRED' | 'TAMPERED' | 'INVALID' | 'WRONG_TENANT';

export class JwtError extends Error {
  constructor(
    public readonly code: JwtErrorCode,
    message: string,
    public readonly claim?: string,
  ) {
    super(message);
    this.name = 'JwtError';
  }
}

// ---------------------------------------------------------------------------
// Typed principal (what the Fastify hook stamps on `request`)
// ---------------------------------------------------------------------------

/**
 * The minimal typed shape the Orchestrator needs from a verified JWT.
 *
 *   - `tenantId`  — first-class claim, drives every DB query's RLS key.
 *   - `actorId`   — `sub` (e.g. `user:<idp-sub>` or `agent:<type>:<run-id>`).
 *   - `principal` — `'board_user' | 'agent' | 'cloud_operator'`.
 *   - `role`      — first entry of `roles[]`, or `null` if empty.
 *   - `scopes`    — MCP scope set asserted by the broker.
 *   - `traceId`   — the broker-issued correlation id; flowed to the
 *                   audit log and downstream MCP calls.
 *   - `jti`, `exp` — kept on the principal so the sweeper can purge
 *                    replay-cache entries on token expiry.
 */
export interface JwtPrincipal {
  tenantId: string;
  actorId: string;
  principal: Principal;
  role: string | null;
  scopes: string[];
  traceId: string;
  jti: string;
  exp: number;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export interface JwtValidatorConfig {
  /**
   * URL to the broker's JWKS document. The broker publishes its
   * ES256 public key at `{public_url}/.well-known/jwks.json`; the
   * `FORA_JWT_VERIFIER_URL` env var defaults to that.
   */
  jwksUrl: string;
  /** Expected `iss` — must match `BrokerConfig.issuer`. */
  issuer: string;
  /** Expected `aud` — must match `BrokerConfig.audience` (`forge-runtime`). */
  audience: string;
  /**
   * Accept a clock skew of up to N seconds on `exp` / `nbf`. Default 0;
   * the broker and orchestrator should run on the same NTP source.
   */
  clockToleranceSec?: number;
  /** Override the current time (epoch seconds) for tests. */
  now?: () => number;
}

/**
 * Verifies a FORA-issued access token against the broker's published
 * JWKS, validates the claim-set contract, and returns a typed
 * `JwtPrincipal`. Throws a `JwtError` with a precise `code` on any
 * failure mode (expired / tampered / wrong-tenant / malformed).
 *
 * The `expectedTenantId` opt on `verify()` enables the cross-tenant
 * guard from ADR-0003 §4.5: a token issued for tenant A cannot be
 * replayed against tenant B's data. The Fastify hook pins it to the
 * request's path-derived tenant (when applicable); callers that don't
 * know the tenant ahead of time can pass the URL-derived value.
 */
export class JwtValidator {
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly clockToleranceSec: number;
  private readonly now: () => number;

  constructor(cfg: JwtValidatorConfig) {
    if (!cfg.jwksUrl) throw new Error('JwtValidator: jwksUrl is required');
    if (!cfg.issuer) throw new Error('JwtValidator: issuer is required');
    if (!cfg.audience) throw new Error('JwtValidator: audience is required');
    this.jwks = createRemoteJWKSet(new URL(cfg.jwksUrl));
    this.issuer = cfg.issuer;
    this.audience = cfg.audience;
    this.clockToleranceSec = cfg.clockToleranceSec ?? 0;
    this.now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Verify `token` and return the typed principal. Throws `JwtError` on
   * any failure.
   */
  async verify(
    token: string,
    opts: { expectedTenantId?: string } = {},
  ): Promise<JwtPrincipal> {
    if (!token || typeof token !== 'string') {
      throw new JwtError('INVALID', 'token missing or not a string');
    }

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['ES256'],
        clockTolerance: this.clockToleranceSec,
      });
      payload = verified.payload;
    } catch (e) {
      if (e instanceof joseErrors.JWTExpired) {
        throw new JwtError('EXPIRED', 'token expired', 'exp');
      }
      if (e instanceof joseErrors.JWSSignatureVerificationFailed) {
        throw new JwtError('TAMPERED', 'signature verification failed');
      }
      if (e instanceof joseErrors.JWTClaimValidationFailed) {
        throw new JwtError('INVALID', `claim invalid: ${e.claim ?? 'unknown'}`, e.claim);
      }
      if (e instanceof joseErrors.JOSEError) {
        throw new JwtError('INVALID', `jose: ${e.message}`);
      }
      throw new JwtError(
        'INVALID',
        e instanceof Error ? e.message : 'verify failed',
      );
    }

    let claims: SessionClaims;
    try {
      claims = SessionClaimsSchema.parse(payload);
    } catch (e) {
      throw new JwtError(
        'INVALID',
        e instanceof Error ? `claims malformed: ${e.message}` : 'claims malformed',
      );
    }

    if (opts.expectedTenantId && claims.tenant_id !== opts.expectedTenantId) {
      throw new JwtError(
        'WRONG_TENANT',
        `tenant mismatch: expected ${opts.expectedTenantId}, got ${claims.tenant_id}`,
        'tenant_id',
      );
    }

    // Hard-enforce expiry against the local clock, in addition to jose's
    // `exp` check (which respects `clockTolerance`).
    if (claims.exp <= this.now() - this.clockToleranceSec) {
      throw new JwtError('EXPIRED', 'token expired (local clock)', 'exp');
    }

    return {
      tenantId: claims.tenant_id,
      actorId: claims.sub,
      principal: claims.principal,
      role: claims.roles[0] ?? null,
      scopes: claims.scopes,
      traceId: claims.trace_id,
      jti: claims.jti,
      exp: claims.exp,
    };
  }
}

/**
 * Test-only helper: derive a `JwtValidatorConfig` from a public key +
 * issuer / audience. Used by the unit tests so they don't need a live
 * JWKS endpoint. Not for production use — production goes through the
 * broker's `/.well-known/jwks.json`.
 *
 * NOTE: callers that need a public-key-backed validator in tests should
 * wrap `jwtVerify(token, publicKey, ...)` directly rather than going
 * through `JwtValidator`. The seam here exists only for completeness;
 * tests below use the seam with `createLocalJWKSet` via a stub.
 */
export function _publicKeyForTests(_cfg: { jwksUrl: string }): null {
  // Reserved for future expansion. Production validators always read the
  // JWKS via `createRemoteJWKSet`.
  void _cfg;
  return null;
}
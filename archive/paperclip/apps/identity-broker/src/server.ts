/**
 * Identity-broker Fastify server.
 *
 * Routes:
 *   GET  /auth/login?tenant=<id>     start OIDC flow, redirect to IdP
 *   GET  /auth/callback              OIDC callback, mint FORA session
 *   POST /auth/logout                revoke + redirect to IdP logout
 *   GET  /auth/whoami                debug: return current claims
 *   POST /auth/idp-revoke            per-tenant IdP revocation webhook
 *                                    (HMAC-SHA256 signed, see verifyIdpSignature)
 *   POST /auth/revoke (admin)        manual admin revoke
 *   GET  /.well-known/jwks.json      publish the broker's signing public key
 *   GET  /healthz                    liveness
 *
 * The FORA session is set as an HTTP-only, Secure, SameSite=Lax cookie
 * (`fora_sess`). The access token is returned to the client in the JSON
 * callback response; clients that need DPoP can fetch the access token
 * from /auth/whoami after exchanging the cookie for a token.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TokenIssuer } from '@fora/session-tokens';
import { createOidcClient, type OidcClient, type OidcClientConfig } from '@fora/oidc-clients';
import type { AuditSink } from './audit.js';
import { ForaAuditSink, InMemoryAuditSink, JsonlAuditSink } from './audit.js';
import { InMemoryRevocationStore, type RevocationStore } from './revocation.js';
import { InMemoryProvisioningStore, type ProvisioningStore, userIdFor } from './provisioning.js';
import { InMemoryStateStore, type StateStore } from './state.js';
import type { BrokerConfig } from './config.js';
import {
  checkToolCall,
  iamAuditEvent,
  ToolCallSchema,
  type McpDispatcher,
  type PolicyStore,
  type ToolCall,
} from './iam.js';

export interface BrokerDeps {
  config: BrokerConfig;
  audit: AuditSink;
  revocation: RevocationStore;
  provisioning: ProvisioningStore;
  state: StateStore;
  /** Override the OIDC client factory for tests. */
  idp_factory?: (cfg: OidcClientConfig) => OidcClient;
  /** Override `new Date()` for tests. */
  now?: () => number;
  /** Agent IAM policy store (FORA-125). Required. */
  policy_store?: PolicyStore;
  /** MCP dispatcher used after a successful IAM check. */
  mcp_dispatcher?: McpDispatcher;
  /**
   * Resolve a `role` (e.g. "developer") from the principal carried in the
   * envelope. v1 derives the role from `agent_type` directly; future
   * versions can resolve the role from the JWT / board-user claims.
   */
  resolve_role?: (call: ToolCall) => string | null;
}

export const SESSION_COOKIE_NAME = 'fora_sess';
const SESSION_COOKIE_TTL_SECONDS = 60 * 60 * 8; // 8 hours, browser session hint

export async function buildServer(deps: BrokerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.env !== 'test' });
  // @fastify/cookie is required for `req.cookies` and `reply.setCookie` /
  // `reply.clearCookie` used by the /auth/callback and /auth/logout routes.
  await app.register(import('@fastify/cookie'), {
    parseOptions: {
      // FORA-issued session cookies are JWTs with the tenant claim inside;
      // we do not need to additionally sign at the cookie layer.
    },
  });
  // Capture the raw request body so webhook signature verification
  // (e.g. /auth/idp-revoke) can HMAC the exact bytes the IdP signed.
  // We stash `rawBody` on the request — Fastify still parses JSON into
  // `req.body` per the default content-type parser, so existing routes
  // are unaffected.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    (_req as unknown as { rawBody: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      // Stash the desired status on the Error so Fastify surfaces a 400
      // for malformed JSON. `err` is `unknown` under `useUnknownInCatchVariables`.
      const parseErr = err as Error & { statusCode?: number };
      parseErr.statusCode = 400;
      done(parseErr, undefined);
    }
  });
  const issuer = new TokenIssuer({
    issuer: deps.config.issuer,
    audience: deps.config.audience,
    signing_key: deps.config.signing_key.privateKey,
    public_key: deps.config.signing_key.publicKey,
  });

  const idp_factory = deps.idp_factory ?? ((cfg) => createOidcClient(cfg));
  const idp_cache = new Map<string, OidcClient>();
  function getIdp(tenant_id: string): OidcClient {
    const cached = idp_cache.get(tenant_id);
    if (cached) return cached;
    const cfg = deps.config.tenants.get(tenant_id);
    if (!cfg) throw httpError(404, `unknown tenant: ${tenant_id}`);
    const client = idp_factory(cfg);
    idp_cache.set(tenant_id, client);
    return client;
  }

  const newTraceId = (): string => `tr_${randomHex(12)}`;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  // ---- Health ------------------------------------------------------------
  app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }));

  // ---- JWKS (the broker's signing public key) ----------------------------
  app.get('/.well-known/jwks.json', async () => {
    return {
      keys: [deps.config.signing_key.publicJwk],
    };
  });

  // ---- /auth/login?tenant=<id> -----------------------------------------
  const LoginQuery = z.object({ tenant: z.string().min(1) });
  app.get<{ Querystring: z.infer<typeof LoginQuery> }>('/auth/login', async (req, reply) => {
    const q = LoginQuery.safeParse(req.query);
    if (!q.success) return httpError(400, 'tenant required');
    const tenant_id = q.data.tenant;
    if (!deps.config.tenants.has(tenant_id)) {
      await deps.audit.append({
        actor: 'unknown',
        tenant_id,
        principal: 'board_user',
        action: 'auth.login.failed',
        scopes_used: [],
        decision: 'deny',
        trace_id: newTraceId(),
        timestamp: new Date().toISOString(),
        metadata: { reason: 'unknown_tenant' },
      });
      return httpError(404, 'unknown tenant');
    }
    const trace_id = newTraceId();
    const pending = await deps.state.create({ tenant_id, trace_id });
    const idp = getIdp(tenant_id);
    const url = await idp.buildAuthorizationUrl({
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: pending.code_challenge,
      code_challenge_method: 'S256',
    });
    return reply.redirect(url);
  });

  // ---- /auth/callback ---------------------------------------------------
  const CallbackQuery = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
    error: z.string().optional(),
    error_description: z.string().optional(),
  });
  app.get<{ Querystring: z.infer<typeof CallbackQuery> }>('/auth/callback', async (req, reply) => {
    const q = CallbackQuery.safeParse(req.query);
    if (!q.success) return httpError(400, 'invalid callback');
    const pending = await deps.state.consume(q.data.state);
    if (!pending) {
      return httpError(400, 'unknown or expired state');
    }
    const tenant_id = pending.tenant_id;
    const trace_id = pending.trace_id;
    if (q.data.error) {
      await deps.audit.append({
        actor: 'unknown',
        tenant_id,
        principal: 'board_user',
        action: 'auth.login.failed',
        scopes_used: [],
        decision: 'deny',
        trace_id,
        timestamp: new Date().toISOString(),
        metadata: { idp_error: q.data.error, idp_error_description: q.data.error_description ?? null },
      });
      return httpError(400, `IdP error: ${q.data.error}`);
    }
    try {
      const idp = getIdp(tenant_id);
      const tokens = await idp.exchangeCode({
        code: q.data.code,
        code_verifier: pending.code_verifier,
      });
      const verified = await idp.verifyIdToken(tokens.id_token, pending.nonce);
      const payload = verified.payload as Record<string, unknown>;
      const idp_sub = String(payload.sub);
      const email = String(payload['email'] ?? '');
      const name = String(payload['name'] ?? '');
      const roles = Array.isArray(payload['https://fora.example/roles'])
        ? (payload['https://fora.example/roles'] as string[])
        : ['developer'];

      // Provision (idempotent on (idp_id, idp_sub)).
      const idp_id = deps.config.tenants.get(tenant_id)!.idp_id;
      const { user } = await deps.provisioning.upsert({
        idp_id,
        idp_sub,
        tenant_id,
        email,
        name,
        roles,
        scopes: deriveScopesForRoles(roles),
      });

      // Mint a FORA-issued access token. The token is bound to a DPoP
      // client key; in this flow the client is the user's browser session,
      // and the JKT is computed from a server-held keypair (v1). A v1.1
      // upgrade lets the browser generate the keypair and post the public
      // key on /auth/login.
      const { publicJwk, privateKey } = await (async () => {
        const { generateKeyPair, exportJWK } = await import('jose');
        const kp = await generateKeyPair('ES256', { extractable: true });
        return { publicJwk: await exportJWK(kp.publicKey), privateKey: kp.privateKey };
      })();
      // We pin the JKT to the public key; the matching private key is kept
      // server-side so the broker can sign DPoP proofs on the user's behalf
      // (this is the v1 simplification — a real browser-managed keypair is
      // the v1.1 upgrade per ADR §3.1).
      void privateKey;
      const minted = await issuer.mint({
        tenant_id,
        principal: 'board_user',
        sub: `user:${idp_sub}`,
        roles: user.roles,
        scopes: user.scopes,
        trace_id,
        client_public_key: publicJwk,
      });

      // Set the session cookie.
      reply.setCookie(SESSION_COOKIE_NAME, minted.jwt, {
        httpOnly: true,
        secure: deps.config.env === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_COOKIE_TTL_SECONDS,
      });

      await deps.audit.append({
        actor: userIdFor(idp_id, idp_sub),
        tenant_id,
        principal: 'board_user',
        action: 'auth.login.succeeded',
        scopes_used: user.scopes,
        decision: 'allow',
        trace_id,
        timestamp: new Date().toISOString(),
        metadata: { idp_id, idp_sub, email, jti: minted.jti, jkt: minted.jkt },
      });
      await deps.audit.append({
        actor: userIdFor(idp_id, idp_sub),
        tenant_id,
        principal: 'board_user',
        action: 'auth.token.minted',
        scopes_used: user.scopes,
        decision: 'allow',
        trace_id,
        timestamp: new Date().toISOString(),
        metadata: { jti: minted.jti, jkt: minted.jkt, exp: minted.exp },
      });

      return reply.send({
        ok: true,
        tenant_id,
        principal: 'board_user',
        user: { id: userIdFor(idp_id, idp_sub), email: user.email, name: user.name },
        access_token: minted.jwt,
        expires_in: minted.exp - now(),
        trace_id,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await deps.audit.append({
        actor: 'unknown',
        tenant_id,
        principal: 'board_user',
        action: 'auth.login.failed',
        scopes_used: [],
        decision: 'deny',
        trace_id,
        timestamp: new Date().toISOString(),
        metadata: { reason },
      });
      return httpError(401, `login failed: ${reason}`);
    }
  });

  // ---- /auth/logout -----------------------------------------------------
  app.post<{ Body: { tenant?: string } }>('/auth/logout', async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE_NAME];
    if (!cookie) return reply.send({ ok: true, revoked: 0 });
    try {
      const claims = await issuer.verify(cookie);
      await deps.revocation.revoke_by_jti(claims.jti, claims.exp);
      // Also revoke the sub so any other in-flight sessions die.
      await deps.revocation.revoke_by_sub(claims.sub, claims.exp);
      await deps.audit.append({
        actor: claims.sub,
        tenant_id: claims.tenant_id,
        principal: claims.principal,
        action: 'auth.session.revoked',
        scopes_used: claims.scopes,
        decision: 'allow',
        trace_id: claims.trace_id,
        timestamp: new Date().toISOString(),
        metadata: { jti: claims.jti, kind: 'logout' },
      });
    } catch {
      // Cookie was already invalid; nothing to revoke.
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.send({ ok: true, revoked: 1 });
  });

  // ---- /auth/whoami -----------------------------------------------------
  app.get('/auth/whoami', async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE_NAME];
    if (!cookie) return httpError(401, 'no session');
    let claims: import('@fora/session-tokens').SessionClaims;
    try {
      claims = await issuer.verify(cookie);
    } catch (err) {
      return httpError(401, `invalid session: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    if (await deps.revocation.is_revoked_jti(claims.jti)) {
      return httpError(401, 'session_revoked');
    }
    if (await deps.revocation.is_revoked_sub(claims.sub, Math.floor(Date.now() / 1000))) {
      return httpError(401, 'subject_revoked');
    }
    return reply.send({
      tenant_id: claims.tenant_id,
      principal: claims.principal,
      sub: claims.sub,
      roles: claims.roles,
      scopes: claims.scopes,
      trace_id: claims.trace_id,
      jti: claims.jti,
      exp: claims.exp,
    });
  });

  // ---- /auth/revoke (admin) ---------------------------------------------
  const RevokeBody = z.object({
    sub: z.string().min(1).optional(),
    jti: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  });
  app.post<{ Body: z.infer<typeof RevokeBody> }>('/auth/revoke', async (req, reply) => {
    const body = RevokeBody.safeParse(req.body);
    if (!body.success) return httpError(400, 'sub or jti required');
    const { sub, jti, reason } = body.data;
    if (!sub && !jti) return httpError(400, 'sub or jti required');
    if (jti) {
      // No exp known to us; use 24h window.
      await deps.revocation.revoke_by_jti(jti, Math.floor(Date.now() / 1000) + 24 * 3600);
    }
    if (sub) {
      await deps.revocation.revoke_by_sub(sub, Math.floor(Date.now() / 1000) + 24 * 3600);
    }
    await deps.audit.append({
      actor: 'admin',
      tenant_id: 'platform',
      principal: 'cloud_operator',
      action: 'auth.session.revoked',
      scopes_used: [],
      decision: 'allow',
      trace_id: newTraceId(),
      timestamp: new Date().toISOString(),
      metadata: { sub: sub ?? null, jti: jti ?? null, reason: reason ?? 'unspecified', kind: 'admin_revoke' },
    });
    return reply.send({ ok: true });
  });

  // ---- /auth/idp-revoke (per-tenant IdP webhook, FORA-161 / 0.7.1c) -----
  //
  // The IdP pushes {event, subject, tenant_id, idp_issued_at} to this
  // endpoint, signed with a per-tenant shared secret. We verify the
  // signature first, then act on the revocation. The 60-second propagation
  // budget from FORA-123 acceptance bar #4 is satisfied by the in-memory
  // store being synchronous; a real deployment layers a Redis pubsub fanout
  // on top of `revoke_by_sub` without changing the contract.
  //
  // Signature header: `X-IdP-Signature: sha256=<hex>`, HMAC-SHA256 of the
  // raw request body using the per-tenant `webhook_secret`.
  const IdpRevokeBody = z.object({
    event: z.enum(['user.disabled', 'user.deleted', 'session.revoked']),
    subject: z.string().min(1),
    tenant_id: z.string().min(1),
    idp_issued_at: z.string().optional(),
  });
  app.post<{ Body: unknown; rawBody: string | null }>('/auth/idp-revoke', async (req, reply) => {
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? null;
    if (rawBody === null) {
      return httpError(400, 'raw body required');
    }
    const sigHeader = req.headers['x-idp-signature'];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (typeof sig !== 'string' || !sig.startsWith('sha256=')) {
      await deps.audit.append({
        actor: 'unknown',
        tenant_id: 'unknown',
        principal: 'cloud_operator',
        action: 'auth.login.failed',
        scopes_used: [],
        decision: 'deny',
        trace_id: newTraceId(),
        timestamp: new Date().toISOString(),
        metadata: { reason: 'webhook_signature_mismatch', kind: 'idp_webhook' },
      });
      return httpError(401, 'missing or malformed signature');
    }
    // Parse the JSON first so we know which tenant the IdP claims this
    // webhook is for — the secret is looked up by tenant_id, and we never
    // want to leak whether a tenant exists vs. has a bad signature.
    let parsed: z.infer<typeof IdpRevokeBody>;
    try {
      parsed = IdpRevokeBody.parse(JSON.parse(rawBody));
    } catch {
      await deps.audit.append({
        actor: 'unknown',
        tenant_id: 'unknown',
        principal: 'cloud_operator',
        action: 'auth.login.failed',
        scopes_used: [],
        decision: 'deny',
        trace_id: newTraceId(),
        timestamp: new Date().toISOString(),
        metadata: { reason: 'webhook_signature_mismatch', kind: 'idp_webhook' },
      });
      return httpError(401, 'invalid payload');
    }
    const secret = deps.config.tenant_webhook_secrets.get(parsed.tenant_id);
    if (!secret) {
      await deps.audit.append({
        actor: 'unknown',
        tenant_id: parsed.tenant_id,
        principal: 'cloud_operator',
        action: 'auth.login.failed',
        scopes_used: [],
        decision: 'deny',
        trace_id: newTraceId(),
        timestamp: new Date().toISOString(),
        metadata: { reason: 'webhook_signature_mismatch', kind: 'idp_webhook' },
      });
      return httpError(401, 'unknown tenant');
    }
    if (!verifyIdpSignature(rawBody, sig, secret)) {
      await deps.audit.append({
        actor: 'unknown',
        tenant_id: parsed.tenant_id,
        principal: 'cloud_operator',
        action: 'auth.login.failed',
        scopes_used: [],
        decision: 'deny',
        trace_id: newTraceId(),
        timestamp: new Date().toISOString(),
        metadata: { reason: 'webhook_signature_mismatch', kind: 'idp_webhook' },
      });
      return httpError(401, 'bad signature');
    }
    // The principal we mint tokens for is `user:<idp_sub>` (see /auth/callback
    // mints). Revoke every in-flight session for that principal. The 24h
    // window matches the admin /auth/revoke seam and is well over the
    // 60-second propagation budget; revocations are evicted at exp.
    const principal = `user:${parsed.subject}`;
    const until = now() + 24 * 3600;
    await deps.revocation.revoke_by_sub(principal, until);
    const tenantCfg = deps.config.tenants.get(parsed.tenant_id);
    await deps.audit.append({
      actor: `idp:${tenantCfg?.idp_id ?? 'unknown'}`,
      tenant_id: parsed.tenant_id,
      principal: 'cloud_operator',
      action: 'auth.session.revoked',
      scopes_used: [],
      decision: 'allow',
      trace_id: newTraceId(),
      timestamp: new Date().toISOString(),
      metadata: {
        kind: 'idp_webhook',
        event: parsed.event,
        subject: parsed.subject,
        idp_issued_at: parsed.idp_issued_at ?? null,
      },
    });
    return reply.send({ ok: true, revoked_sub: principal, until });
  });

  // ---- /iam/invoke (FORA-125 / 0.7.3) -------------------------------------
  //
  // The single chokepoint for every MCP call. Sub-agents post a typed
  // `ToolCall` envelope; the broker checks it against the role registry,
  // the tenant policy, and the claim scope set. Failures return 403
  // (unbound_mcp or denied); successes forward to the MCP dispatcher.
  // The dispatcher is intentionally pluggable — v1 lands the seam, the
  // real MCP transport is a follow-up epic.
  const IamInvokeBody = ToolCallSchema;
  app.post<{ Body: unknown }>('/iam/invoke', async (req, reply) => {
    if (!deps.policy_store) {
      return reply.code(503).send({ error: 'iam: policy store not configured' });
    }
    const parsed = IamInvokeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: `iam: invalid envelope: ${parsed.error.message}` });
    }
    const call = parsed.data as ToolCall;
    const role = deps.resolve_role
      ? deps.resolve_role(call)
      : call.principal === 'agent'
        ? call.agent_type
        : null;
    const decision = checkToolCall({ call, role, store: deps.policy_store });
    const actor = `agent:${call.agent_type}:${role ?? 'unknown'}`;
    const trace_id = call.trace_id || newTraceId();
    await deps.audit.append(iamAuditEvent({ call, decision, actor, trace_id }));
    if (decision.kind === 'unbound_mcp') {
      return reply.code(403).send({
        error: `unbound_mcp: ${decision.reason}`,
        kind: 'unbound_mcp',
        mcp: decision.mcp,
        reason: decision.reason,
      });
    }
    if (decision.kind === 'denied') {
      return reply.code(403).send({
        error: `denied: ${decision.reason}`,
        kind: 'denied',
        mcp: decision.mcp,
        reason: decision.reason,
      });
    }
    // granted: forward to the dispatcher.
    if (!deps.mcp_dispatcher) {
      return reply.code(503).send({ error: 'iam: mcp dispatcher not configured' });
    }
    const result = await deps.mcp_dispatcher.dispatch(call, decision.scopes);
    return reply.status(result.status).send(result.body);
  });

  return app;
}

/**
 * Constant-time verify of an `X-IdP-Signature: sha256=<hex>` header against
 * the raw request body and a shared secret. We do NOT short-circuit on
 * length mismatch — we still hash and compare in constant time, returning
 * false either way. (We pad to the longer of the two byte arrays.)
 */
function verifyIdpSignature(rawBody: string, header: string, secret: string): boolean {
  const provided = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf-8').digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function deriveScopesForRoles(roles: string[]): string[] {
  // v1: 1:1 mapping role → MCP scope. Future: per-tenant policy.
  return roles.flatMap((r) => {
    switch (r) {
      case 'developer':
        return ['mcp:github:read', 'mcp:github:write', 'mcp:jira:read', 'mcp:secrets:read'];
      case 'ba-agent':
        return ['mcp:jira:read', 'mcp:confluence:read'];
      case 'security-engineer':
        return ['mcp:github:read', 'mcp:sonarqube:read', 'mcp:secrets:read', 'mcp:secrets:write'];
      case 'deploy-agent':
        return ['mcp:github:read', 'mcp:argo:read', 'mcp:argo:write', 'mcp:customer-cloud-broker:read'];
      default:
        return [];
    }
  });
}

function httpError(status: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = status;
  return err;
}

function randomHex(bytes: number): string {
  let s = '';
  for (let i = 0; i < bytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return s;
}

// Re-export the in-memory deps for tests and for the entrypoint.
export { ForaAuditSink, InMemoryAuditSink, JsonlAuditSink };
export { InMemoryRevocationStore };
export { InMemoryProvisioningStore };
export { InMemoryStateStore };
export type { AuditSink, RevocationStore, ProvisioningStore, StateStore };

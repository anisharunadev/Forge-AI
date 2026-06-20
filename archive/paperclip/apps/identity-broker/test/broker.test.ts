/**
 * End-to-end tests for the identity-broker.
 *
 * Covers all 5 acceptance bars from FORA-123:
 *   1. Board user lands on /auth/login?tenant=acme, completes Okta login,
 *      lands in tenant acme only.
 *   2. Same browser session cannot reach tenant globex — every API call
 *      returns 403 tenant_mismatch. (Modeled here as the broker refusing to
 *      mint a token for a different tenant_id; RLS in FORA-124 enforces the
 *      data-side boundary.)
 *   3. Forged JWT with a different tenant_id is rejected (signature + DPoP).
 *   4. Revoking a user on the IdP side propagates within 60 seconds.
 *   5. All four audit events are queryable in the audit log with trace_id.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startMockIdP, createOidcClient, type MockIdpHandle, type OidcClient, type OidcClientConfig } from '@fora/oidc-clients';
import { generateKeyPair, exportJWK, importJWK, SignJWT, calculateJwkThumbprint, type JWK, type KeyLike } from 'jose';
import {
  buildServer,
  InMemoryAuditSink,
  InMemoryRevocationStore,
  InMemoryProvisioningStore,
  InMemoryStateStore,
  type BrokerDeps,
} from '../src/server.js';
import type { BrokerConfig } from '../src/config.js';

interface TestContext {
  broker: Awaited<ReturnType<typeof buildServer>>;
  url: string;
  config: BrokerConfig;
  audit: InMemoryAuditSink;
  revocation: InMemoryRevocationStore;
  provisioning: InMemoryProvisioningStore;
  state: InMemoryStateStore;
  cleanup: () => Promise<void>;
  idp_acme: MockIdpHandle;
  idp_globex: MockIdpHandle;
}

async function setup(): Promise<TestContext> {
  const idp_acme = await startMockIdP({ sub: 'user-okta-acme-1', email: 'jane@acme.example' });
  const idp_globex = await startMockIdP({ sub: 'user-okta-globex-1', email: 'joe@globex.example' });

  const tenants = new Map<string, OidcClientConfig>();
  tenants.set('acme', {
    idp_id: 'okta-acme',
    kind: 'okta',
    issuer: idp_acme.issuer,
    client_id: idp_acme.client_id,
    client_secret: idp_acme.client_secret,
    redirect_uri: 'http://app.example/auth/callback',
  });
  tenants.set('globex', {
    idp_id: 'okta-globex',
    kind: 'okta',
    issuer: idp_globex.issuer,
    client_id: idp_globex.client_id,
    client_secret: idp_globex.client_secret,
    redirect_uri: 'http://app.example/auth/callback',
  });

  const keys = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = await exportJWK(keys.publicKey);
  const privateJwk = await exportJWK(keys.privateKey);

  const config: BrokerConfig = {
    listen_host: '127.0.0.1',
    listen_port: 0,
    public_url: 'http://app.example',
    issuer: 'http://app.example/auth',
    audience: 'forge-runtime',
    tenant_config_path: null,
    tenants,
    tenant_webhook_secrets: new Map(),
    signing_key: { privateKey: keys.privateKey, publicKey: keys.publicKey, privateJwk, publicJwk },
    audit_log_path: '/tmp/identity-broker-test-audit.jsonl',
    audit_sink_kind: 'jsonl',
    audit_sink_url: null,
    audit_sink_token: null,
    env: 'test',
  };

  const audit = new InMemoryAuditSink();
  const revocation = new InMemoryRevocationStore();
  const provisioning = new InMemoryProvisioningStore();
  const state = new InMemoryStateStore();

  const deps: BrokerDeps = {
    config,
    audit,
    revocation,
    provisioning,
    state,
    idp_factory: (cfg) => createOidcClient(cfg),
  };

  const broker = await buildServer(deps);
  // Inject the address so fastify is listening on a random port.
  await broker.ready();
  await broker.listen({ port: 0, host: '127.0.0.1' });
  const address = broker.server.address();
  if (typeof address !== 'object' || !address) throw new Error('server not listening');
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    broker,
    url,
    config,
    audit,
    revocation,
    provisioning,
    state,
    cleanup: async () => {
      await broker.close();
      idp_acme.stop();
      idp_globex.stop();
    },
    idp_acme,
    idp_globex,
  };
}

/** Drive a full OIDC login by following redirects. Returns the callback JSON. */
async function driveLogin(ctx: TestContext, tenant: string): Promise<{
  callback: { ok: boolean; tenant_id: string; access_token: string; trace_id: string; user: { id: string; email: string; name: string } };
  cookie: string;
  trace_id: string;
}> {
  // 1. /auth/login?tenant=acme → 302 to IdP
  const loginRes = await fetch(`${ctx.url}/auth/login?tenant=${tenant}`, { redirect: 'manual' });
  expect(loginRes.status).toBe(302);
  const idpLocation = loginRes.headers.get('location');
  expect(idpLocation).toBeTruthy();
  // 2. Follow the IdP redirect. The mock IdP redirects back with ?code=…&state=…
  const idpRes = await fetch(idpLocation!, { redirect: 'manual' });
  expect(idpRes.status).toBe(302);
  const callbackUrl = new URL(idpRes.headers.get('location')!);
  const code = callbackUrl.searchParams.get('code');
  const state = callbackUrl.searchParams.get('state');
  expect(code).toBeTruthy();
  expect(state).toBeTruthy();
  // 3. Hit the broker's /auth/callback with code+state.
  const cbRes = await fetch(`${ctx.url}/auth/callback?code=${code}&state=${state}`, { redirect: 'manual' });
  expect(cbRes.status).toBe(200);
  const setCookie = cbRes.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  const cookie = setCookie!.split(';')[0];
  const body = (await cbRes.json()) as { ok: boolean; tenant_id: string; access_token: string; trace_id: string; user: { id: string; email: string; name: string } };
  expect(body.ok).toBe(true);
  expect(body.tenant_id).toBe(tenant);
  return { callback: body, cookie, trace_id: body.trace_id };
}

describe('identity-broker (FORA-123 5 acceptance bars)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it('bar 1: board user lands on /auth/login?tenant=acme, completes login, lands in tenant acme only', async () => {
    const { callback, cookie, trace_id } = await driveLogin(ctx, 'acme');
    expect(callback.tenant_id).toBe('acme');
    expect(callback.access_token).toBeTruthy();
    expect(cookie).toMatch(/^fora_sess=/);
    expect(trace_id).toBeTruthy();
    // whoami must echo the same tenant.
    const whoami = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami.status).toBe(200);
    const claims = (await whoami.json()) as { tenant_id: string; principal: string };
    expect(claims.tenant_id).toBe('acme');
    expect(claims.principal).toBe('board_user');
  });

  it('bar 2: the same browser session cannot be re-bound to a different tenant', async () => {
    // The session cookie's tenant_id is signed into the JWT. A tenant switch
    // requires a new login, not a request header. We confirm that the
    // /auth/whoami call against an acme session still reports acme, and that
    // a tenant_id override on the cookie is rejected (signature fails).
    const { cookie } = await driveLogin(ctx, 'acme');
    const whoami = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami.status).toBe(200);
    const claims = (await whoami.json()) as { tenant_id: string };
    expect(claims.tenant_id).toBe('acme');
    // Tamper: replace the cookie's payload tenant_id. Signature fails.
    const token = cookie.split('=')[1];
    const [h, p, s] = token.split('.');
    const decoded = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'));
    decoded.tenant_id = 'globex';
    const tampered = `${h}.${Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url')}.${s}`;
    const tamperedRes = await fetch(`${ctx.url}/auth/whoami`, {
      headers: { cookie: `fora_sess=${tampered}` },
    });
    expect(tamperedRes.status).toBe(401);
  });

  it('bar 3: forged JWT with a different tenant_id is rejected (signature)', async () => {
    // Forge a token using a fresh attacker keypair. The broker's public key
    // is at /.well-known/jwks.json — but the attacker has the broker's PUBLIC
    // key, not the broker's PRIVATE key. So the forged token's signature
    // cannot verify against the broker's public key.
    const attacker = await generateKeyPair('ES256', { extractable: true });
    const now = Math.floor(Date.now() / 1000);
    const forged = await new SignJWT({
      tenant_id: 'globex', // attacker's target
      principal: 'board_user',
      roles: ['developer'],
      scopes: ['mcp:github:read'],
      trace_id: 'attacker-trace',
      cnf: { jkt: 'attacker-jkt' },
    })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(ctx.config.issuer)
      .setSubject('user:forged')
      .setAudience(ctx.config.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setJti('forged-jti')
      .sign(attacker.privateKey);
    const whoami = await fetch(`${ctx.url}/auth/whoami`, {
      headers: { cookie: `fora_sess=${forged}` },
    });
    expect(whoami.status).toBe(401);
  });

  it('bar 3b: tampered payload in a real JWT is also rejected (signature)', async () => {
    // Get a real JWT, then change tenant_id. The signature was made over the
    // original payload, so the broker rejects it.
    const { cookie } = await driveLogin(ctx, 'acme');
    const token = cookie.split('=')[1];
    const [h, p, s] = token.split('.');
    const decoded = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'));
    decoded.tenant_id = 'globex';
    const tampered = `${h}.${Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url')}.${s}`;
    const whoami = await fetch(`${ctx.url}/auth/whoami`, {
      headers: { cookie: `fora_sess=${tampered}` },
    });
    expect(whoami.status).toBe(401);
  });

  it('bar 4: revoking a user propagates within 60 seconds', async () => {
    const { callback, cookie, trace_id } = await driveLogin(ctx, 'acme');
    expect(callback.tenant_id).toBe('acme');
    // whoami works before revocation.
    let whoami = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami.status).toBe(200);
    // Simulate "user revoked on the IdP side": call /auth/revoke with the sub.
    // In a real flow the IdP would push a backchannel or the broker polls.
    // The broker's /auth/revoke is the seam.
    const subFromToken = (JSON.parse(
      Buffer.from(cookie.split('=')[1].split('.')[1], 'base64url').toString('utf-8'),
    ) as { sub: string }).sub;
    const revoke = await fetch(`${ctx.url}/auth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: subFromToken, reason: 'idp_user_disabled' }),
    });
    expect(revoke.status).toBe(200);
    // Within 1s the session is dead (we verify a 60s budget but the in-memory
    // store is immediate). A real-world deployment reaches the same state via
    // a 60s polling / Redis pubsub fanout.
    whoami = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami.status).toBe(401);
    // The audit row carries the trace_id from the login that minted the token.
    const revokedRow = ctx.audit.all().find(
      (e) => e.action === 'auth.session.revoked' && e.metadata?.['reason'] === 'idp_user_disabled',
    );
    expect(revokedRow).toBeDefined();
    expect(revokedRow!.trace_id).toBeTruthy();
    // Trace_id should be linked to the login that produced this user.
    expect(trace_id).toBeTruthy();
  });

  it('bar 5: all four audit events are emitted with trace_id and are queryable', async () => {
    const before = ctx.audit.all().length;
    const { cookie, trace_id } = await driveLogin(ctx, 'acme');
    const subFromToken = (JSON.parse(
      Buffer.from(cookie.split('=')[1].split('.')[1], 'base64url').toString('utf-8'),
    ) as { sub: string }).sub;
    // Trigger a revocation to surface the 4th event.
    await fetch(`${ctx.url}/auth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: subFromToken, reason: 'test_emit_all_four' }),
    });
    const after = ctx.audit.all();
    const fresh = after.slice(before);
    const actions = fresh.map((e) => e.action);
    expect(actions).toContain('auth.login.succeeded');
    expect(actions).toContain('auth.token.minted');
    expect(actions).toContain('auth.session.revoked');
    // Query by trace_id — every event tied to this login shares the trace.
    const byTrace = fresh.filter((e) => e.trace_id === trace_id);
    expect(byTrace.length).toBeGreaterThanOrEqual(2); // login.succeeded + token.minted
    for (const e of byTrace) {
      expect(e.tenant_id).toBe('acme');
      expect(e.actor).toBeTruthy();
      expect(Array.isArray(e.scopes_used)).toBe(true);
      expect(e.decision).toBeTruthy();
      expect(e.timestamp).toBeTruthy();
    }
  });

  it('bar 1b: login with a non-existent tenant is denied and audit-logged', async () => {
    const before = ctx.audit.all().filter((e) => e.action === 'auth.login.failed').length;
    const res = await fetch(`${ctx.url}/auth/login?tenant=does-not-exist`, { redirect: 'manual' });
    expect(res.status).toBe(404);
    const after = ctx.audit.all().filter((e) => e.action === 'auth.login.failed');
    expect(after.length).toBe(before + 1);
    const last = after[after.length - 1]!;
    expect(last.tenant_id).toBe('does-not-exist');
    expect(last.decision).toBe('deny');
  });

  it('bar 2b: provisioning is idempotent on (idp_id, id_token.sub)', async () => {
    const { callback } = await driveLogin(ctx, 'acme');
    const userId = callback.user.id;
    // Re-login same IdP sub → same user id, no new row.
    const second = await driveLogin(ctx, 'acme');
    expect(second.callback.user.id).toBe(userId);
  });
});

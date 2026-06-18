/**
 * Tests for the per-tenant IdP revocation webhook (FORA-161 / 0.7.1c).
 *
 * FORA-123 acceptance bar #4: "Revoking a user on the IdP side propagates:
 * existing sessions stop working within 60 seconds." The webhook is the
 * automatic seam; the /auth/revoke admin endpoint is the manual seam.
 *
 * Each test:
 *   - Builds a fresh broker with two tenants, each with its own webhook
 *     secret. (A fresh revocation store is required because revoke_by_sub
 *     persists for 24h — sharing one across cases would let earlier
 *     revocations poison later ones.)
 *   - Drives a full OIDC login to mint a session cookie.
 *   - Builds a signed `user.disabled` event and POSTs it to /auth/idp-revoke.
 *   - Asserts: 60s-budget whoami is now 401, the audit row exists, tampered
 *     payloads return 401 with an audit row.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { startMockIdP, createOidcClient, type MockIdpHandle, type OidcClientConfig } from '@fora/oidc-clients';
import { generateKeyPair, exportJWK } from 'jose';
import {
  buildServer,
  InMemoryAuditSink,
  InMemoryRevocationStore,
  InMemoryProvisioningStore,
  InMemoryStateStore,
  type BrokerDeps,
} from '../src/server.js';
import type { BrokerConfig } from '../src/config.js';

const ACME_WEBHOOK_SECRET = 'acme-shared-secret-do-not-log-please-rotate';
const GLOBEX_WEBHOOK_SECRET = 'globex-shared-secret-different-from-acme';

interface WebhookTestContext {
  broker: Awaited<ReturnType<typeof buildServer>>;
  url: string;
  config: BrokerConfig;
  audit: InMemoryAuditSink;
  revocation: InMemoryRevocationStore;
  cleanup: () => Promise<void>;
  idp_acme: MockIdpHandle;
  idp_globex: MockIdpHandle;
}

async function setupFresh(): Promise<WebhookTestContext> {
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

  const tenant_webhook_secrets = new Map<string, string>([
    ['acme', ACME_WEBHOOK_SECRET],
    ['globex', GLOBEX_WEBHOOK_SECRET],
  ]);

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
    tenant_webhook_secrets,
    signing_key: { privateKey: keys.privateKey, publicKey: keys.publicKey, privateJwk, publicJwk },
    audit_log_path: '/tmp/identity-broker-test-audit-webhook.jsonl',
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
    cleanup: async () => {
      await broker.close();
      idp_acme.stop();
      idp_globex.stop();
    },
    idp_acme,
    idp_globex,
  };
}

async function driveLogin(ctx: WebhookTestContext, tenant: string): Promise<{
  cookie: string;
  trace_id: string;
  idp_sub: string;
}> {
  const loginRes = await fetch(`${ctx.url}/auth/login?tenant=${tenant}`, { redirect: 'manual' });
  expect(loginRes.status).toBe(302);
  const idpLocation = loginRes.headers.get('location');
  expect(idpLocation).toBeTruthy();
  const idpRes = await fetch(idpLocation!, { redirect: 'manual' });
  expect(idpRes.status).toBe(302);
  const callbackUrl = new URL(idpRes.headers.get('location')!);
  const code = callbackUrl.searchParams.get('code');
  const state = callbackUrl.searchParams.get('state');
  expect(code).toBeTruthy();
  expect(state).toBeTruthy();
  const cbRes = await fetch(`${ctx.url}/auth/callback?code=${code}&state=${state}`, { redirect: 'manual' });
  expect(cbRes.status).toBe(200);
  const setCookie = cbRes.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  const cookie = setCookie!.split(';')[0];
  const body = (await cbRes.json()) as { trace_id: string };
  const idpSub = (() => {
    const token = cookie.split('=')[1];
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8')) as { sub: string };
    return payload.sub;
  })();
  return { cookie, trace_id: body.trace_id, idp_sub: idpSub };
}

function signIdpWebhook(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf-8').digest('hex');
}

async function postIdpRevoke(
  ctx: WebhookTestContext,
  body: Record<string, unknown>,
  opts: { secret?: string; tamper?: boolean; missingSig?: boolean } = {},
): Promise<Response> {
  const raw = JSON.stringify(body);
  const tenantId = String(body.tenant_id ?? '');
  const secret = opts.secret ?? ctx.config.tenant_webhook_secrets.get(tenantId) ?? 'wrong-secret';
  let sig: string | null;
  if (opts.missingSig) {
    sig = null;
  } else if (opts.tamper) {
    // Sign a different body so the signature does not match.
    sig = signIdpWebhook(raw + ' ', secret);
  } else {
    sig = signIdpWebhook(raw, secret);
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== null) headers['x-idp-signature'] = sig;
  return fetch(`${ctx.url}/auth/idp-revoke`, {
    method: 'POST',
    headers,
    body: raw,
  });
}

describe('identity-broker /auth/idp-revoke (FORA-161, FORA-123 bar #4)', () => {
  let ctx: WebhookTestContext;
  beforeEach(async () => {
    ctx = await setupFresh();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('signed user.disabled event kills the session within the 60s budget', async () => {
    const { cookie } = await driveLogin(ctx, 'acme');
    let whoami = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami.status).toBe(200);
    const res = await postIdpRevoke(ctx, {
      event: 'user.disabled',
      subject: 'user-okta-acme-1',
      tenant_id: 'acme',
      idp_issued_at: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; revoked_sub: string };
    expect(body.ok).toBe(true);
    expect(body.revoked_sub).toBe('user:user-okta-acme-1');
    whoami = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami.status).toBe(401);
    const revoked = ctx.audit.all().find(
      (e) => e.action === 'auth.session.revoked' && e.metadata?.['kind'] === 'idp_webhook',
    );
    expect(revoked).toBeDefined();
    expect(revoked!.tenant_id).toBe('acme');
    expect(revoked!.metadata?.['event']).toBe('user.disabled');
    expect(revoked!.metadata?.['subject']).toBe('user-okta-acme-1');
  });

  it('tampered payload returns 401 with an audit row', async () => {
    const { cookie } = await driveLogin(ctx, 'acme');
    const res = await postIdpRevoke(
      ctx,
      {
        event: 'user.deleted',
        subject: 'attacker-controlled-sub',
        tenant_id: 'acme',
      },
      { tamper: true },
    );
    expect(res.status).toBe(401);
    const whoami = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami.status).toBe(200);
    const failed = ctx.audit.all().find(
      (e) =>
        e.action === 'auth.login.failed' &&
        e.metadata?.['reason'] === 'webhook_signature_mismatch' &&
        e.metadata?.['kind'] === 'idp_webhook',
    );
    expect(failed).toBeDefined();
    expect(failed!.decision).toBe('deny');
  });

  it('missing X-IdP-Signature header returns 401 with an audit row', async () => {
    const res = await postIdpRevoke(
      ctx,
      { event: 'user.disabled', subject: 'user-okta-acme-1', tenant_id: 'acme' },
      { missingSig: true },
    );
    expect(res.status).toBe(401);
    const failed = ctx.audit.all().find(
      (e) => e.action === 'auth.login.failed' && e.metadata?.['reason'] === 'webhook_signature_mismatch',
    );
    expect(failed).toBeDefined();
  });

  it('wrong-secret signature returns 401 with an audit row', async () => {
    const res = await postIdpRevoke(
      ctx,
      { event: 'user.disabled', subject: 'user-okta-acme-1', tenant_id: 'acme' },
      { secret: GLOBEX_WEBHOOK_SECRET },
    );
    expect(res.status).toBe(401);
    const failed = ctx.audit.all().find(
      (e) =>
        e.action === 'auth.login.failed' &&
        e.metadata?.['reason'] === 'webhook_signature_mismatch' &&
        e.tenant_id === 'acme',
    );
    expect(failed).toBeDefined();
  });

  it('tenant_id not configured for the broker returns 401 with an audit row', async () => {
    const res = await postIdpRevoke(
      ctx,
      { event: 'user.disabled', subject: 'whoever', tenant_id: 'unconfigured-tenant' },
    );
    expect(res.status).toBe(401);
    const failed = ctx.audit.all().find(
      (e) =>
        e.action === 'auth.login.failed' &&
        e.metadata?.['reason'] === 'webhook_signature_mismatch' &&
        e.tenant_id === 'unconfigured-tenant',
    );
    expect(failed).toBeDefined();
  });

  it('user.deleted event also revokes (parity with user.disabled)', async () => {
    const { cookie } = await driveLogin(ctx, 'acme');
    const whoami0 = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami0.status).toBe(200);
    const res = await postIdpRevoke(ctx, {
      event: 'user.deleted',
      subject: 'user-okta-acme-1',
      tenant_id: 'acme',
    });
    expect(res.status).toBe(200);
    const whoami1 = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami1.status).toBe(401);
    const lastRevoke = [...ctx.audit.all()]
      .reverse()
      .find((e) => e.action === 'auth.session.revoked' && e.metadata?.['kind'] === 'idp_webhook');
    expect(lastRevoke?.metadata?.['event']).toBe('user.deleted');
  });

  it('session.revoked event also revokes (parity with user.disabled)', async () => {
    const { cookie } = await driveLogin(ctx, 'acme');
    const whoami0 = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami0.status).toBe(200);
    const res = await postIdpRevoke(ctx, {
      event: 'session.revoked',
      subject: 'user-okta-acme-1',
      tenant_id: 'acme',
    });
    expect(res.status).toBe(200);
    const whoami1 = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie } });
    expect(whoami1.status).toBe(401);
    const lastRevoke = [...ctx.audit.all()]
      .reverse()
      .find((e) => e.action === 'auth.session.revoked' && e.metadata?.['kind'] === 'idp_webhook');
    expect(lastRevoke?.metadata?.['event']).toBe('session.revoked');
  });

  it('webhook for tenant A cannot revoke a session that was minted by tenant B', async () => {
    const acmeLogin = await driveLogin(ctx, 'acme');
    const res = await postIdpRevoke(ctx, {
      event: 'user.disabled',
      subject: 'user-okta-globex-1',
      tenant_id: 'acme', // signed with acme's secret
    });
    expect(res.status).toBe(200);
    const whoami = await fetch(`${ctx.url}/auth/whoami`, { headers: { cookie: acmeLogin.cookie } });
    expect(whoami.status).toBe(200);
  });
});

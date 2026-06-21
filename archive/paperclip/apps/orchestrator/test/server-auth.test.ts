/**
 * FORA-526 — Fastify preHandler JWT hook tests.
 *
 * Covers the server-side surface of the v1.1 auth model (ADR-0003 §4.2
 * amendment, FORA-526 AC #2 + AC #5):
 *
 *   1. Missing `Authorization` header on a protected route → 401 with
 *      `error.code = 'VALIDATION'`.
 *   2. `Authorization: Bearer <tampered>` on a protected route → 401
 *      with `error.code = 'VALIDATION'`.
 *   3. `Authorization: Bearer <valid>` on a protected route → past
 *      the hook (the next gate is the Idempotency-Key check, which
 *      returns 400 — proof the hook stamped the principal and let the
 *      request through).
 *   4. `/healthz` is unauthenticated by design, even when
 *      `requireJwt = true`.
 *   5. `FORA_REQUIRE_JWT=false` opt-out: the legacy
 *      `x-fora-tenant-id` header is honoured and the hook is bypassed
 *      (LOCAL DEV ONLY).
 *
 * The tests stand up a real `buildServer` with a tiny in-process JWKS
 * server, a stub `JwtValidator`, and a minimal in-memory Pool shim so
 * the protected route's `requireTenant` → `requireIdempotencyKey`
 * chain runs end-to-end. The DB call is short-circuited by sending
 * a request shape that fails the next gate (missing
 * `Idempotency-Key`) — the 400 VALIDATION we see is from the
 * Idempotency-Key helper, NOT from the JWT hook.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
  type KeyLike,
} from 'jose';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import type { Pool } from 'pg';

import { buildServer, type OrchestratorDeps } from '../src/server.js';
import { JwtValidator } from '../src/jwt-validator.js';
import type { OrchestratorConfig } from '../src/config.js';
import type { ApprovalsRepo, EventBus, Pager, PaperclipClient, Clock } from '../src/index.js';
import type { ApprovalRecord } from '../src/approvals-repo-pg.js';

const ISSUER = 'identity-broker.fora.local';
const AUDIENCE = 'forge-runtime';
// The legacy `x-fora-tenant-id` header is validated as UUID v4 at the
// boundary (see `defaultExtractTenant`); use a real UUID for both
// the JWT and the legacy-header paths so the test exercises the
// happy fallback, not the UUID-format 401.
const TENANT_ID = '8e1c2b4a-0000-4000-8000-000000000001';

interface TestEnv {
  privateKey: KeyLike;
  publicJwk: JWK;
  jwksServer: Server;
  jwksUrl: string;
}

let env: TestEnv;
let jwtValidator: JwtValidator;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'server-auth-test';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';

  const jwksServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/.well-known/jwks.json') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const port = (jwksServer.address() as AddressInfo).port;
  const jwksUrl = `http://127.0.0.1:${port}/.well-known/jwks.json`;
  env = { privateKey, publicJwk, jwksServer, jwksUrl };

  jwtValidator = new JwtValidator({
    jwksUrl,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}, 20_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    env.jwksServer.close((err) => (err ? reject(err) : resolve())),
  );
});

// ---------------------------------------------------------------------------
// Pool / approvals stubs — the hook is the unit under test, so we use the
// smallest possible stubs that let the protected route's next gate
// (Idempotency-Key) fire.
// ---------------------------------------------------------------------------

const stubPool = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: async (..._args: any[]) => ({ rows: [], rowCount: 0 }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }),
} as unknown as Pool;

const stubApprovals = {
  repo: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    find: async (..._args: any[]): Promise<ApprovalRecord | null> => null,
  } as unknown as ApprovalsRepo,
  paperclip: {} as PaperclipClient,
  bus: {} as EventBus,
  pager: {} as Pager,
  clock: { now: () => new Date() } as unknown as Clock,
};

function buildConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: 'postgres://stub',
    defaultCostCeilingUsd: '100.00',
    logLevel: 'info',
    env: 'test',
    jwtVerifierUrl: env.jwksUrl,
    jwtIssuer: ISSUER,
    jwtAudience: AUDIENCE,
    requireJwt: true,
    jwtClockToleranceSec: 0,
    ...overrides,
  };
}

async function mintToken(opts: { tenantId?: string; expOffsetSec?: number } = {}): Promise<string> {
  const tenantId = opts.tenantId ?? TENANT_ID;
  const expOffsetSec = opts.expOffsetSec ?? 600;
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    sub: `user:tester@fora.local`,
    tenant_id: tenantId,
    principal: 'board_user',
    roles: ['developer'],
    scopes: ['mcp:github:read'],
    trace_id: '01HXYZ_TEST_TRACE',
    cnf: { jkt: 'test-thumbprint' },
  })
    .setProtectedHeader({ alg: 'ES256', kid: env.publicJwk.kid ?? 'server-auth-test' })
    .setIssuedAt(now)
    .setExpirationTime(now + expOffsetSec)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject('user:tester@fora.local')
    .setJti(`jti-${now}`)
    .sign(env.privateKey);
}

interface BuildOpts {
  requireJwt?: boolean;
  injectValidator?: JwtValidator;
}

async function buildTestServer(opts: BuildOpts = {}): Promise<ReturnType<typeof buildServer>> {
  const deps: OrchestratorDeps = {
    config: buildConfig({ requireJwt: opts.requireJwt ?? true }),
    pool: stubPool,
    approvals: stubApprovals,
    jwtValidator: opts.injectValidator ?? jwtValidator,
  };
  return await buildServer(deps);
}

describe('server.ts Fastify JWT hook — FORA-526 AC #2 + AC #5', () => {
  it('AC#5 — missing Authorization header on a protected route returns 401 VALIDATION', async () => {
    const app = await buildTestServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      payload: { goal_id: 'g', project_id: 'p' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toMatch(/authorization/i);
    await app.close();
  });

  it('AC#5 — tampered Authorization header returns 401 VALIDATION', async () => {
    const app = await buildTestServer();
    // A token signed with a different key — verifier cannot trust it.
    const { privateKey: rogueKey } = await generateKeyPair('ES256');
    const now = Math.floor(Date.now() / 1000);
    const rogueToken = await new SignJWT({
      sub: 'user:attacker',
      tenant_id: TENANT_ID,
      principal: 'board_user',
      roles: ['developer'],
      scopes: ['mcp:github:read'],
      trace_id: '01HXYZ_ROGUE',
      cnf: { jkt: 'rogue' },
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'rogue' })
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('user:attacker')
      .setJti('jti-rogue')
      .sign(rogueKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${rogueToken}` },
      payload: { goal_id: 'g', project_id: 'p' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    // The discrete failure code is server-side log only; the wire
    // message is a single bucket. ADR-0003 v1.1 §6 confirms this.
    await app.close();
  });

  it('AC#2 — valid Authorization header lets the request past the JWT hook', async () => {
    const app = await buildTestServer();
    const token = await mintToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { goal_id: 'g', project_id: 'p' },
    });
    // The hook stamped the principal; the next gate (Idempotency-Key)
    // returns 400 VALIDATION. The important signal is the status code:
    // 400 means the JWT check passed and a downstream gate fired.
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
    await app.close();
  });

  it('AC#2 — /healthz is unauthenticated even when requireJwt=true', async () => {
    const app = await buildTestServer({ requireJwt: true });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('orchestrator');
    await app.close();
  });

  it('AC#4 — FORA_REQUIRE_JWT=false falls back to the legacy x-fora-tenant-id header', async () => {
    const app = await buildTestServer({ requireJwt: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT_ID },
      payload: { goal_id: 'g', project_id: 'p' },
    });
    // Same shape as the valid-JWT test: 400 VALIDATION from the
    // Idempotency-Key helper, not 401. Proves the legacy header was
    // honoured.
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
    await app.close();
  });

  it('AC#4 — FORA_REQUIRE_JWT=false + missing legacy header still returns 401', async () => {
    // The dev opt-out does not disable auth; it just changes the
    // header that the extractor reads. A request with NEITHER the
    // JWT nor the legacy header still fails.
    const app = await buildTestServer({ requireJwt: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      payload: { goal_id: 'g', project_id: 'p' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
    await app.close();
  });

  it('AC#2 — expired token returns 401 VALIDATION', async () => {
    const app = await buildTestServer();
    const token = await mintToken({ expOffsetSec: -120 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { goal_id: 'g', project_id: 'p' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
    await app.close();
  });
});

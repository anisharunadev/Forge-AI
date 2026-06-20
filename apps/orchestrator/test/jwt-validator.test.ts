/**
 * FORA-526 — JwtValidator unit tests.
 *
 * Covers the four failure modes named in the AC (#5):
 *   1. valid token → typed JwtPrincipal
 *   2. expired token → JwtError 'EXPIRED'
 *   3. tampered token → JwtError 'TAMPERED'
 *   4. wrong-tenant token → JwtError 'WRONG_TENANT'
 *
 * The tests stand up a tiny in-process HTTP server that serves a JWKS
 * document for an ES256 key generated in the test; this exercises the
 * real `createRemoteJWKSet` path that production uses (per
 * ADR-0003 v1.1 §2.3) without requiring a live identity-broker.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  type JWK,
  type KeyLike,
} from 'jose';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

import { JwtError, JwtValidator } from '../src/jwt-validator.js';

const ISSUER = 'identity-broker.fora.local';
const AUDIENCE = 'forge-runtime';

interface TestEnv {
  privateKey: KeyLike;
  publicJwk: JWK;
  server: Server;
  url: string;
}

let env: TestEnv;

beforeAll(async () => {
  // Generate a fresh ES256 keypair per test file so the kid is unique
  // and the test is hermetic.
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';

  // Tiny HTTP server that serves the JWKS document at the standard
  // `/.well-known/jwks.json` path. The server is closed in `afterAll`.
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/.well-known/jwks.json') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  env = { privateKey, publicJwk, server, url: `http://127.0.0.1:${port}` };
}, 20_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    env.server.close((err) => (err ? reject(err) : resolve())),
  );
});

function makeValidator(opts: { clockToleranceSec?: number } = {}): JwtValidator {
  return new JwtValidator({
    jwksUrl: `${env.url}/.well-known/jwks.json`,
    issuer: ISSUER,
    audience: AUDIENCE,
    ...(opts.clockToleranceSec !== undefined
      ? { clockToleranceSec: opts.clockToleranceSec }
      : {}),
  });
}

interface MintOpts {
  tenantId?: string;
  actorId?: string;
  expOffsetSec?: number; // seconds from now; negative = past
  claims?: Record<string, unknown>;
  tamper?: 'wrong-key' | 'swap-aud' | 'no-tenant' | 'bad-claim';
}

async function mintToken(opts: MintOpts = {}): Promise<string> {
  const tenantId = opts.tenantId ?? 'tnt_8XQ000000000000000000000';
  const actorId = opts.actorId ?? 'user:tester@fora.local';
  const expOffsetSec = opts.expOffsetSec ?? 600; // 10 min
  const now = Math.floor(Date.now() / 1000);

  // Build the claim set; only include fields that aren't tampered with.
  const base: Record<string, unknown> = {
    sub: actorId,
    tenant_id: tenantId,
    principal: 'board_user',
    roles: ['developer'],
    scopes: ['mcp:github:read'],
    trace_id: '01HXYZ_TEST_TRACE',
    cnf: { jkt: 'test-thumbprint' },
    iat: now,
    jti: `jti-${now}-${Math.random().toString(36).slice(2)}`,
    ...opts.claims,
  };

  // For the swap-aud tamper, we sign with a different audience. jose
  // would still emit the `aud` we pass, so we pass our swapped value.
  const aud = opts.tamper === 'swap-aud' ? 'wrong-audience' : AUDIENCE;
  base.iss = ISSUER;
  base.aud = aud;

  // EXPIRED tamper: set exp to the past, but keep iat in the past too.
  const exp = now + expOffsetSec;
  if (expOffsetSec < 0) {
    base.iat = now - 3600;
  }

  // The `no-tenant` tamper drops `tenant_id` from the claim set.
  const claims = opts.tamper === 'no-tenant' ? { ...base } : base;
  if (opts.tamper === 'no-tenant') delete (claims as Record<string, unknown>)['tenant_id'];

  const key =
    opts.tamper === 'wrong-key'
      ? // A SECOND keypair, used to sign a token the validator
        // cannot verify. Generated lazily so the test stays hermetic.
        await (async () => (await generateKeyPair('ES256')).privateKey)()
      : env.privateKey;

  return await new SignJWT(claims as Record<string, unknown>)
    .setProtectedHeader({ alg: 'ES256', kid: env.publicJwk.kid ?? 'test-key-1' })
    .setIssuedAt(base.iat as number)
    .setExpirationTime(exp)
    .setIssuer(base.iss as string)
    .setAudience(base.aud as string)
    .setSubject(base.sub as string)
    .setJti(base.jti as string)
    .sign(key);
}

describe('JwtValidator — FORA-526 AC#5', () => {
  it('AC#5.1 — verifies a valid token and returns the typed principal', async () => {
    const v = makeValidator();
    const token = await mintToken();
    const principal = await v.verify(token);
    expect(principal.tenantId).toBe('tnt_8XQ000000000000000000000');
    expect(principal.actorId).toBe('user:tester@fora.local');
    expect(principal.principal).toBe('board_user');
    expect(principal.role).toBe('developer');
    expect(principal.scopes).toEqual(['mcp:github:read']);
    expect(principal.traceId).toBe('01HXYZ_TEST_TRACE');
    expect(principal.jti).toMatch(/^jti-/);
    expect(typeof principal.exp).toBe('number');
  });

  it('AC#5.2 — expired token throws JwtError with code EXPIRED', async () => {
    const v = makeValidator();
    const token = await mintToken({ expOffsetSec: -120 }); // 2 min ago
    let caught: unknown;
    try {
      await v.verify(token);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(JwtError);
    expect((caught as JwtError).code).toBe('EXPIRED');
    expect((caught as JwtError).claim).toBe('exp');
  });

  it('AC#5.3 — tampered signature throws JwtError with code TAMPERED', async () => {
    const v = makeValidator();
    const token = await mintToken({ tamper: 'wrong-key' });
    let caught: unknown;
    try {
      await v.verify(token);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(JwtError);
    expect((caught as JwtError).code).toBe('TAMPERED');
  });

  it('AC#5.4 — token with the wrong tenant_id throws WRONG_TENANT', async () => {
    const v = makeValidator();
    const token = await mintToken({ tenantId: 'tnt_OTHER_TENANT_00000000000' });
    let caught: unknown;
    try {
      await v.verify(token, { expectedTenantId: 'tnt_8XQ000000000000000000000' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(JwtError);
    expect((caught as JwtError).code).toBe('WRONG_TENANT');
    expect((caught as JwtError).claim).toBe('tenant_id');
  });

  // --- Additional coverage the AC names but does not enumerate ---

  it('rejects a token with a swapped audience', async () => {
    const v = makeValidator();
    const token = await mintToken({ tamper: 'swap-aud' });
    let caught: unknown;
    try {
      await v.verify(token);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(JwtError);
    // jose raises JWTClaimValidationFailed for `aud` mismatch; the
    // validator maps that to INVALID.
    expect((caught as JwtError).code).toBe('INVALID');
  });

  it('rejects a token with no tenant_id claim', async () => {
    const v = makeValidator();
    const token = await mintToken({ tamper: 'no-tenant' });
    let caught: unknown;
    try {
      await v.verify(token);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(JwtError);
    expect((caught as JwtError).code).toBe('INVALID');
  });

  it('rejects an empty / non-string token', async () => {
    const v = makeValidator();
    await expect(v.verify('')).rejects.toBeInstanceOf(JwtError);
    await expect(v.verify(null as unknown as string)).rejects.toBeInstanceOf(JwtError);
    await expect(v.verify(undefined as unknown as string)).rejects.toBeInstanceOf(JwtError);
  });

  it('rejects garbage', async () => {
    const v = makeValidator();
    await expect(v.verify('not.a.jwt')).rejects.toBeInstanceOf(JwtError);
  });

  it('clockToleranceSec absorbs small skew on exp', async () => {
    // Token expired 5 seconds ago; 30-second tolerance → accepted.
    const v = makeValidator({ clockToleranceSec: 30 });
    const token = await mintToken({ expOffsetSec: -5 });
    const principal = await v.verify(token);
    expect(principal.tenantId).toBe('tnt_8XQ000000000000000000000');
  });

  it('clockToleranceSec does NOT absorb large skew on exp', async () => {
    const v = makeValidator({ clockToleranceSec: 10 });
    const token = await mintToken({ expOffsetSec: -120 });
    await expect(v.verify(token)).rejects.toMatchObject({ code: 'EXPIRED' });
  });

  it('the typed principal is what ADR-0003 v1.1 §2.3 names', async () => {
    // Smoke test: confirms the principal shape matches the ADR.
    const v = makeValidator();
    const token = await mintToken();
    const principal = await v.verify(token);
    const keys = Object.keys(principal).sort();
    expect(keys).toEqual(
      [
        'actorId',
        'exp',
        'jti',
        'principal',
        'role',
        'scopes',
        'tenantId',
        'traceId',
      ].sort(),
    );
  });

  it('round-trip: the minted token is also accepted by a raw jwtVerify (sanity)', async () => {
    // Catches drift between the test mint helper and the validator's
    // expected claim shape (the `cnf.jkt` required claim in
    // SessionClaimsSchema).
    const token = await mintToken();
    const { payload } = await jwtVerify(
      token,
      env.publicJwk as Parameters<typeof jwtVerify>[1],
      { issuer: ISSUER, audience: AUDIENCE, algorithms: ['ES256'] },
    );
    expect(payload.tenant_id).toBe('tnt_8XQ000000000000000000000');
  });
});

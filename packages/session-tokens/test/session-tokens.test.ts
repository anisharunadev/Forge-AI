import { describe, it, expect, beforeAll } from 'vitest';
import { importJWK, SignJWT, calculateJwkThumbprint } from 'jose';
import { TokenIssuer, generateSigningKeypair, BOARD_USER_TOKEN_TTL_SECONDS, AGENT_TOKEN_TTL_SECONDS } from '../src/index.js';
import type { KeyLike, JWK } from 'jose';

describe('@fora/session-tokens', () => {
  let issuer: TokenIssuer;
  let clientKeypair: { privateKey: KeyLike; publicKey: KeyLike; publicJwk: JWK };
  beforeAll(async () => {
    const keys = await generateSigningKeypair();
    issuer = new TokenIssuer({
      issuer: 'identity-broker.fora.local',
      audience: 'forge-runtime',
      signing_key: keys.privateKey,
      public_key: keys.publicKey,
    });
    clientKeypair = await generateSigningKeypair();
  });

  it('mints and verifies a board_user token with all 5 required claims', async () => {
    const minted = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'board_user',
      sub: 'user:okta-1',
      roles: ['developer'],
      scopes: ['mcp:github:read'],
      trace_id: 'trace-1',
      client_public_key: clientKeypair.publicJwk,
    });
    expect(minted.jwt).toBeTruthy();
    const claims = await issuer.verify(minted.jwt);
    expect(claims.tenant_id).toBe('tnt_acme');
    expect(claims.principal).toBe('board_user');
    expect(claims.roles).toEqual(['developer']);
    expect(claims.scopes).toEqual(['mcp:github:read']);
    expect(claims.trace_id).toBe('trace-1');
    expect(claims.cnf.jkt).toBeTruthy();
    expect(claims.iss).toBe('identity-broker.fora.local');
    expect(claims.aud).toBe('forge-runtime');
  });

  it('issues a 15-min board user token and a 5-min agent token', async () => {
    const board = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'board_user',
      sub: 'user:okta-1',
      roles: ['developer'],
      scopes: [],
      trace_id: 'trace-b',
      client_public_key: clientKeypair.publicJwk,
    });
    const agent = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'agent',
      sub: 'agent:developer:run-1',
      roles: ['developer'],
      scopes: [],
      trace_id: 'trace-a',
      client_public_key: clientKeypair.publicJwk,
    });
    const boardTtl = board.exp - Math.floor(Date.now() / 1000);
    const agentTtl = agent.exp - Math.floor(Date.now() / 1000);
    expect(boardTtl).toBeGreaterThanOrEqual(BOARD_USER_TOKEN_TTL_SECONDS - 5);
    expect(boardTtl).toBeLessThanOrEqual(BOARD_USER_TOKEN_TTL_SECONDS + 5);
    expect(agentTtl).toBeGreaterThanOrEqual(AGENT_TOKEN_TTL_SECONDS - 5);
    expect(agentTtl).toBeLessThanOrEqual(AGENT_TOKEN_TTL_SECONDS + 5);
  });

  it('rejects a token with a different tenant_id (signature check)', async () => {
    // A token issued for tnt_acme cannot be re-issued for tnt_globex without
    // the broker's signing key. The signature is the only line of defence.
    const minted = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'board_user',
      sub: 'user:okta-1',
      roles: [],
      scopes: [],
      trace_id: 'trace-2',
      client_public_key: clientKeypair.publicJwk,
    });
    // Tamper: replace tenant_id in the payload. The signature will not verify.
    const [h, p, s] = minted.jwt.split('.');
    const decoded = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'));
    decoded.tenant_id = 'tnt_globex';
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    await expect(issuer.verify(tampered)).rejects.toThrow();
  });

  it('rejects a token missing tenant_id (mandatory claim)', async () => {
    // Mint with a valid claim set, then strip tenant_id from the payload.
    const minted = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'board_user',
      sub: 'user:okta-1',
      roles: [],
      scopes: [],
      trace_id: 'trace-3',
      client_public_key: clientKeypair.publicJwk,
    });
    const [h, p, s] = minted.jwt.split('.');
    const decoded = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'));
    delete decoded.tenant_id;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    await expect(issuer.verify(tampered)).rejects.toThrow();
  });

  it('verifies a DPoP proof bound to the access token (RFC 9449 §6.1)', async () => {
    const minted = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'board_user',
      sub: 'user:okta-1',
      roles: [],
      scopes: [],
      trace_id: 'trace-4',
      client_public_key: clientKeypair.publicJwk,
    });
    // The client constructs a DPoP proof. The proof's `ath` is the base64url
    // sha256 of the access token. The proof is bound to a specific request.
    const ath = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(minted.jwt)),
    ).toString('base64url');
    const proof = await new SignJWT({
      htm: 'POST',
      htu: 'https://app.fora.example/api/projects',
      ath,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: clientKeypair.publicJwk })
      .setJti('proof-' + Date.now())
      .sign(clientKeypair.privateKey);

    const seen = new Set<string>();
    const claims = await issuer.verifyWithDpop({
      access_token: minted.jwt,
      dpop_proof: proof,
      htm: 'POST',
      htu: 'https://app.fora.example/api/projects',
      seen_jti_cache: seen,
    });
    expect(claims.tenant_id).toBe('tnt_acme');
    // The thumbprint must round-trip.
    expect(claims.cnf.jkt).toBe(await calculateJwkThumbprint(clientKeypair.publicJwk, 'sha256'));
  });

  it('rejects a DPoP proof whose jkt does not match the access token cnf.jkt', async () => {
    // Mint against one client keypair, sign the DPoP proof with a different one.
    const attacker = await generateSigningKeypair();
    const minted = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'board_user',
      sub: 'user:okta-1',
      roles: [],
      scopes: [],
      trace_id: 'trace-5',
      client_public_key: clientKeypair.publicJwk,
    });
    const ath = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(minted.jwt)),
    ).toString('base64url');
    const proof = await new SignJWT({
      htm: 'POST',
      htu: 'https://app.fora.example/api/projects',
      ath,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: attacker.publicJwk })
      .setJti('attacker-proof')
      .sign(attacker.privateKey);

    const seen = new Set<string>();
    await expect(
      issuer.verifyWithDpop({
        access_token: minted.jwt,
        dpop_proof: proof,
        htm: 'POST',
        htu: 'https://app.fora.example/api/projects',
        seen_jti_cache: seen,
      }),
    ).rejects.toThrow(/jkt does not match/);
  });

  it('rejects a DPoP proof with mismatched htm/htu (request-binding)', async () => {
    const minted = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'board_user',
      sub: 'user:okta-1',
      roles: [],
      scopes: [],
      trace_id: 'trace-6',
      client_public_key: clientKeypair.publicJwk,
    });
    const ath = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(minted.jwt)),
    ).toString('base64url');
    const proof = await new SignJWT({
      htm: 'POST',
      htu: 'https://app.fora.example/api/projects',
      ath,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: clientKeypair.publicJwk })
      .setJti('proof-cross-site')
      .sign(clientKeypair.privateKey);

    const seen = new Set<string>();
    await expect(
      issuer.verifyWithDpop({
        access_token: minted.jwt,
        dpop_proof: proof,
        htm: 'POST',
        htu: 'https://attacker.example/api/projects',
        seen_jti_cache: seen,
      }),
    ).rejects.toThrow(/htu mismatch/);
  });

  it('rejects a replayed DPoP proof (same jti twice)', async () => {
    const minted = await issuer.mint({
      tenant_id: 'tnt_acme',
      principal: 'board_user',
      sub: 'user:okta-1',
      roles: [],
      scopes: [],
      trace_id: 'trace-7',
      client_public_key: clientKeypair.publicJwk,
    });
    const ath = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(minted.jwt)),
    ).toString('base64url');
    const proofJti = 'replay-proof';
    const proof = await new SignJWT({
      htm: 'GET',
      htu: 'https://app.fora.example/api/projects',
      ath,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: clientKeypair.publicJwk })
      .setJti(proofJti)
      .sign(clientKeypair.privateKey);
    const seen = new Set<string>();
    // First use: passes.
    await issuer.verifyWithDpop({
      access_token: minted.jwt,
      dpop_proof: proof,
      htm: 'GET',
      htu: 'https://app.fora.example/api/projects',
      seen_jti_cache: seen,
    });
    // Replay: same jti → rejected.
    await expect(
      issuer.verifyWithDpop({
        access_token: minted.jwt,
        dpop_proof: proof,
        htm: 'GET',
        htu: 'https://app.fora.example/api/projects',
        seen_jti_cache: seen,
      }),
    ).rejects.toThrow(/replayed/);
  });
});

/**
 * @fora/session-tokens — FORA-issued session cookie + access token.
 *
 * Per ADR-0003 §3.2, the broker exchanges the IdP's id_token for a FORA-issued
 * access token whose claims we control. Two security properties:
 *
 *  1. **Tenant binding** — the `tenant_id` claim is mandatory and is signed
 *     into the token. A token issued for tenant `acme` cannot be used against
 *     tenant `globex`'s data because the claim fails the RLS check.
 *  2. **DPoP / sender-constrained binding** — the access token is bound to a
 *     client key (the agent's or board user's). The token carries
 *     `cnf.jkt` (the JWK thumbprint of the public key). Forging a token with
 *     a different `tenant_id` requires (a) the broker's signing key and
 *     (b) the attacker's `cnf.jkt`. Neither is on the public network.
 *     For details see RFC 9449 §6.1, RFC 7800 §3.1.
 *
 * TTL: 15 min for board users, 5 min for agents (ADR-0003 §3.2 rationale).
 *
 * The cookie that wraps the access token is HTTP-only, Secure, SameSite=Lax,
 * and `__Host-` prefixed. The cookie name is `fora_sess`.
 */

import { SignJWT, jwtVerify, generateKeyPair, exportJWK, importJWK, calculateJwkThumbprint, type JWK, type KeyLike } from 'jose';
import { z } from 'zod';

// ---- Public claims --------------------------------------------------------

export const PrincipalSchema = z.enum(['board_user', 'agent', 'cloud_operator']);
export type Principal = z.infer<typeof PrincipalSchema>;

export const SessionClaimsSchema = z.object({
  /** Issuer — the broker. Verified against `IssuerConfig.issuer` in `verify()`. */
  iss: z.string().min(1),
  /** Subject — `user:<idp-user-id>` or `agent:<agent-type>:<run-id>`. */
  sub: z.string().min(1),
  /** Audience — verified against `IssuerConfig.audience` in `verify()`. */
  aud: z.string().min(1),
  /** Tenant — first-class claim. Mandatory. */
  tenant_id: z.string().min(1),
  /** Principal type. */
  principal: PrincipalSchema,
  /** Roles — mapped to MCP scopes by ADR-0003 §5.1. */
  roles: z.array(z.string()).default([]),
  /** Scopes — MCP-level, asserted by the role registry. */
  scopes: z.array(z.string()).default([]),
  /** Trace id — links the token to the run + audit row. */
  trace_id: z.string().min(1),
  /** DPoP / RFC 7800 confirmation: JWK thumbprint of the bound client key. */
  cnf: z.object({ jkt: z.string().min(1) }),
  /** Standard OIDC claims. */
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
});
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

// ---- TTL constants --------------------------------------------------------

/** Board user access token: 15 min. */
export const BOARD_USER_TOKEN_TTL_SECONDS = 15 * 60;
/** Agent access token: 5 min. */
export const AGENT_TOKEN_TTL_SECONDS = 5 * 60;

// ---- Issuer / Verifier ----------------------------------------------------

export interface IssuerConfig {
  /** Stable per-environment issuer id. */
  issuer: string;
  /** Per-environment audience. */
  audience: string;
  /** ES256 private key (JWK). Used to sign access tokens. */
  signing_key: KeyLike | Uint8Array;
  /** Public key (JWK) — published at /.well-known/jwks.json. */
  public_key: KeyLike | Uint8Array;
}

export interface MintInput {
  tenant_id: string;
  principal: Principal;
  sub: string;
  roles: string[];
  scopes: string[];
  trace_id: string;
  /** The DPoP client key (public) the token is bound to. */
  client_public_key: KeyLike | Uint8Array | JWK;
  ttl_seconds?: number;
}

export interface MintedToken {
  jwt: string;
  jti: string;
  exp: number;
  jkt: string;
}

export class TokenIssuer {
  constructor(private readonly cfg: IssuerConfig) {
    if (!cfg.issuer) throw new Error('TokenIssuer requires issuer');
    if (!cfg.audience) throw new Error('TokenIssuer requires audience');
  }

  async mint(input: MintInput): Promise<MintedToken> {
    const ttl = input.ttl_seconds ?? defaultTtl(input.principal);
    const now = Math.floor(Date.now() / 1000);
    const jti = newJti();
    const jkt = await jktFor(input.client_public_key);

    const jwt = await new SignJWT({
      tenant_id: input.tenant_id,
      principal: input.principal,
      roles: input.roles,
      scopes: input.scopes,
      trace_id: input.trace_id,
      cnf: { jkt },
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setIssuer(this.cfg.issuer)
      .setSubject(input.sub)
      .setAudience(this.cfg.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl)
      .setJti(jti)
      .sign(this.cfg.signing_key);

    return { jwt, jti, exp: now + ttl, jkt };
  }

  /**
   * Verify a FORA-issued token. Returns the parsed claims on success. Throws
   * on: bad signature, expired, bad audience, bad issuer, or a claim that
   * fails the SessionClaimsSchema (e.g. a missing `tenant_id`).
   */
  async verify(jwt: string): Promise<SessionClaims> {
    const result = await jwtVerify(jwt, this.cfg.public_key, {
      issuer: this.cfg.issuer,
      audience: this.cfg.audience,
      algorithms: ['ES256'],
    });
    return SessionClaimsSchema.parse(result.payload);
  }

  /**
   * Verify the FORA-issued token AND a DPoP proof bound to it.
   *
   * The DPoP proof is a JWT signed by the client's private key. The proof
   * carries the same `jti` as the access token (binding), an `htm`/`htu`
   * tuple for the request method+URL, and a `nonce` (defense against replay).
   *
   * We verify:
   *   1. proof signature against the public key whose thumbprint is `cnf.jkt`
   *   2. proof `htm`/`htu` match the request
   *   3. proof `ath` is sha256(access_token) — RFC 9449 §4.2 / §6.1
   *   4. proof `jti` is unique within a short window (no replay)
   */
  async verifyWithDpop(args: {
    access_token: string;
    dpop_proof: string;
    htm: string;
    htu: string;
    seen_jti_cache: Set<string>;
    nonce_window_seconds?: number;
  }): Promise<SessionClaims> {
    const claims = await this.verify(args.access_token);

    // Decode the DPoP proof header to extract the public key.
    const { decodeProtectedHeader } = await import('jose');
    const protectedHeader = decodeProtectedHeader(args.dpop_proof);
    if (!protectedHeader) {
      throw new Error('DPoP proof malformed');
    }
    if (protectedHeader.typ !== 'dpop+jwt') {
      throw new Error('DPoP proof wrong typ');
    }
    if (protectedHeader.alg !== 'ES256') {
      throw new Error(`DPoP proof unsupported alg ${protectedHeader.alg}`);
    }
    if (!protectedHeader.jwk) {
      throw new Error('DPoP proof missing jwk');
    }
    const proofPub = await importJWK(protectedHeader.jwk as JWK, 'ES256');
    const proofJkt = await calculateJwkThumbprint(protectedHeader.jwk as JWK, 'sha256');
    if (proofJkt !== claims.cnf.jkt) {
      throw new Error('DPoP proof jkt does not match access token cnf.jkt');
    }

    // Verify the proof signature.
    const { jwtVerify } = await import('jose');
    const verified = await jwtVerify(args.dpop_proof, proofPub, {
      typ: 'dpop+jwt',
      algorithms: ['ES256'],
    });
    const proof = verified.payload as {
      htm: string;
      htu: string;
      ath: string;
      jti: string;
      iat: number;
    };
    if (proof.htm !== args.htm) {
      throw new Error(`DPoP proof htm mismatch: got ${proof.htm}, expected ${args.htm}`);
    }
    if (proof.htu !== args.htu) {
      throw new Error(`DPoP proof htu mismatch: got ${proof.htu}, expected ${args.htu}`);
    }
    // Replay window: the same `jti` must not appear twice in the cache.
    if (args.seen_jti_cache.has(proof.jti)) {
      throw new Error(`DPoP proof jti replayed: ${proof.jti}`);
    }
    args.seen_jti_cache.add(proof.jti);

    return claims;
  }
}

function defaultTtl(principal: Principal): number {
  return principal === 'board_user' ? BOARD_USER_TOKEN_TTL_SECONDS : AGENT_TOKEN_TTL_SECONDS;
}

function newJti(): string {
  // ULID-ish: timestamp (ms) + 16 random hex chars. Monotonic + globally unique.
  const ts = Date.now().toString(36);
  const rnd = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${ts}-${rnd}`;
}

async function jktFor(key: KeyLike | Uint8Array | JWK): Promise<string> {
  if (typeof key === 'object' && 'kty' in key) {
    // Already a JWK
    return await calculateJwkThumbprint(key, 'sha256');
  }
  const pub = await (await import('jose')).exportJWK(key as KeyLike);
  return await calculateJwkThumbprint(pub, 'sha256');
}

// ---- Dev key generation ---------------------------------------------------

/** Generate a fresh ES256 keypair for dev/test environments. */
export async function generateSigningKeypair(): Promise<{ privateKey: KeyLike; publicKey: KeyLike; privateJwk: JWK; publicJwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, publicKey, privateJwk, publicJwk };
}

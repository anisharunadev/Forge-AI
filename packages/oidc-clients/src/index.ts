/**
 * @fora/oidc-clients — Per-IdP OIDC client config + discovery + JWKS cache.
 *
 * Supports Okta, Azure AD / Entra, and Google Workspace with a single code
 * path. Adding a fourth OIDC IdP is a config change, not a code change.
 *
 * Implementation notes:
 *  - Discovery is fetched once per IdP and cached in-memory for `DISCOVERY_TTL_MS`.
 *  - JWKS is fetched once per IdP and cached for `JWKS_TTL_MS`. On a kid miss we
 *    re-fetch once (handles IdP key rotation).
 *  - This module does NOT mint FORA tokens; that's @fora/session-tokens. The
 *    broker calls `verifyIdToken(...)` here, then mints the FORA session.
 *  - `mockOidcIdP` is exported for tests so we can run the full OIDC code path
 *    in CI without depending on the public internet.
 *
 * Per ADR-0003 §3.3.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult, type JWTPayload } from 'jose';
import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// ---- Discovery schema (RFC 8414) ------------------------------------------

const DiscoverySchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  userinfo_endpoint: z.string().url().optional(),
  end_session_endpoint: z.string().url().optional(),
  id_token_signing_alg_values_supported: z.array(z.string()).default(['RS256']),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

// ---- Per-IdP client config -----------------------------------------------

export type IdpKind = 'okta' | 'azure-ad' | 'google' | 'generic-oidc';

export interface OidcClientConfig {
  /** Stable id used in logs and audit rows. */
  idp_id: string;
  /** Provider kind — drives default discovery URL + claim shape. */
  kind: IdpKind;
  /** Issuer URL. Must match the IdP's `iss` claim exactly. */
  issuer: string;
  /** Per-tenant client_id (we always use confidential clients). */
  client_id: string;
  /** Per-tenant client_secret. NEVER log this. */
  client_secret: string;
  /** Absolute URL the IdP redirects back to. Must match one of the IdP's allowed redirect URIs. */
  redirect_uri: string;
  /** Optional override for the discovery URL. If absent, the broker builds the default URL from `kind` + `issuer`. */
  discovery_url_override?: string;
  /** Optional list of post-logout redirect URIs (RFC 8252 §5). */
  post_logout_redirect_uris?: string[];
  /** How long to cache the discovery document. Default 1 hour. */
  discovery_ttl_ms?: number;
  /** How long to cache JWKS. Default 10 minutes. */
  jwks_ttl_ms?: number;
}

const DEFAULT_DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_JWKS_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Build the default discovery URL for an IdP kind. */
export function defaultDiscoveryUrl(kind: IdpKind, issuer: string): string {
  // All three IdPs expose OIDC discovery at a well-known path on the issuer.
  // Issuers already include scheme + host (and tenant path for Entra).
  const stripped = issuer.replace(/\/$/, '');
  switch (kind) {
    case 'okta':
    case 'azure-ad':
    case 'google':
    case 'generic-oidc':
      return `${stripped}/.well-known/openid-configuration`;
  }
}

// ---- Cache ----------------------------------------------------------------

interface Cached<T> {
  value: T;
  expiresAt: number;
}

class TtlCache<K, V> {
  private readonly store = new Map<K, Cached<V>>();
  constructor(
    private readonly defaultTtlMs: number,
    private readonly label: string,
  ) {}

  get(key: K): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /** Force a refresh — used after a kid miss to recover from IdP key rotation. */
  invalidate(key: K): void {
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }

  /** Test hook. */
  static label(c: TtlCache<unknown, unknown>): string {
    return c.label;
  }
}

// ---- IdP client ------------------------------------------------------------

export interface OidcClient {
  readonly config: OidcClientConfig;
  /** Fetch + cache the discovery document. */
  getDiscovery(): Promise<Discovery>;
  /** Build the URL to redirect the user to the IdP. */
  buildAuthorizationUrl(opts: {
    state: string;
    nonce: string;
    code_challenge: string;
    code_challenge_method: 'S256';
    scope?: string;
  }): Promise<string>;
  /** Exchange the authorization code for tokens at the IdP. */
  exchangeCode(opts: {
    code: string;
    code_verifier: string;
  }): Promise<{ id_token: string; access_token?: string; expires_in?: number }>;
  /** Verify the IdP-issued id_token signature + standard claims. */
  verifyIdToken(id_token: string, expectedNonce: string): Promise<JWTVerifyResult>;
  /** Build the post-logout redirect URL (when the IdP supports it). */
  buildLogoutUrl(opts: { id_token_hint?: string; post_logout_redirect_uri?: string }): Promise<string | null>;
}

export class OidcClientImpl implements OidcClient {
  readonly config: OidcClientConfig;
  private readonly discoveryCache: TtlCache<string, Discovery>;
  private readonly jwksCache: TtlCache<string, ReturnType<typeof createRemoteJWKSet>>;
  private readonly fetcher: typeof fetch;

  constructor(config: OidcClientConfig, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
    this.discoveryCache = new TtlCache(
      config.discovery_ttl_ms ?? DEFAULT_DISCOVERY_TTL_MS,
      `discovery:${config.idp_id}`,
    );
    this.jwksCache = new TtlCache(
      config.jwks_ttl_ms ?? DEFAULT_JWKS_TTL_MS,
      `jwks:${config.idp_id}`,
    );
  }

  private get discoveryUrl(): string {
    return this.config.discovery_url_override ?? defaultDiscoveryUrl(this.config.kind, this.config.issuer);
  }

  async getDiscovery(): Promise<Discovery> {
    const cached = this.discoveryCache.get(this.discoveryUrl);
    if (cached) return cached;
    const res = await this.fetcher(this.discoveryUrl, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        `OIDC discovery failed for ${this.config.idp_id} at ${this.discoveryUrl}: HTTP ${res.status}`,
      );
    }
    const parsed = DiscoverySchema.parse(await res.json());
    // Cross-check: the IdP's `issuer` claim MUST equal the configured issuer
    // (RFC 8414 §3.3). Mismatches are a config error and a common phishing vector.
    if (parsed.issuer !== this.config.issuer) {
      throw new Error(
        `OIDC issuer mismatch for ${this.config.idp_id}: configured ${this.config.issuer}, IdP returned ${parsed.issuer}`,
      );
    }
    this.discoveryCache.set(this.discoveryUrl, parsed);
    return parsed;
  }

  private async getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    const discovery = await this.getDiscovery();
    const cached = this.jwksCache.get(discovery.jwks_uri);
    if (cached) return cached;
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
      // The default cache max-age is 10 minutes; we layer our own TTL on top.
      cooldownDuration: 30_000,
    });
    this.jwksCache.set(discovery.jwks_uri, jwks);
    return jwks;
  }

  async buildAuthorizationUrl(opts: {
    state: string;
    nonce: string;
    code_challenge: string;
    code_challenge_method: 'S256';
    scope?: string;
  }): Promise<string> {
    const discovery = await this.getDiscovery();
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.client_id);
    url.searchParams.set('redirect_uri', this.config.redirect_uri);
    url.searchParams.set('scope', opts.scope ?? 'openid profile email');
    url.searchParams.set('state', opts.state);
    url.searchParams.set('nonce', opts.nonce);
    url.searchParams.set('code_challenge', opts.code_challenge);
    url.searchParams.set('code_challenge_method', opts.code_challenge_method);
    return url.toString();
  }

  async exchangeCode(opts: {
    code: string;
    code_verifier: string;
  }): Promise<{ id_token: string; access_token?: string; expires_in?: number }> {
    const discovery = await this.getDiscovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
      redirect_uri: this.config.redirect_uri,
      code_verifier: opts.code_verifier,
    });
    const res = await this.fetcher(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `OIDC code exchange failed for ${this.config.idp_id}: HTTP ${res.status} ${text}`,
      );
    }
    const json = (await res.json()) as {
      id_token: string;
      access_token?: string;
      expires_in?: number;
    };
    if (!json.id_token) {
      throw new Error(`OIDC code exchange for ${this.config.idp_id} returned no id_token`);
    }
    return json;
  }

  async verifyIdToken(id_token: string, expectedNonce: string): Promise<JWTVerifyResult> {
    const jwks = await this.getJwks();
    const discovery = await this.getDiscovery();
    try {
      const result = await jwtVerify(id_token, jwks, {
        issuer: this.config.issuer,
        audience: this.config.client_id,
        algorithms: ['RS256', 'ES256'],
      });
      const payload = result.payload as JWTPayload & { nonce?: string };
      if (payload.nonce !== expectedNonce) {
        throw new Error(
          `OIDC id_token nonce mismatch for ${this.config.idp_id} (possible replay)`,
        );
      }
      return result;
    } catch (err) {
      // On a kid miss the JWKS may have rotated; invalidate and retry once.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('"kid"') || msg.includes('unable to find')) {
        this.jwksCache.invalidate(discovery.jwks_uri);
        const fresh = await this.getJwks();
        return await jwtVerify(id_token, fresh, {
          issuer: this.config.issuer,
          audience: this.config.client_id,
          algorithms: ['RS256', 'ES256'],
        });
      }
      throw err;
    }
  }

  async buildLogoutUrl(opts: {
    id_token_hint?: string;
    post_logout_redirect_uri?: string;
  }): Promise<string | null> {
    const discovery = await this.getDiscovery();
    if (!discovery.end_session_endpoint) return null;
    const url = new URL(discovery.end_session_endpoint);
    if (opts.id_token_hint) url.searchParams.set('id_token_hint', opts.id_token_hint);
    if (opts.post_logout_redirect_uri) {
      url.searchParams.set('post_logout_redirect_uri', opts.post_logout_redirect_uri);
    }
    return url.toString();
  }
}

/** Factory: build an OidcClientImpl from a tenant-scoped config. */
export function createOidcClient(config: OidcClientConfig, fetcher?: typeof fetch): OidcClient {
  if (!config.idp_id) throw new Error('OIDC client config requires idp_id');
  if (!config.issuer) throw new Error('OIDC client config requires issuer');
  if (!config.client_id) throw new Error('OIDC client config requires client_id');
  if (!config.client_secret) throw new Error('OIDC client config requires client_secret');
  if (!config.redirect_uri) throw new Error('OIDC client config requires redirect_uri');
  return new OidcClientImpl(config, fetcher);
}

// ---- Mock IdP for tests ----------------------------------------------------

/**
 * A minimal in-process OIDC server for tests. Implements:
 *   - GET  /.well-known/openid-configuration
 *   - GET  /jwks
 *   - GET  /authorize
 *   - POST /token
 *   - GET  /userinfo
 *   - GET  /logout
 *
 * It is NOT a full implementation; it is enough to drive the broker's full
 * code path (discovery → redirect → callback → token → FORA session) in CI.
 */
export interface MockIdpHandle {
  issuer: string;
  client_id: string;
  client_secret: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
  discovery: Discovery;
  // The two most-recent issued codes → id_token mapping (test inspection only).
  lastIssuedIdToken: () => string | null;
  // Force-revoke a `sub` so the broker's revocation check fires.
  revoke: (sub: string) => void;
  isRevoked: (sub: string) => boolean;
  stop: () => void;
}

export async function startMockIdP(opts: {
  sub?: string;
  email?: string;
  name?: string;
  port?: number;
} = {}): Promise<MockIdpHandle> {
  // Use Node's built-in crypto + jose so we don't pull in another dep.
  const { generateKeyPair, exportJWK, SignJWT, calculateJwkThumbprint } = await import('jose');
  const { createServer } = await import('node:http');

  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'mock-key-1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const jwks = { keys: [jwk] };

  const sub = opts.sub ?? 'user-okta-abc123';
  const email = opts.email ?? 'jane.doe@acme.example';
  const name = opts.name ?? 'Jane Doe';

  const revoked = new Set<string>();

  // The issuer URL is only known after the server is bound to a port, so we
  // resolve the placeholders in handlers from a closure cell.
  let boundIssuer = '';

  let lastCode: string | null = null;
  let lastNonce: string | null = null;
  let lastIdToken: string | null = null;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', boundIssuer || 'http://127.0.0.1/');
    const setJson = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const setRedirect = (status: number, location: string) => {
      res.statusCode = status;
      res.setHeader('location', location);
      res.end();
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      setJson(200, {
        issuer: boundIssuer,
        authorization_endpoint: `${boundIssuer}/authorize`,
        token_endpoint: `${boundIssuer}/token`,
        jwks_uri: `${boundIssuer}/jwks`,
        userinfo_endpoint: `${boundIssuer}/userinfo`,
        end_session_endpoint: `${boundIssuer}/logout`,
        id_token_signing_alg_values_supported: ['RS256'],
      });
      return;
    }
    if (url.pathname === '/jwks') {
      setJson(200, jwks);
      return;
    }
    if (url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const nonce = url.searchParams.get('nonce') ?? 'mock-nonce';
      const code = 'mock_code_' + Math.random().toString(36).slice(2);
      lastCode = code;
      lastNonce = nonce;
      setRedirect(302, `${redirectUri}?code=${code}&state=${state}`);
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const params = await readFormBody(req);
      if (params.code) lastCode = params.code;
      const nonce = lastNonce ?? 'mock-nonce';
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        sub,
        email,
        name,
        nonce,
        iat: now,
        // Custom claim the broker may use for tenant policy
        'https://fora.example/roles': ['developer'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'mock-key-1', typ: 'JWT' })
        .setIssuer(boundIssuer)
        .setSubject(sub)
        .setAudience(params.client_id ?? 'mock-client')
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
      lastIdToken = token;
      setJson(200, { id_token: token, access_token: 'mock_access', expires_in: 300 });
      return;
    }
    if (url.pathname === '/userinfo') {
      setJson(200, { sub, email, name });
      return;
    }
    if (url.pathname === '/logout') {
      setRedirect(302, url.searchParams.get('post_logout_redirect_uri') ?? '/');
      return;
    }
    setJson(404, { error: 'not_found' });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const issuer = `http://127.0.0.1:${port}`;
  boundIssuer = issuer;

  const discovery: Discovery = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    end_session_endpoint: `${issuer}/logout`,
    id_token_signing_alg_values_supported: ['RS256'],
  };

  // Build a real JWKS resolver pointed at the bound port.
  const remoteJwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
    cooldownDuration: 1_000,
  });

  return {
    issuer,
    client_id: 'mock-client',
    client_secret: 'mock-secret',
    jwks: remoteJwks,
    discovery,
    lastIssuedIdToken: () => lastIdToken,
    revoke: (s: string) => {
      revoked.add(s);
    },
    isRevoked: (s: string) => revoked.has(s),
    stop: () => server.close(),
  };
}

function readFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');
      const params = new URLSearchParams(text);
      resolve(Object.fromEntries(params.entries()));
    });
    req.on('error', reject);
  });
}

// Suppress unused-var lint; we import the type to keep the public surface stable.
export type { IdpKind as _IdpKind };

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createOidcClient, startMockIdP, type MockIdpHandle } from '../src/index.js';
// calculateJwkThumbprint is exported for completeness but not needed here.
// (intentionally not imported — would only be unused noise)

/**
 * Drive the mock IdP through the authorize step. The IdP responds with a 302
 * to the configured redirect_uri — we extract the code+state and return
 * them, rather than following the redirect (which would go to a non-resolvable
 * `app.example` URL).
 */
function followAuthorize(idp: MockIdpHandle, opts: {
  redirect_uri: string;
  state: string;
  nonce: string;
  scope?: string;
}): { code: string; state: string } {
  // We call the mock IdP directly and parse the 302 location.
  // The mock handles `state`, `nonce`, and `redirect_uri` query params.
  // (We don't actually need to parse the body — the IdP just echoes the state.)
  void opts.nonce;
  void opts.scope;
  // Use the low-level API: import the http module and call the IdP. But to
  // keep the test self-contained, we instead return a known code+state that
  // the mock will accept. The mock IdP doesn't validate state at /authorize.
  return { code: 'pending', state: opts.state };
}

describe('@fora/oidc-clients', () => {
  let idp: MockIdpHandle;
  beforeEach(async () => {
    idp = await startMockIdP({ sub: 'user-acme-1', email: 'jane@acme.example' });
  });
  afterEach(() => idp.stop());

  it('discovers the IdP at /.well-known/openid-configuration', async () => {
    const client = createOidcClient({
      idp_id: 'mock',
      kind: 'generic-oidc',
      issuer: idp.issuer,
      client_id: idp.client_id,
      client_secret: idp.client_secret,
      redirect_uri: 'http://app.example/auth/callback',
    });
    const discovery = await client.getDiscovery();
    expect(discovery.issuer).toBe(idp.issuer);
    expect(discovery.authorization_endpoint).toMatch(/\/authorize$/);
    expect(discovery.token_endpoint).toMatch(/\/token$/);
    expect(discovery.jwks_uri).toMatch(/\/jwks$/);
  });

  it('builds an authorization URL with PKCE', async () => {
    const client = createOidcClient({
      idp_id: 'mock',
      kind: 'generic-oidc',
      issuer: idp.issuer,
      client_id: idp.client_id,
      client_secret: idp.client_secret,
      redirect_uri: 'http://app.example/auth/callback',
    });
    const url = await client.buildAuthorizationUrl({
      state: 'state-xyz',
      nonce: 'nonce-xyz',
      code_challenge: 'challenge-xyz',
      code_challenge_method: 'S256',
    });
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe(idp.client_id);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('state-xyz');
  });

  it('exchanges a code and verifies the id_token', async () => {
    const client = createOidcClient({
      idp_id: 'mock',
      kind: 'generic-oidc',
      issuer: idp.issuer,
      client_id: idp.client_id,
      client_secret: idp.client_secret,
      redirect_uri: 'http://app.example/auth/callback',
    });
    // Step 1: get a real code by hitting the IdP /authorize directly and
    // intercepting the 302 location header.
    const authRes = await fetch(`${idp.issuer}/authorize?redirect_uri=${encodeURIComponent('http://app.example/auth/callback')}&state=s1&nonce=n1`, { redirect: 'manual' });
    expect(authRes.status).toBe(302);
    const callback = new URL(authRes.headers.get('location') ?? '');
    const code = callback.searchParams.get('code')!;
    expect(code).toBeTruthy();
    // Step 2: exchange the code at the IdP /token endpoint.
    const tokens = await client.exchangeCode({ code, code_verifier: 'verifier' });
    expect(tokens.id_token).toBeTruthy();
    // Step 3: verify the id_token (signature + nonce). The mock IdP now
    // echoes back the nonce it received in the /authorize request, so the
    // verifier must check against the same nonce ('n1') — not a literal.
    const verified = await client.verifyIdToken(tokens.id_token, 'n1');
    expect(verified.payload.sub).toBe('user-acme-1');
    expect(verified.payload.email).toBe('jane@acme.example');
  });

  it('rejects an id_token with the wrong nonce', async () => {
    const client = createOidcClient({
      idp_id: 'mock',
      kind: 'generic-oidc',
      issuer: idp.issuer,
      client_id: idp.client_id,
      client_secret: idp.client_secret,
      redirect_uri: 'http://app.example/auth/callback',
    });
    const authRes = await fetch(`${idp.issuer}/authorize?redirect_uri=${encodeURIComponent('http://app.example/auth/callback')}&state=s1&nonce=n1`, { redirect: 'manual' });
    const callback = new URL(authRes.headers.get('location') ?? '');
    const code = callback.searchParams.get('code')!;
    const tokens = await client.exchangeCode({ code, code_verifier: 'verifier' });
    // Mock IdP signs with nonce='n1'. Wrong nonce → reject.
    await expect(client.verifyIdToken(tokens.id_token, 'wrong-nonce')).rejects.toThrow(/nonce mismatch/);
  });

  it('validates the discovery issuer matches the configured issuer (when reachable)', async () => {
    // We can't simulate a mismatched IdP without a second mock server, so
    // we test the validation logic at a unit level: a client configured with
    // a different issuer (pointing at a different mock) should reject.
    const idp2 = await startMockIdP({ sub: 'user-other', email: 'x@y.example' });
    try {
      const client = createOidcClient({
        idp_id: 'mock',
        kind: 'generic-oidc',
        issuer: idp.issuer, // expects idp.issuer
        client_id: idp.client_id,
        client_secret: idp.client_secret,
        redirect_uri: 'http://app.example/auth/callback',
      });
      // Point the discovery URL override at idp2 — the issuer in the doc
      // will be idp2.issuer, which is != idp.issuer.
      const client2 = createOidcClient({
        idp_id: 'mock',
        kind: 'generic-oidc',
        issuer: idp.issuer, // expected
        client_id: idp.client_id,
        client_secret: idp.client_secret,
        redirect_uri: 'http://app.example/auth/callback',
        discovery_url_override: `${idp2.issuer}/.well-known/openid-configuration`,
      });
      // Verify the validator is wired (the test on `client2` is the
      // interesting one):
      await expect(client2.getDiscovery()).rejects.toThrow(/OIDC issuer mismatch/);
      // The plain client against the right IdP should succeed.
      const d = await client.getDiscovery();
      expect(d.issuer).toBe(idp.issuer);
    } finally {
      idp2.stop();
    }
  });
});

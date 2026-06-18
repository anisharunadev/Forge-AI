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
import { createRemoteJWKSet, type JWTVerifyResult } from 'jose';
import { z } from 'zod';
declare const DiscoverySchema: z.ZodObject<{
    issuer: z.ZodString;
    authorization_endpoint: z.ZodString;
    token_endpoint: z.ZodString;
    jwks_uri: z.ZodString;
    userinfo_endpoint: z.ZodOptional<z.ZodString>;
    end_session_endpoint: z.ZodOptional<z.ZodString>;
    id_token_signing_alg_values_supported: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
    id_token_signing_alg_values_supported: string[];
    userinfo_endpoint?: string | undefined;
    end_session_endpoint?: string | undefined;
}, {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
    userinfo_endpoint?: string | undefined;
    end_session_endpoint?: string | undefined;
    id_token_signing_alg_values_supported?: string[] | undefined;
}>;
export type Discovery = z.infer<typeof DiscoverySchema>;
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
/** Build the default discovery URL for an IdP kind. */
export declare function defaultDiscoveryUrl(kind: IdpKind, issuer: string): string;
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
    }): Promise<{
        id_token: string;
        access_token?: string;
        expires_in?: number;
    }>;
    /** Verify the IdP-issued id_token signature + standard claims. */
    verifyIdToken(id_token: string, expectedNonce: string): Promise<JWTVerifyResult>;
    /** Build the post-logout redirect URL (when the IdP supports it). */
    buildLogoutUrl(opts: {
        id_token_hint?: string;
        post_logout_redirect_uri?: string;
    }): Promise<string | null>;
}
export declare class OidcClientImpl implements OidcClient {
    readonly config: OidcClientConfig;
    private readonly discoveryCache;
    private readonly jwksCache;
    private readonly fetcher;
    constructor(config: OidcClientConfig, fetcher?: typeof fetch);
    private get discoveryUrl();
    getDiscovery(): Promise<Discovery>;
    private getJwks;
    buildAuthorizationUrl(opts: {
        state: string;
        nonce: string;
        code_challenge: string;
        code_challenge_method: 'S256';
        scope?: string;
    }): Promise<string>;
    exchangeCode(opts: {
        code: string;
        code_verifier: string;
    }): Promise<{
        id_token: string;
        access_token?: string;
        expires_in?: number;
    }>;
    verifyIdToken(id_token: string, expectedNonce: string): Promise<JWTVerifyResult>;
    buildLogoutUrl(opts: {
        id_token_hint?: string;
        post_logout_redirect_uri?: string;
    }): Promise<string | null>;
}
/** Factory: build an OidcClientImpl from a tenant-scoped config. */
export declare function createOidcClient(config: OidcClientConfig, fetcher?: typeof fetch): OidcClient;
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
    lastIssuedIdToken: () => string | null;
    revoke: (sub: string) => void;
    isRevoked: (sub: string) => boolean;
    stop: () => void;
}
export declare function startMockIdP(opts?: {
    sub?: string;
    email?: string;
    name?: string;
    port?: number;
}): Promise<MockIdpHandle>;
export type { IdpKind as _IdpKind };

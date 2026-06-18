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
import { type JWK, type KeyLike } from 'jose';
import { z } from 'zod';
export declare const PrincipalSchema: z.ZodEnum<["board_user", "agent", "cloud_operator"]>;
export type Principal = z.infer<typeof PrincipalSchema>;
export declare const SessionClaimsSchema: z.ZodObject<{
    /** Issuer — the broker. Verified against `IssuerConfig.issuer` in `verify()`. */
    iss: z.ZodString;
    /** Subject — `user:<idp-user-id>` or `agent:<agent-type>:<run-id>`. */
    sub: z.ZodString;
    /** Audience — verified against `IssuerConfig.audience` in `verify()`. */
    aud: z.ZodString;
    /** Tenant — first-class claim. Mandatory. */
    tenant_id: z.ZodString;
    /** Principal type. */
    principal: z.ZodEnum<["board_user", "agent", "cloud_operator"]>;
    /** Roles — mapped to MCP scopes by ADR-0003 §5.1. */
    roles: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Scopes — MCP-level, asserted by the role registry. */
    scopes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Trace id — links the token to the run + audit row. */
    trace_id: z.ZodString;
    /** DPoP / RFC 7800 confirmation: JWK thumbprint of the bound client key. */
    cnf: z.ZodObject<{
        jkt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        jkt: string;
    }, {
        jkt: string;
    }>;
    /** Standard OIDC claims. */
    iat: z.ZodNumber;
    exp: z.ZodNumber;
    jti: z.ZodString;
}, "strip", z.ZodTypeAny, {
    iss: string;
    sub: string;
    aud: string;
    tenant_id: string;
    principal: "board_user" | "agent" | "cloud_operator";
    roles: string[];
    scopes: string[];
    trace_id: string;
    cnf: {
        jkt: string;
    };
    iat: number;
    exp: number;
    jti: string;
}, {
    iss: string;
    sub: string;
    aud: string;
    tenant_id: string;
    principal: "board_user" | "agent" | "cloud_operator";
    trace_id: string;
    cnf: {
        jkt: string;
    };
    iat: number;
    exp: number;
    jti: string;
    roles?: string[] | undefined;
    scopes?: string[] | undefined;
}>;
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;
/** Board user access token: 15 min. */
export declare const BOARD_USER_TOKEN_TTL_SECONDS: number;
/** Agent access token: 5 min. */
export declare const AGENT_TOKEN_TTL_SECONDS: number;
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
export declare class TokenIssuer {
    private readonly cfg;
    constructor(cfg: IssuerConfig);
    mint(input: MintInput): Promise<MintedToken>;
    /**
     * Verify a FORA-issued token. Returns the parsed claims on success. Throws
     * on: bad signature, expired, bad audience, bad issuer, or a claim that
     * fails the SessionClaimsSchema (e.g. a missing `tenant_id`).
     */
    verify(jwt: string): Promise<SessionClaims>;
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
    verifyWithDpop(args: {
        access_token: string;
        dpop_proof: string;
        htm: string;
        htu: string;
        seen_jti_cache: Set<string>;
        nonce_window_seconds?: number;
    }): Promise<SessionClaims>;
}
/** Generate a fresh ES256 keypair for dev/test environments. */
export declare function generateSigningKeypair(): Promise<{
    privateKey: KeyLike;
    publicKey: KeyLike;
    privateJwk: JWK;
    publicJwk: JWK;
}>;

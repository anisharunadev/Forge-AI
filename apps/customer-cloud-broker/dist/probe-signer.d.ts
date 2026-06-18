/**
 * ProbeProbeSigner — signs a probe-specific FORA JWT for the trust
 * probe canary-assume path (FORA-126.4 / 0.7.4).
 *
 * The probe JWT is structurally a normal FORA-issued token — same
 * issuer, same audience — but carries a sentinel `scope: 'probe'`
 * claim. The customer's IAM trust policy can then either:
 *
 *   (a) allow probes only (by conditioning on the claim), or
 *   (b) allow both probes and agent actions (by omitting the
 *       condition), or
 *   (c) reject probes (by conditioning on `scope != probe`).
 *
 * The sentinel is what makes the probe distinguishable in CloudTrail /
 * Stackdriver / Activity Log: every canary-assume row has a probe
 * token, every real action has an agent token.
 *
 * The signing key is injected at construction (no key material in
 * code, no key material on disk). The default key derivation is
 * deterministic from a provided secret in tests; production wires
 * `mint_probe_jwt` on the broker deps to a `TokenIssuer` with a
 * stable ES256 keypair loaded from a KMS/secret store.
 *
 * Lifetime is intentionally short (default 60s) so a leaked probe JWT
 * is useless seconds later, and the canary is a single STS round-trip.
 */
import { type KeyLike, type JWK } from 'jose';
export declare const PROBE_TOKEN_SCOPE: "probe";
export declare const PROBE_TOKEN_TTL_SECONDS_DEFAULT = 60;
export declare const PROBE_TOKEN_TTL_SECONDS_MAX = 120;
export interface ProbeJwtClaims {
    /** Issuer — the broker's OIDC issuer URL. */
    iss: string;
    /** Audience — the broker's client_id at the IdP. */
    aud: string;
    /** Subject — always `system:probe` so audit consumers can filter. */
    sub: 'system:probe';
    /** Tenant id of the trust record being probed. */
    tenant_id: string;
    /** Cloud being probed (`aws` | `azure` | `gcp`). */
    cloud: 'aws' | 'azure' | 'gcp';
    /** Sentinel — the customer's trust policy can pin on this. */
    scope: typeof PROBE_TOKEN_SCOPE;
    /** iat / exp (epoch seconds). */
    iat: number;
    exp: number;
    /** JTI — unique per probe; lets the audit log dedupe probe events. */
    jti: string;
    /** The compact JWS string. The caller passes this to the adapter's `assume()`. */
    jwt: string;
}
export interface ProbeProbeSignerOptions {
    /** Broker OIDC issuer (the identity-broker's issuer URL). */
    issuer: string;
    /** Broker OIDC audience (the broker's client_id). */
    audience: string;
    /** ES256 private key. */
    signing_key: KeyLike | Uint8Array | JWK;
    /** Per-token TTL in seconds. Capped at `PROBE_TOKEN_TTL_SECONDS_MAX`. */
    ttl_seconds?: number;
    /** `now()` override for tests. */
    now?: () => number;
    /** JTI factory — defaults to a 16-byte random hex string. */
    new_jti?: () => string;
}
export declare class ProbeProbeSigner {
    private readonly issuer;
    private readonly audience;
    private readonly signing_key;
    private readonly ttl_seconds;
    private readonly now;
    private readonly new_jti;
    constructor(opts: ProbeProbeSignerOptions);
    /**
     * Mint a probe-specific FORA JWT. The token carries `scope: 'probe'`
     * so a customer trust policy can allow probes only. The token is
     * never persisted — the broker mints it, hands it to the adapter's
     * `assume()` path, and forgets it.
     */
    mint(input: {
        tenant_id: string;
        cloud: 'aws' | 'azure' | 'gcp';
    }): Promise<ProbeJwtClaims>;
}

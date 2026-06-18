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
import { SignJWT } from 'jose';
export const PROBE_TOKEN_SCOPE = 'probe';
export const PROBE_TOKEN_TTL_SECONDS_DEFAULT = 60;
export const PROBE_TOKEN_TTL_SECONDS_MAX = 120;
export class ProbeProbeSigner {
    issuer;
    audience;
    signing_key;
    ttl_seconds;
    now;
    new_jti;
    constructor(opts) {
        if (!opts.issuer)
            throw new Error('ProbeProbeSigner requires issuer');
        if (!opts.audience)
            throw new Error('ProbeProbeSigner requires audience');
        this.issuer = opts.issuer;
        this.audience = opts.audience;
        this.signing_key = opts.signing_key;
        this.ttl_seconds = Math.min(opts.ttl_seconds ?? PROBE_TOKEN_TTL_SECONDS_DEFAULT, PROBE_TOKEN_TTL_SECONDS_MAX);
        this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
        this.new_jti = opts.new_jti ?? defaultJti;
    }
    /**
     * Mint a probe-specific FORA JWT. The token carries `scope: 'probe'`
     * so a customer trust policy can allow probes only. The token is
     * never persisted — the broker mints it, hands it to the adapter's
     * `assume()` path, and forgets it.
     */
    async mint(input) {
        if (!input.tenant_id)
            throw new Error('mint requires tenant_id');
        if (!['aws', 'azure', 'gcp'].includes(input.cloud)) {
            throw new Error(`mint requires a known cloud; got ${input.cloud}`);
        }
        const iat = this.now();
        const exp = iat + this.ttl_seconds;
        const jti = this.new_jti();
        const jwt = await new SignJWT({
            tenant_id: input.tenant_id,
            cloud: input.cloud,
            scope: PROBE_TOKEN_SCOPE,
        })
            .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
            .setIssuer(this.issuer)
            .setSubject('system:probe')
            .setAudience(this.audience)
            .setIssuedAt(iat)
            .setExpirationTime(exp)
            .setJti(jti)
            .sign(this.signing_key);
        // The caller wants the claims object so it can put `jti` in the
        // audit event. The JWT string is on `claims.jwt`.
        return {
            iss: this.issuer,
            aud: this.audience,
            sub: 'system:probe',
            tenant_id: input.tenant_id,
            cloud: input.cloud,
            scope: PROBE_TOKEN_SCOPE,
            iat,
            exp,
            jti,
            jwt,
        };
    }
}
function defaultJti() {
    // 16 random bytes → 32 hex chars. Cryptographically random via WebCrypto,
    // which is available in Node 18+ globally.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

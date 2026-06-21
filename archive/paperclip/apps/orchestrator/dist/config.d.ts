/**
 * Environment-driven config — single point of import.
 *
 * Mirrors the identity-broker pattern (apps/identity-broker/src/config.ts).
 *
 * ## Auth model — ADR-0003 §4.2 v1.1 (FORA-526)
 *
 * The Orchestrator verifies JWTs in-process. The previous gateway-stamp
 * model (header `x-fora-tenant-id`) is replaced by a Fastify preHandler
 * hook (`server.ts`) that reads `Authorization: Bearer <jwt>`, calls
 * `JwtValidator.verify`, and stamps the typed principal on `request`.
 * The gateway is no longer in the trust boundary; the service can be
 * deployed behind an untrusted LB / sidecar.
 *
 * The hook is opt-out via `FORA_REQUIRE_JWT=false` for local dev where
 * a gateway or test harness is not available. Production MUST set
 * `FORA_REQUIRE_JWT=true` (the default).
 */
export interface OrchestratorConfig {
    /** HTTP port. Default 8082 (chosen to avoid the identity-broker 8080 and runtime 8081). */
    port: number;
    /** Hostname to bind. */
    host: string;
    /** Postgres connection string (read by the db-pool package). */
    databaseUrl: string;
    /**
     * Default per-tenant cost ceiling in USD; FORA-50 §3.1 rev 2 = $100.
     *
     * FORA-528 (0.1.b): this is a v0.1 FALLBACK ONLY. The active
     * cost-ceiling check in `gate_wiring.ts` reads this ceiling via
     * `createEnvCostBudget` (apps/orchestrator/src/cost-budget-env.ts)
     * and reports `spentUsd = 0` — the policy is permissive. v0.2
     * replaces the adapter with `cost-budget-agent.ts`, which calls
     * the live Cost agent MCP server (FORA-149 / FORA-150) and
     * enforces per-tenant overrides stored by the Cost agent. After
     * v0.2 ships, this env hook becomes a deployment default that the
     * Cost agent overrides at lookup time; it does not disappear.
     */
    defaultCostCeilingUsd: string;
    /** Log level — passed to pino verbatim. */
    logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
    /** Disable HTTP logging in tests. */
    env: 'dev' | 'test' | 'prod';
    /**
     * URL to the broker's JWKS document. The broker publishes its
     * ES256 public key at `{IDENTITY_BROKER_PUBLIC_URL}/.well-known/jwks.json`;
     * default `http://localhost:8080/.well-known/jwks.json` matches the
     * identity-broker default port. Production sets this to the broker's
     * canonical URL.
     */
    jwtVerifierUrl: string;
    /**
     * Expected `iss` claim — must match `BrokerConfig.issuer`. Default
     * `identity-broker.fora.local` matches the broker's default
     * `IDENTITY_BROKER_PUBLIC_URL=http://localhost:8080` derivation.
     */
    jwtIssuer: string;
    /** Expected `aud` claim — must match `BrokerConfig.audience`. Default `forge-runtime`. */
    jwtAudience: string;
    /**
     * When true (default), every request MUST carry a valid JWT. The
     * only opt-out path is local dev: a warning is logged at boot and
     * the hook falls back to the legacy `x-fora-tenant-id` header.
     * Production MUST run with `FORA_REQUIRE_JWT=true`.
     */
    requireJwt: boolean;
    /** Accept a clock skew of up to N seconds on `exp` / `nbf`. Default 0. */
    jwtClockToleranceSec: number;
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): OrchestratorConfig;

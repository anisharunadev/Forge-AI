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
const DEFAULT_PORT = 8082;
const DEFAULT_BROKER_BASE_URL = 'http://localhost:8080';
const DEFAULT_JWT_ISSUER = 'identity-broker.fora.local';
const DEFAULT_JWT_AUDIENCE = 'forge-runtime';
export function loadConfig(env = process.env) {
    const port = parseInt(env['FORA_ORCHESTRATOR_PORT'] ?? `${DEFAULT_PORT}`, 10);
    const host = env['FORA_ORCHESTRATOR_HOST'] ?? '0.0.0.0';
    const databaseUrl = env['FORA_DATABASE_URL'] ?? '';
    if (!databaseUrl) {
        throw new Error('FORA_DATABASE_URL is required (Postgres connection string)');
    }
    const defaultCostCeilingUsd = env['FORA_DEFAULT_COST_CEILING_USD'] ?? '100.00';
    const logLevel = (env['FORA_ORCHESTRATOR_LOG_LEVEL'] ?? 'info');
    const envName = (env['FORA_ENV'] ?? 'dev');
    // v1.1 JWT — FORA-526. Defaults match the identity-broker's local dev
    // defaults; override via env in any non-local deployment.
    const brokerBaseUrl = env['IDENTITY_BROKER_PUBLIC_URL'] ?? DEFAULT_BROKER_BASE_URL;
    const jwtVerifierUrl = env['FORA_JWT_VERIFIER_URL'] ?? `${brokerBaseUrl.replace(/\/$/, '')}/.well-known/jwks.json`;
    const jwtIssuer = env['FORA_JWT_ISSUER'] ?? DEFAULT_JWT_ISSUER;
    const jwtAudience = env['FORA_JWT_AUDIENCE'] ?? DEFAULT_JWT_AUDIENCE;
    const requireJwtRaw = env['FORA_REQUIRE_JWT'] ?? 'true';
    const requireJwt = !(requireJwtRaw === 'false' || requireJwtRaw === '0');
    const jwtClockToleranceSec = parseInt(env['FORA_JWT_CLOCK_TOLERANCE_SEC'] ?? '0', 10);
    return {
        port: Number.isFinite(port) ? port : DEFAULT_PORT,
        host,
        databaseUrl,
        defaultCostCeilingUsd,
        logLevel,
        env: envName,
        jwtVerifierUrl,
        jwtIssuer,
        jwtAudience,
        requireJwt,
        jwtClockToleranceSec: Number.isFinite(jwtClockToleranceSec) ? jwtClockToleranceSec : 0,
    };
}
//# sourceMappingURL=config.js.map
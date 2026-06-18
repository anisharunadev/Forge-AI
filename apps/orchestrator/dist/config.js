/**
 * Environment-driven config — single point of import.
 *
 * Mirrors the identity-broker pattern (apps/identity-broker/src/config.ts).
 * The Orchestrator does not need OIDC validation in v0.1 — the public
 * REST surface trusts the gateway upstream to have verified the JWT
 * and stamped `tenant_id` on the verified-claim header. A v1.1 ADR
 * moves validation in-process per ADR-0003 §3.2.
 */
const DEFAULT_PORT = 8082;
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
    return {
        port: Number.isFinite(port) ? port : DEFAULT_PORT,
        host,
        databaseUrl,
        defaultCostCeilingUsd,
        logLevel,
        env: envName,
    };
}
//# sourceMappingURL=config.js.map
/**
 * Environment-driven config — single point of import.
 *
 * Mirrors the identity-broker pattern (apps/identity-broker/src/config.ts).
 * The Orchestrator does not need OIDC validation in v0.1 — the public
 * REST surface trusts the gateway upstream to have verified the JWT
 * and stamped `tenant_id` on the verified-claim header. A v1.1 ADR
 * moves validation in-process per ADR-0003 §3.2.
 */

export interface OrchestratorConfig {
  /** HTTP port. Default 8082 (chosen to avoid the identity-broker 8080 and runtime 8081). */
  port: number;
  /** Hostname to bind. */
  host: string;
  /** Postgres connection string (read by the db-pool package). */
  databaseUrl: string;
  /** Default per-run cost ceiling in USD; FORA-50 §3.1 rev 2 = $100. */
  defaultCostCeilingUsd: string;
  /** Log level — passed to pino verbatim. */
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  /** Disable HTTP logging in tests. */
  env: 'dev' | 'test' | 'prod';
}

const DEFAULT_PORT = 8082;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  const port = parseInt(env['FORA_ORCHESTRATOR_PORT'] ?? `${DEFAULT_PORT}`, 10);
  const host = env['FORA_ORCHESTRATOR_HOST'] ?? '0.0.0.0';
  const databaseUrl = env['FORA_DATABASE_URL'] ?? '';
  if (!databaseUrl) {
    throw new Error('FORA_DATABASE_URL is required (Postgres connection string)');
  }
  const defaultCostCeilingUsd = env['FORA_DEFAULT_COST_CEILING_USD'] ?? '100.00';
  const logLevel = (env['FORA_ORCHESTRATOR_LOG_LEVEL'] ?? 'info') as OrchestratorConfig['logLevel'];
  const envName = (env['FORA_ENV'] ?? 'dev') as OrchestratorConfig['env'];
  return {
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    host,
    databaseUrl,
    defaultCostCeilingUsd,
    logLevel,
    env: envName,
  };
}

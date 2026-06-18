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
export declare function loadConfig(env?: NodeJS.ProcessEnv): OrchestratorConfig;

/**
 * Model registry.
 *
 * Centralizes the list of multi-tenant tables the runner bootstraps. The
 * property-based test reads from this list to fuzz every model. Adding a
 * new model is one entry here — there is no other place the table name
 * lives, and the runner refuses to apply a migration for a model not in
 * the registry.
 */
import type { TenantScopedModel } from './types.js';
/**
 * FORA multi-tenant model registry. v1 ships the four tables that the
 * identity-broker and the agent-runtime touch in production:
 *  - `tenants`           the root table; the FK target for every other model
 *  - `users`             tenant-scoped principal records (mirrored from IdP)
 *  - `sessions`          tenant-scoped session records (broker-issued)
 *  - `agent_runs`        tenant-scoped run records (runtime-issued)
 *
 * The `tenants` table is special: it is the bootstrap and does not carry
 * RLS. The runner enforces this.
 */
export declare const FORA_MODELS: ReadonlyArray<TenantScopedModel>;
/** The bootstrap model — `tenants` itself does not carry RLS. */
export declare const TENANTS_MODEL_NAME: "tenants";
/** The other (RLS-bearing) models in the registry. */
export declare function getRlsModels(): ReadonlyArray<TenantScopedModel>;

/**
 * RLS SQL emitter.
 *
 * Pure functions that turn a {@link TenantScopedModel} into the canonical
 * Postgres DDL/DCL the runner applies. The output is a single SQL string
 * per model, with statements separated by `;\n\n` so the runner can split
 * and apply them in a transaction.
 *
 * Canonical policy shape (FORA-124 acceptance bar #1):
 *
 *   CREATE POLICY tenant_isolation ON <table>
 *     USING (tenant_id = coalesce(
 *       nullif(current_setting('app.tenant_id', true), '')::uuid,
 *       '00000000-0000-0000-0000-000000000000'::uuid
 *     ));
 *
 * The `coalesce(..., nil_uuid)` is the sentinel that matches zero rows
 * when `app.tenant_id` is unset or empty. A misconfigured pool cannot
 * read the entire table because the GUC is unset and the sentinel
 * matches nothing.
 *
 * `FORCE ROW LEVEL SECURITY` ensures even the table owner is gated by
 * the policy. Without it, a `postgres` superuser or table owner could
 * bypass RLS by connecting directly.
 */
import type { TenantScopedModel } from './types.js';
/** The nil UUID used as the sentinel default. Matches zero rows in practice. */
export declare const NIL_UUID: "'00000000-0000-0000-0000-000000000000'::uuid";
/** The name of the GUC the connection pool sets on every connect. */
export declare const APP_TENANT_ID_GUC: "'app.tenant_id'";
/** The canonical policy name. The lint rule in 0.7.2d references this string. */
export declare const TENANT_ISOLATION_POLICY: "tenant_isolation";
/** Validate a Postgres identifier. The runner refuses to emit SQL otherwise. */
export declare function isValidIdentifier(s: string): boolean;
/**
 * Emit the canonical `tenant_isolation` policy body.
 *
 * The shape is fixed and is what the lint rule in 0.7.2d will check for.
 * Do not change it without an ADR; the property-based test asserts the
 * exact substring.
 */
export declare function tenantIsolationPolicyExpr(): string;
/**
 * Emit the full DDL for a single multi-tenant model.
 *
 * Returns a SQL string with statements separated by `;\n\n`. The caller
 * is expected to wrap the apply in a transaction.
 */
export declare function emitModelDdl(model: TenantScopedModel): string;
/** Emit DDL for a list of RLS-bearing models. The caller passes the list
 *  (typically from {@link getRlsModels}) so this module has no dependency
 *  on the registry. */
export declare function emitAllRlsModels(models: ReadonlyArray<TenantScopedModel>): string;

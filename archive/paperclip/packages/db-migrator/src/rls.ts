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

import type { ColumnSpec, TenantScopedModel } from './types.js';

/** The nil UUID used as the sentinel default. Matches zero rows in practice. */
export const NIL_UUID = "'00000000-0000-0000-0000-000000000000'::uuid" as const;

/** The name of the GUC the connection pool sets on every connect. */
export const APP_TENANT_ID_GUC = "'app.tenant_id'" as const;

/** The canonical policy name. The lint rule in 0.7.2d references this string. */
export const TENANT_ISOLATION_POLICY = 'tenant_isolation' as const;

/** Reserved column names the runner adds to every multi-tenant table. */
const RESERVED_COLUMNS = new Set(['id', 'created_at', 'tenant_id']);

/** Validate a Postgres identifier. The runner refuses to emit SQL otherwise. */
export function isValidIdentifier(s: string): boolean {
  return /^[a-z_][a-z0-9_]{0,62}$/.test(s);
}

function emitColumn(c: ColumnSpec): string {
  if (!isValidIdentifier(c.name)) {
    throw new Error(`Invalid column name: ${c.name}`);
  }
  const parts: string[] = [`"${c.name}"`, c.type];
  if (c.notNull) parts.push('NOT NULL');
  if (c.unique) parts.push('UNIQUE');
  if (c.default) parts.push(`DEFAULT ${c.default}`);
  if (c.references) parts.push(`REFERENCES ${c.references}`);
  return parts.join(' ');
}

/** The columns the runner adds to every model in addition to caller-supplied ones. */
function systemColumns(): string[] {
  return [
    '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid()',
    '"created_at" timestamptz NOT NULL DEFAULT now()',
    '"tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
  ];
}

/**
 * Emit the canonical `tenant_isolation` policy body.
 *
 * The shape is fixed and is what the lint rule in 0.7.2d will check for.
 * Do not change it without an ADR; the property-based test asserts the
 * exact substring.
 */
export function tenantIsolationPolicyExpr(): string {
  return (
    `tenant_id = coalesce(` +
    `nullif(current_setting(${APP_TENANT_ID_GUC}, true), '')::uuid, ` +
    `${NIL_UUID})`
  );
}

/**
 * Emit the full DDL for a single multi-tenant model.
 *
 * Returns a SQL string with statements separated by `;\n\n`. The caller
 * is expected to wrap the apply in a transaction.
 */
export function emitModelDdl(model: TenantScopedModel): string {
  if (!isValidIdentifier(model.name)) {
    throw new Error(`Invalid model name: ${model.name}`);
  }
  for (const c of model.columns) {
    if (RESERVED_COLUMNS.has(c.name)) {
      throw new Error(
        `Column "${c.name}" is reserved (added by the runner). Remove it from ${model.name}.`,
      );
    }
  }

  const allColumns = [...systemColumns(), ...model.columns.map(emitColumn)];

  const createTable =
    `-- model: ${model.name}` +
    (model.description ? `\n-- ${model.description}` : '') +
    `\nCREATE TABLE "${model.name}" (\n  ${allColumns.join(',\n  ')}\n);`;

  // The runner does not enable RLS on `tenants` itself — it is the bootstrap.
  if (model.name === 'tenants') {
    return createTable + ';\n\n';
  }

  const enableRls = `ALTER TABLE "${model.name}" ENABLE ROW LEVEL SECURITY;`;
  const forceRls = `ALTER TABLE "${model.name}" FORCE ROW LEVEL SECURITY;`;
  const createPolicy =
    `CREATE POLICY ${TENANT_ISOLATION_POLICY} ON "${model.name}"\n` +
    `  USING (${tenantIsolationPolicyExpr()});`;
  // Belt-and-braces: drop and recreate so the apply is idempotent.
  const dropPolicyFirst =
    `DROP POLICY IF EXISTS ${TENANT_ISOLATION_POLICY} ON "${model.name}";`;

  return [createTable, dropPolicyFirst, enableRls, forceRls, createPolicy].join('\n\n') + '\n\n';
}

/** Emit DDL for a list of RLS-bearing models. The caller passes the list
 *  (typically from {@link getRlsModels}) so this module has no dependency
 *  on the registry. */
export function emitAllRlsModels(models: ReadonlyArray<TenantScopedModel>): string {
  return models.map(emitModelDdl).join('\n');
}

/**
 * Types for @fora/db-migrator.
 *
 * The runner is intentionally tiny: a model is a list of columns, and the
 * runner emits the SQL for the table, the RLS policy, and the role grants.
 * Keeping the shape flat makes the BYPASSRLS audit and the property-based
 * test trivial — there is no codegen, no DSL, no surprises.
 */

/** A column on a multi-tenant table. */
export interface ColumnSpec {
  /** Postgres identifier (snake_case). Must be a valid identifier, no quoting. */
  name: string;
  /** Postgres type expression, e.g. `text`, `uuid`, `timestamptz`, `jsonb`. */
  type: string;
  /** Whether the column is `NOT NULL`. Defaults to false. */
  notNull?: boolean;
  /** Whether the column is `UNIQUE` (in addition to any PK). Defaults to false. */
  unique?: boolean;
  /** Default expression as raw SQL, e.g. `now()`, `gen_random_uuid()`. */
  default?: string;
  /** Foreign-key reference, e.g. `tenants(id)`. */
  references?: string;
}

/**
 * Declarative description of a multi-tenant table.
 *
 * The runner emits a migration that creates the table with `id`,
 * `created_at`, and `tenant_id` (FK to `tenants(id)`) in addition to the
 * caller-supplied columns. RLS is enabled and forced; the `tenant_isolation`
 * policy is created on every table. The runner refuses to run if the model
 * name is `tenants` itself — the tenants table is the bootstrap and does
 * not carry RLS.
 */
export interface TenantScopedModel {
  /** Postgres table name (snake_case, plural, e.g. `customers`). */
  name: string;
  /** Caller-supplied columns. The runner adds id, created_at, tenant_id. */
  columns: ReadonlyArray<ColumnSpec>;
  /**
   * Optional human-readable description used in the migration comment.
   * The runner surfaces this in `pg_description` so the catalog is self-documenting.
   */
  description?: string;
}

/**
 * The two paths in the repo where `BYPASSRLS` grants are allowed.
 * The runner scans these paths for `BYPASSRLS` and refuses to apply if a
 * `BYPASSRLS` grant is added anywhere else.
 */
export interface BypassRlsAllowList {
  migrationsDir: string;
  auditDir: string;
}

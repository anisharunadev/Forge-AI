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
 * FORA multi-tenant model registry. 0.1 ships the five tables the
 * identity-broker + agent-runtime + Master Orchestrator touch in production:
 *  - `tenants`           the root table; the FK target for every other model
 *  - `users`             tenant-scoped principal records (mirrored from IdP)
 *  - `sessions`          tenant-scoped session records (broker-issued)
 *  - `agent_runs`        tenant-scoped run records (FORA-50 §3.1; Orchestrator-owned)
 *  - `agent_run_stages`  tenant-scoped stage rows per run (FORA-50 §3.2; Orchestrator-owned)
 *
 * `agent_run_events` (FORA-50 §3.3) and `agent_run_approvals` (FORA-50 §3.4)
 * are not in this registry because they are not standard tenant-isolation
 * tables — the events table is append-only with a trigger that forbids
 * UPDATE/DELETE (see ADR-0009 §5), and the approvals table is owned by
 * FORA-137 (human-approval router). They land as raw-SQL migrations in
 * `migrations/0003_*` and `migrations/0004_*` when those sub-tasks ship.
 *
 * The `tenants` table is special: it is the bootstrap and does not carry
 * RLS. The runner enforces this.
 */
export const FORA_MODELS: ReadonlyArray<TenantScopedModel> = [
  {
    name: 'tenants',
    description: 'Root tenant table. The FK target for every other model. No RLS (bootstrap).',
    columns: [
      { name: 'slug', type: 'text', notNull: true, unique: true },
      { name: 'name', type: 'text', notNull: true },
    ],
  },
  {
    name: 'users',
    description: 'Tenant-scoped principal records, mirrored from the IdP.',
    columns: [
      { name: 'idp_subject', type: 'text', notNull: true },
      { name: 'email', type: 'text', notNull: true },
      { name: 'display_name', type: 'text' },
    ],
  },
  {
    name: 'sessions',
    description: 'Tenant-scoped session records issued by the identity-broker.',
    columns: [
      { name: 'session_id', type: 'text', notNull: true, unique: true },
      { name: 'user_id', type: 'uuid', notNull: true, references: 'users(id)' },
      { name: 'issued_at', type: 'timestamptz', notNull: true, default: 'now()' },
      { name: 'expires_at', type: 'timestamptz', notNull: true },
    ],
  },
  {
    // FORA-50 §3.1 — Master Orchestrator session lifecycle.
    // Owned by FORA-134 (this issue). CHECK constraints, partial indexes,
    // and the soft-delete invariant are applied in
    // `migrations/0002_orchestrator_constraints_and_indexes.sql` because
    // the registry's ColumnSpec cannot express CHECK or partial WHERE.
    //
    // The placeholder `agent_runs` entry from 0.7.2a was a stub; nothing
    // reads or writes the table yet, so the spec-aligned shape ships in
    // 0.1 of the Orchestrator.
    name: 'agent_runs',
    description: 'FORA-50 §3.1 — run header. One row per Master Orchestrator run.',
    columns: [
      { name: 'goal_id', type: 'text', notNull: true },
      { name: 'project_id', type: 'text', notNull: true },
      // status / current_stage are text here; the CHECK constraint and
      // enum values are added in 0002_*.sql. The runner's ColumnSpec
      // does not support CHECK inline.
      { name: 'status', type: 'text', notNull: true },
      { name: 'current_stage', type: 'text', notNull: true },
      { name: 'triggered_by', type: 'jsonb', notNull: true },
      // cost_ceiling_usd default is $100/run per FORA-50 §3.1 (rev 2
      // editorial). Tenant overrides live in tenants/{id}/policy.yaml
      // per ADR-0003 §5.2; a v1.1 ADR introduces the override table.
      { name: 'cost_ceiling_usd', type: 'numeric(10,2)', notNull: true, default: '100.00' },
      { name: 'cost_spent_usd', type: 'numeric(10,2)', notNull: true, default: '0' },
      // started_at / finished_at are nullable: a run header is written
      // at creation time (status='created'), before the first stage
      // starts. finished_at is set when status flips to 'done' or
      // 'aborted'. The spec lists both as nullable timestamptz.
      { name: 'started_at', type: 'timestamptz' },
      { name: 'finished_at', type: 'timestamptz' },
      // soft-delete + cold-tier markers per ADR-0009 §5/§7. The partial
      // indexes that filter on `deleted_at IS NULL` are in 0002_*.sql.
      { name: 'deleted_at', type: 'timestamptz' },
      { name: 'archived_at', type: 'timestamptz' },
    ],
  },
  {
    // FORA-50 §3.2 — Master Orchestrator stage rows. One row per
    // (run, stage) pair; the seven canonical stages ship on run creation
    // in `Orchestrator.createRun`. The composite unique (run_id, stage)
    // is added in 0002_*.sql because the registry's ColumnSpec does not
    // express composite uniques.
    //
    // A stage row inherits the run's deleted_at via JOIN — see ADR-0009
    // §3. The API never queries stages for a soft-deleted run.
    name: 'agent_run_stages',
    description: 'FORA-50 §3.2 — seven stage rows per run, written on creation.',
    columns: [
      { name: 'run_id', type: 'uuid', notNull: true, references: 'agent_runs(id)' },
      { name: 'stage', type: 'text', notNull: true },
      { name: 'status', type: 'text', notNull: true },
      // decision is the typed record written by the gate: {by, at,
      // reason, artefact_refs[]}. Nullable until the gate decides.
      { name: 'decision', type: 'jsonb' },
      { name: 'started_at', type: 'timestamptz' },
      { name: 'finished_at', type: 'timestamptz' },
    ],
  },
];

/** The bootstrap model — `tenants` itself does not carry RLS. */
export const TENANTS_MODEL_NAME = 'tenants' as const;

/** The other (RLS-bearing) models in the registry. */
export function getRlsModels(): ReadonlyArray<TenantScopedModel> {
  return FORA_MODELS.filter((m) => m.name !== TENANTS_MODEL_NAME);
}

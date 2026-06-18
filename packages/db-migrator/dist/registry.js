/**
 * Model registry.
 *
 * Centralizes the list of multi-tenant tables the runner bootstraps. The
 * property-based test reads from this list to fuzz every model. Adding a
 * new model is one entry here — there is no other place the table name
 * lives, and the runner refuses to apply a migration for a model not in
 * the registry.
 */
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
export const FORA_MODELS = [
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
        name: 'agent_runs',
        description: 'Tenant-scoped run records issued by the agent-runtime.',
        columns: [
            { name: 'run_id', type: 'text', notNull: true, unique: true },
            { name: 'agent_id', type: 'text', notNull: true },
            { name: 'stage', type: 'text', notNull: true },
            { name: 'status', type: 'text', notNull: true },
            { name: 'started_at', type: 'timestamptz', notNull: true, default: 'now()' },
        ],
    },
];
/** The bootstrap model — `tenants` itself does not carry RLS. */
export const TENANTS_MODEL_NAME = 'tenants';
/** The other (RLS-bearing) models in the registry. */
export function getRlsModels() {
    return FORA_MODELS.filter((m) => m.name !== TENANTS_MODEL_NAME);
}
//# sourceMappingURL=registry.js.map
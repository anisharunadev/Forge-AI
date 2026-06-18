/**
 * @fora/cache-broker — types
 *
 * The request envelope the broker binds to every cache read/write. Mirrors the
 * claim set defined in ADR-0003 §3.2; the broker only sees the fields it needs
 * (`tenant_id`, `principal`, `trace_id`) plus a free-form `actor` for audit.
 *
 * The broker NEVER trusts a tenant_id that comes from the call site. The
 * `RequestContext.tenant_id` MUST be the claim from the verified JWT, set by
 * the identity broker (FORA-123). Application code passes the context through;
 * it cannot mint one.
 */
/** Error thrown when a caller attempts to `set` with a key that does not match the bound context. */
export class TenantMismatchError extends Error {
    attempted_tenant_id;
    actual_tenant_id;
    kind = 'tenant_mismatch';
    constructor(message, attempted_tenant_id, actual_tenant_id) {
        super(message);
        this.attempted_tenant_id = attempted_tenant_id;
        this.actual_tenant_id = actual_tenant_id;
        this.name = 'TenantMismatchError';
    }
}
//# sourceMappingURL=types.js.map
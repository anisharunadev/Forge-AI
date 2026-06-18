/**
 * Types shared between the router, ports, sweeper, and tests.
 *
 * Lives in its own module so `ports.ts` (which `router.ts` imports)
 * and `router.ts` (which `sweeper.ts` imports) do not form a cycle.
 */
/**
 * Helper: derive the gate from the persisted record. Pure; used by
 * the sweeper and tests to look up TTL + continuation policy without
 * a second query.
 */
export function gateOf(record) {
    return record.gate_kind;
}
/** Helper: true iff the interaction primitive for `kind` matches `p`. */
export function primitiveMatches(kind, p) {
    // Lazy import to avoid cycle with gates.ts; the table is stable.
    // The mapping is fixed in the gate definition; this helper exists
    // so callers do not duplicate the lookup logic.
    if (kind === 'launch')
        return p === 'request_board_approval';
    return p === 'request_confirmation';
}
//# sourceMappingURL=router-types.js.map
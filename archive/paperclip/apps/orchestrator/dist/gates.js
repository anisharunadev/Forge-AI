/**
 * The eight Orchestrator gates — typed, exhaustive.
 *
 * Source of truth: [FORA-50 spec §6.1](/FORA/issues/FORA-50#document-spec) and
 * [ADR-0008 §3](/FORA/docs/architecture/adr-0008-paperclip-approvals.md).
 *
 * The gate table is a one-way door. Adding a gate, changing the role of
 * record, or changing the TTL all require an ADR per architecture.md §5.
 * The eval test in `test/gates.test.ts` asserts every (gate → role) pair
 * so a drift between the spec and the code fails loud.
 *
 * The seven stage transitions + the customer-facing launch gate. The
 * customer-facing launch gate is the only `board` gate; all others are
 * per-stage `request_confirmation` interactions.
 */
/** TTL in milliseconds, derived from the tier. The sweeper uses this. */
export function ttlMs(tier) {
    switch (tier) {
        case 'board_24h':
            return 24 * 60 * 60 * 1000;
        case 'cto_4h':
            return 4 * 60 * 60 * 1000;
        case 'engineering_1h':
            return 60 * 60 * 1000;
    }
}
/**
 * True iff the tier is a "page the approver at 50% TTL" tier. The
 * default TTL policy (FORA-50 §6.1) is 50%-paging for all gates;
 * the constant is here so a future tier that doesn't page (e.g. a
 * fully automated gate) can opt out without surgery.
 */
export function pagesAt50Percent(tier) {
    // Today every tier pages at 50%; the constant exists for the
    // future automated tier referenced in ADR-0008 §11.
    return true;
}
/**
 * The eight gates, in the order they appear in the spec table. The
 * iteration order is the public order so test snapshots and audit
 * logs read top-to-bottom matching the spec.
 */
export const GATES = [
    {
        kind: 'ideation->architect',
        from: 'ideation',
        to: 'architect',
        required_role: 'product',
        approver: 'CEO or Product',
        ttl: 'board_24h',
        escalation: 'board',
        primitive: 'request_confirmation',
        continuation: 'wake_assignee',
    },
    {
        kind: 'architect->dev',
        from: 'architect',
        to: 'dev',
        required_role: 'cto',
        approver: 'CTO',
        ttl: 'cto_4h',
        escalation: 'board',
        primitive: 'request_confirmation',
        continuation: 'wake_assignee',
    },
    {
        kind: 'dev->qa',
        from: 'dev',
        to: 'qa',
        required_role: 'qa',
        approver: 'Dev owner (CODEOWNERS)',
        ttl: 'engineering_1h',
        escalation: 'cto',
        primitive: 'request_confirmation',
        continuation: 'wake_assignee',
    },
    {
        kind: 'qa->security',
        from: 'qa',
        to: 'security',
        required_role: 'security',
        approver: 'QA lead',
        ttl: 'engineering_1h',
        escalation: 'cto',
        primitive: 'request_confirmation',
        continuation: 'wake_assignee',
    },
    {
        kind: 'security->devops',
        from: 'security',
        to: 'devops',
        required_role: 'devops',
        approver: 'Security lead',
        ttl: 'engineering_1h',
        escalation: 'cto',
        primitive: 'request_confirmation',
        continuation: 'wake_assignee',
    },
    {
        kind: 'devops->docs',
        from: 'devops',
        to: 'docs',
        required_role: 'docs',
        approver: 'DevOps lead',
        ttl: 'engineering_1h',
        escalation: 'cto',
        primitive: 'request_confirmation',
        continuation: 'wake_assignee',
    },
    {
        kind: 'docs->done',
        from: 'docs',
        to: null,
        required_role: 'docs',
        approver: 'Doc lead',
        ttl: 'engineering_1h',
        escalation: 'cto',
        primitive: 'request_confirmation',
        continuation: 'wake_assignee',
    },
    {
        kind: 'launch',
        from: null,
        to: null,
        required_role: 'board',
        approver: 'Board',
        ttl: 'board_24h',
        escalation: 'none',
        primitive: 'request_board_approval',
        continuation: 'wake_assignee_on_accept',
    },
];
/** Look up a gate definition by kind. Returns `null` on miss. */
export function findGate(kind) {
    return GATES.find((g) => g.kind === kind) ?? null;
}
/** True iff `from → to` is the gate `kind`. Convenience for the engine. */
export function isStageTransition(kind, from, to) {
    const gate = findGate(kind);
    if (!gate)
        return false;
    // docs->done is the special "stage null" gate — the run advances to
    // the `done` run status, not to another stage column.
    if (to === 'done') {
        return gate.from === from && gate.to === null;
    }
    return gate.from === from && gate.to === to;
}
/**
 * The full table is also exposed as a typed map keyed by kind for O(1)
 * lookups by callers that already know the gate. The map is built from
 * the array so the two stay in lockstep.
 */
export const GATE_BY_KIND = Object.freeze(GATES.reduce((acc, g) => {
    acc[g.kind] = g;
    return acc;
}, {}));
//# sourceMappingURL=gates.js.map
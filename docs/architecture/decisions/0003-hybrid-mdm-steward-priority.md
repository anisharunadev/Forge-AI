# ADR-003: Hybrid MDM + Steward priority conflict resolution

- Status: Accepted
- Date: 2026-06-20
- Deciders: Forge Architecture Working Group
- Related research: [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q2)

## Context and Problem Statement

Forge ingests project intelligence from many sources (GitHub, Bitbucket, Jira, Confluence, Figma, Slack, code, docs). The same domain entity - for example, a service definition, an API contract, a database record, an architectural decision - is frequently described in multiple sources with divergent values. The Jira ticket says authentication is via Cognito; the code says Keycloak; the Confluence architecture page says Auth0. The system must decide which value to surface as canonical without masking the conflict or silently dropping one source's view.

OQ-007 in the PRD asks for an explicit source-of-truth conflict policy.

The forces at play:

- Multi-source ingestion is core to project intelligence (F-101..F-115).
- Silent auto-merge hides data quality problems and makes the M3 demo unsellable.
- Pure last-write-wins is too coarse: it ignores domain semantics (runtime truth vs. human-process truth).
- Pure MDM with no override is too rigid: source systems move fast and need to win for their domain.
- Conflicts must be auditable: who decided, when, why, with what provenance.

## Decision Drivers

- OQ-007: source-of-truth conflict policy
- NFR-006: Auditability and tenant isolation
- NFR-031: Knowledge freshness as architectural invariant
- F-111: Incremental sync with conflict handling
- Rule 6: Mandatory auditability
- A-007 (single graph engine) - conflicts surface as graph node states

## Considered Options

- Hybrid MDM with Steward priority (chosen)
- Pure last-write-wins (timestamp-based)
- Pure MDM with no override
- CRDT (Conflict-free Replicated Data Types)
- Event sourcing with replay

## Decision Outcome

Chosen option: **Hybrid Master Data Management (MDM) with Steward priority**.

Mechanics:

1. Each knowledge graph node carries a `provenance[]` array listing every source that contributed to it. Each provenance entry includes: `source_id`, `value`, `confidence`, `received_at`, `received_by`.
2. A `priority_policy` table (Steward-editable per tenant) declares the per-entity-type priority order across sources.
3. When ingestion finds a divergence (new provenance disagrees with current canonical value):
   - The node enters a `conflicted` state.
   - A `conflict_events` record is created with both old and new values and full provenance.
   - The system applies the priority policy to compute a **suggested winner** (a non-binding preview for human review).
   - The conflict is surfaced in the UI as a pending decision.
4. Steward (or Architect, depending on entity type) reviews the conflict.
5. Resolution options:
   - **Accept suggested winner**: apply policy-derived value, record audit entry with policy citation.
   - **Override**: apply human-chosen value, record audit entry with reason and actor.
   - **Reject (revert)**: keep prior canonical value, record audit entry.
6. Once resolved, the conflict event is closed and the node leaves `conflicted` state.
7. If no Steward is configured for an entity type, the system falls back to **last-write-wins** with the full audit trail (timestamp + provenance).

Default policy seeded at install:

- **Code wins for runtime truth** (services, APIs, databases).
- **Jira wins for human-process truth** (workflow state, ownership).
- **Explicit human override wins for everything else.**

### Consequences

Positive:

- Deterministic: same inputs plus same policy produce the same suggested winner.
- Audit-friendly: every conflict, suggestion, and resolution is captured (Rule 6, NFR-020).
- Allows expert override for domain-aware edge cases.
- Provenance array preserves every source's view; nothing is dropped silently.
- Pilot will surface dozens of conflicts on day one; the workflow handles them explicitly rather than masking them.

Negative:

- Requires per-entity-type Steward role configuration per tenant.
- Conflict review becomes a real workload (Steward time) for tenants with messy brownfield intake.
- The `conflicted` state must be visible in the UI; otherwise conflicts accumulate invisibly.

Neutral:

- Resolution time becomes a measurable artifact (time-to-resolve per conflict), feeding pilot metrics.

## Alternatives Considered

### Pure last-write-wins

Pros:

- Simplest possible policy.
- No Steward configuration needed.

Cons:

- Ignores domain semantics: a stale Jira ticket's comment timestamp may override the canonical runtime config in the code.
- No expert override mechanism.
- Conflicts are resolved silently with no audit entry beyond the timestamp.
- Rejected: too coarse for multi-domain ingestion.

### Pure MDM with no override

Pros:

- Strict canonical source per entity type.
- Easy to reason about.

Cons:

- Source systems move fast; the canonical source may be stale for hours or days.
- No mechanism for expert override when the policy is wrong for a specific edge case.
- Rejected: too rigid for fast-moving source systems in a pilot.

### CRDT (Conflict-free Replicated Data Types)

Pros:

- Mathematically convergent without coordination.
- Strong eventual consistency guarantees.

Cons:

- Does not naturally fit an audit-first architecture (every merge is anonymous).
- Hard to surface "this is in conflict" semantics - CRDTs converge silently.
- Significant complexity for a domain where the conflicts are semantically meaningful (code vs. docs vs. tickets).
- Rejected: leaks abstraction; doesn't fit audit and Steward needs.

### Event sourcing with replay

Pros:

- Full history; conflict resolution can be derived from event sequence.
- Strong audit story.

Cons:

- The "canonical" value is whatever the last event says - same coarse problem as last-write-wins unless paired with priority rules.
- Adds event-store infrastructure that duplicates the audit log.
- Rejected as a standalone option; provenance is logged but priority rules remain the resolution mechanism.

## Pros and Cons of the Chosen Option

Pros:

- Aligns with MDM golden-record patterns proven in master-data literature.
- Lets the priority policy capture domain semantics (code vs. Jira vs. Confluence) declaratively.
- Override + audit handles pilot-day-one conflicts without masking.
- Co-locates with the Apache AGE graph: the provenance array and conflict state live on the graph node itself.

Cons:

- Adds two new tables (`priority_policy`, `conflict_events`) and a UI surface (Steward conflict queue).
- Steward role must be defined per tenant.

## References

- [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q2 Source-of-Truth Conflict)
- ADR-002: PostgreSQL 17 + Apache AGE + pgvector (provenance lives on graph nodes)
- ADR-008: Append-only WORM audit trail (conflict events recorded immutably)
- Constitution Rule 6 (Mandatory auditability)
- PRD OQ-007, NFR-020, NFR-031, F-111
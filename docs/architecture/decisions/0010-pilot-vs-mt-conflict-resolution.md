# ADR-010: Pilot-vs-Multi-Tenant Conflict-Resolution Policy

- Status: Accepted
- Date: 2026-06-26
- Deciders: Forge Architecture Working Group
- Related research: docs/research-forge-architecture-decisions-2026-06-20.md (Q4 multi-tenant rollout topology)

## Context and Problem Statement

Forge AI's M2 substrate lock introduces two distinct tenancy operating modes:

1. **Pilot mode** — single-tenant (or invited-design-partner) deployments where the customer is onboarded to a dedicated logical isolation unit (one AWS account, one Aurora cluster, one KMS key) and the Forge team operates as a managed service. Pilot tenants share no infrastructure with any other tenant.
2. **Multi-tenant (MT) mode** — production rollouts where the same control-plane substrate serves many tenants side-by-side with row-level security (RLS) on every tenant-scoped table (Rule 2, ADR-002). MT tenants share an Aurora cluster, share the shared services plane (artifact registry, approval-gate scheduler), and only differ on per-tenant KMS keys (ADR-011).

The migration path from pilot to MT for any single customer — or the inverse direction (rare, but documented for completeness) — passes through a **conflict-resolution boundary**: configuration values, deployment topologies, security postures, and cost caps diverge between the two modes. When a mechanism designed for pilot collides with one designed for MT — or vice versa — we must answer the question **whose policy wins, and through what escalation path** before the conflict hits a customer.

The forces at play:

- Pilot tenants expect the "managed service" treatment: a single Forge SRE has authority to override any setting in flight; pilot customers are explicitly opted into experiment-tariff features.
- MT tenants expect strict isolation: no privileged shared-services path may mutate a tenant's data plane; every override is review-board-gated and audit-logged.
- Conflicts surface in five recurring categories across customer evidence + load-test fallout: **architecture overlap** (two tenants proposing competing source-of-truth schemas for the same global resource), **security conflict** (a pilot's permissive security policy clashes with MT's deny-by-default), **deployment conflict** (two tenants each pinning the same deployment slot), **cost cap exceeded** (a single tenant's spike breaches the cumulative cap defined in ADR-009), and **schema drift** (one tenant's database schema evolves out of band while another relies on the row-shape frozen in ADR-002).
- ADRs are immutable history: the policy must be a decision once made, not relitigated per-incident.

We must choose a single policy that says "in pilot X happens, in MT Y happens, and in either case the escalation is Z."

## Decision Drivers

- Rule 2: Multi-tenancy with RLS — every tenant-scoped table carries `tenant_id` + `project_id`, RLS-enforced.
- Rule 3: Mandatory HITL approval gates — every override needs a recorded envelope (ADR-007, the SDLC supervisor).
- Rule 6: Mandatory auditability — every conflict resolution writes an F-005 audit row.
- ADR-002: PostgreSQL 17 + Apache AGE + pgvector as single persistence substrate (RLS is the dividing line between pilot and MT).
- ADR-008: WORM audit trail — once a conflict resolves, the resolution is immutable.
- ADR-009: Cost-ledger schema + cumulative cap — cost cap exceeded is one of the five conflict categories.
- NFR-006: Tenant isolation, including cryptographic isolation at the KMS layer (ADR-011).
- Pilot cutoff rule: tenant_count >= 2 → triggers migration from pilot to MT mode (see Appendix B).

## Considered Options

- **A. Uniform policy** — one global resolution rule governs all conflicts regardless of tenant mode. Simple to implement; ignores pilot's experimental latitude. *Rejected.*
- **B. Pilot-vs-MT dual policy with explicit per-conflict decision table** *(chosen)*
- **C. Defer conflict resolution to first incident** — punt all resolution logic to a Steward policy at conflict time. *Rejected: abandons deterministic-by-default.*

## Decision Outcome

Chosen option: **B — Pilot-vs-MT dual policy with explicit per-conflict decision table**. Every conflict category has a named pilot behavior, a named MT behavior, and a named escalation path. The escalation path always ends at a recorded decision (audit row) so the same conflict cannot surface twice with different outcomes for the same tenant.

Architecture:

- A new module `backend/app/services/conflict_resolution.py` owns the policy table; it is **deterministic** (no LLM in the decision path; ADR-009).
- The mode for a tenant — `pilot` or `mt` — is captured in the `tenants.config` JSONB column under the key `mode`, default `pilot` for tenants created from the same billing account as a Forge SRE, default `mt` otherwise. Pilot mode survives only until `tenant_count >= 2` (Appendix B).
- Each conflict category resolves against the table in Appendix A. The conflict resolver writes an F-005 audit row at action `conflict.resolved` with payload `{category, mode, winner, escalation_path, decided_by}`.
- When the conflict resolver needs a human, it emits an `APPROVAL_REQUESTED` event (ADR-007 + `_package_wiring.py`) and pauses until `APPROVAL_GRANTED` lands on the SDLC supervisor — same path as every other governance gate.
- The Appendix A table is **frozen** as part of this ADR; future changes require a new ADR (e.g. ADR-012) — never in-place edits, to preserve WORM integrity (ADR-008).

### Consequences

Positive:

- Every conflict category has a single, named, deterministic default — operators can write runbook steps without re-reading the codebase.
- Pilot tenants keep their managed-service latitude without forcing that latitude on the much larger MT population.
- MT tenants get strict isolation by default; their conflict resolutions are automatically review-board-gated, never SRE-overridden.
- Audit row per conflict makes "why did this happen" answerable in seconds instead of via Slack archaeology.
- Escalation paths are uniform across categories: customer success → security review board → architecture review board → customer-visible postmortem.

Negative:

- Two operating modes means two sets of runbooks, two sets of dashboards, and two cost-projection models (Track B's cumulative cap).
- Adopting a new conflict category requires the same ADR cadence as adopting a new schema, which slows fast iteration on novel scenarios.
- "Pilot always wins" for the first two categories can appear to favor pilot customers in inter-tenant disputes. The escalation paths compensate but remain a perception risk.

Neutral:

- Mode transitions are themselves conflict events — see Appendix B for the cutoff rule.

## Alternatives Considered

### Uniform policy

Pros: simplest to implement; one rule governs all tenants; no mode-tracking column needed.

Cons: in MT production a single SRE override becomes a vector for cross-tenant impact; in pilot the strict-MT posture slows the customer-success feedback loop. The same uniform rule cannot fit both populations.

Rejected: Rule 2 (multi-tenancy) requires tenant-sensitive policy; ADR-008 makes every conflict resolution auditable. A uniform policy collides with both.

### Defer conflict resolution to first incident

Pros: zero upfront taxonomy work; "the Steward handles it" reads well in marketing material.

Cons: violates Rule 6 (every action is auditable — deferred actions have no audit row until after-the-fact) and ADR-008 (deterministic-by-default). First incident then becomes implicit policy that no one can re-examine; second incident escalates without prior pattern.

Rejected: M2 substrate lock needs a deterministic policy surface so the Steward has something to override (vs. something to invent).

## Pros and Cons of the Chosen Option

Pros:

- Per-conflict decision table is a single readable artifact (Appendix A).
- Escalation paths terminate at a recorded, reviewable decision.
- Mode-aware policy honors both Rule 2 and the customer-success latitude pilot customers expect.
- Audit row per conflict (Rule 6) is the foundation for the WORM trail (ADR-008).

Cons:

- Two operating modes means two sets of UX flows and dashboards (long-tail cost).
- Adding a new conflict category requires an ADR (slower than a quick edit, by design).
- MT tenants never see an SRE override — sometimes that is exactly what they want (e.g. security incidents) and conflicts with their internal DevOps expectations. The review-board escalation path makes this an explicit, recorded decision instead of a hidden capability.

## References

- docs/research-forge-architecture-decisions-2026-06-20.md (Q4 multi-tenant rollout topology)
- ADR-002: PostgreSQL 17 + Apache AGE + pgvector (RLS is the pilot-vs-MT dividing line)
- ADR-007: LangGraph as SDLC agent orchestrator (escalation paths through SDLC supervisor)
- ADR-008: Append-only WORM audit trail (every conflict resolution is immutable)
- ADR-009: Cost ledger schema + cumulative cap (defines the cost_cap_exceeded category)
- ADR-011: KMS topology (per-tenant CMK rollout is a downstream consequence of MT isolation)
- Constitution Rule 2 (Multi-tenancy), Rule 3 (HITL), Rule 6 (Auditability)
- PRD NFR-006 (Tenant isolation), NFR-020 (Audit retention)

---

## Appendix A — Decision table

For each conflict category: `pilot_policy` is what happens when both participating tenants are in pilot mode (including single-tenant pilots); `mt_policy` is what happens when both are in MT; `escalation_path` is identical across modes but the gates diverge.

| # | Conflict type            | pilot_policy                                   | mt_policy                                          | escalation_path                                          |
|---|--------------------------|------------------------------------------------|----------------------------------------------------|----------------------------------------------------------|
| 1 | architecture_overlap     | Pilot's proposal is canonical; audit row records the override; no RLS conflict because pilot accounts are isolated. | Steward config-level tiebreaker via Steward priority policy (ADR-003); no automatic overwrite of either tenant's data. | Architecture review board within 24h; emits `conflict.resolved` audit row; if unresolved, default to "deny both + open ADR ticket". |
| 2 | security_conflict        | Forge SRE may override (deliberately permissive; pilot customers opted into experimental tariffs). | Deny-by-default; the more restrictive policy wins automatically. No SRE override path exists. | Security review board; required sign-off from at least two principals (Rule 3) before either side can apply. |
| 3 | deployment_conflict      | First-come-first-serve via deterministic SHA1 of `commit_sha + tenant_id`; pilot accepts temporary lock contention without escalation. | Slot pre-reservation via the deployment scheduler (Track A); if conflict remains, escalate before lock acquisition. | Operations review board if conflict persists > 1h OR affects > 1 tenant; otherwise log as known scheduling noise. |
| 4 | cost_cap_exceeded        | Soft cap (warning + audit row); pilot may burst up to 2x before any enforcement. | Hard cap (reject the LLM call via `CostCapExceeded`; ADR-009); no override path. | Cost guardrails (Track B) automatically raises the audit row; tenanted escalation to customer success for MT tenants. |
| 5 | schema_drift             | Pilot accepts schema drift within the pilot's own database; pilot isolation prevents leakage but increases reconciliation cost at MT conversion. | Strict schema lock via PostgreSQL `ALTER TABLE ... LOCK MODE`; outbound migrations queued via ADR's migration runner; no in-line drift allowed. | Architecture review board on every drift detection; ADR-002 forbids silent schema evolution. |

Each row produces exactly one F-005 audit row at action `conflict.resolved`. The payload must include the conflict id (UUID), the conflict type (one of the 5 above), `mode` (`pilot` or `mt`), `winner` (`tenant:<id>` or `steward` or `deny`), `escalation_path` (`auto` or `review_board:<name>`), and `decided_by` (principal UUID or `system:<job_name>`). The row is hashed into the daily chain (ADR-008) and survives the 7-year retention window.

---

## Appendix B — Pilot cutoff rule (tenant_count >= 2)

The mode for a Forge deployment is determined by the active tenant count at the time of the conflict. The cutoff is deterministic and irreversible for a single Forge deployment instance:

- **tenant_count == 1**: pilot mode. The single tenant is by definition the pilot. SRE overrides are allowed by default for every conflict category in pilot_policy.
- **tenant_count >= 2**: MT mode. The deployment has crossed the threshold; the SRE override path is closed for every conflict category. Migration to MT is one-way: `tenants.config.mode` is rewritten to `mt` for ALL tenants, a migration ADR is filed (e.g. ADR-013), and the new mode takes effect at the next SDLC supervisor boot. There is no re-entry to pilot mode.
- **tenant_count == 0**: pre-launch seed state; conflict resolver refuses to operate (returns `deny` + audit row with `mode=seed`).

The cutoff is evaluated by the conflict resolver before the table lookup, against a single SQL aggregate: `SELECT COUNT(DISTINCT tenant_id) FROM audit_log WHERE occurred_at > NOW() - INTERVAL '24 hours'`. The 24-hour window prevents short-lived test tenants from spuriously flipping the deployment to MT.

A deployer that intentionally grows a pilot's customer base must therefore accept the irreversible mode transition as a one-line consequence in the deployment plan. The Steward UI surfaces a banner "tenant_count has reached 2 — pilot cutoff fires at the next supervisor boot" so the deployer has a window to file an ADR before the transition takes effect.

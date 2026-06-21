# P4 — Expansion Runbook

> **Phase.** P4 — Expansion
> **Duration.** TBD (gated by P3 recommendation; typically 2-3 quarters for 1 → 3 → 10 teams)
> **Owner.** Pilot Owner → Expansion Lead (transition at start of P4)
> **Exit gate.** Success metrics for expansion hit; phased rollout completed; org-level knowledge in place.
> **Prerequisite.** [P3 — Evaluation](pilot-p3-evaluation.md) exit gate signed with `continue` or `expand` decision.

## Goal

Expand Forge from the pilot team (1 tenant, 1-3 repos) to additional teams and repositories, in a controlled, measurable way. By the end of P4 we have:

1. A phased rollout from 1 team → 3 teams → 10 teams (and beyond if targets are met).
2. New tenants onboarded with the same exit criteria as P0-P3.
3. Multi-tenant cost attribution working end-to-end.
4. Cross-tenant knowledge sharing with the right org-level vs project-level boundaries per [Rule 5](../architecture/overview.md#layer-isolation-model).
5. Expansion-specific success metrics formalized.

P4 is intentionally **not** a fixed duration. It expands only as long as each milestone gate is met.

## Audience and Prerequisites

| Audience | Read this section |
|---|---|
| Expansion Lead | All of P4 |
| Pilot Owner (transitioning out) | Expansion criteria, handoff |
| Architect (L3) | Org-level vs project-level knowledge (Rule 5) |
| Platform Engineer | Multi-tenant cost attribution |
| Steward | Org-level knowledge curation |
| Customer sponsor | Rollout schedule, success metrics |

### Prerequisites

| # | Prerequisite | Source |
|---|---|---|
| P4-PR-1 | P3 exit gate signed with `continue` or `expand` decision | [pilot-p3-evaluation.md §Recommendation](pilot-p3-evaluation.md#recommendation-template) |
| P4-PR-2 | P4 targets formalized | P3 recommendation template |
| P4-PR-3 | P0-P3 archive sealed | [pilot-p3-evaluation.md §P0-P3 Archive Seal](pilot-p3-evaluation.md#p0-p3-archive-seal) |
| P4-PR-4 | Expansion Lead appointed | Customer + KnackForge leadership |
| P4-PR-5 | Budget envelope for expansion approved | Sponsor |

## Expansion Criteria

The P3 final report specifies the expansion criteria. They typically look like:

| Criterion | Threshold |
|---|---|
| TTTD delta vs baseline | Sustained ≥25% improvement |
| Acceptance rate | ≥80% sustained over ≥3 months |
| Cycle count | ≥30 total in P2-P4 |
| Cost per cycle | Within budget envelope ±10% |
| Developer NPS | ≥30 (positive) |
| No unresolved Tier-2+ security incidents | 100% |

If any criterion slips, P4 enters a **stabilization** sub-phase before expanding further. The stabilization sub-phase is governed by the same P2 mid-pilot protocol: 4 weeks of measurement + adjustment decision.

## Phased Rollout

Expansion is phased to keep blast radius small.

| Wave | Teams | Repos | Duration | Gate |
|---|---|---|---|---|
| **Wave 1** | 1 (pilot team) | 1-3 (pilot repos) | Already done in P0-P3 | P3 exit gate |
| **Wave 2** | 3 (pilot + 2 new) | 6-10 | 4-6 weeks | Re-run P0-P3 protocol for each new team |
| **Wave 3** | 10 (3 + 7 new) | 20-30 | 8-12 weeks | Org-level knowledge in place; cost attribution green |
| **Wave 4+** | TBD | TBD | TBD | Per sponsor + Expansion Lead |

Each wave follows a mini P0-P3 cycle:

| Mini phase | What happens |
|---|---|
| Mini-P0 | New tenant provisioned; scope confirmed; baseline TTTD measured for the new team |
| Mini-P1 | First artifact created in Forge for the new team |
| Mini-P1.5 | ≥15 artifacts validated for the new team |
| Mini-P2 | ≥12 cycles executed by the new team |
| Mini-P3 | Go/no-go decision for the new team before next wave |

A new team that fails its mini-P3 can be **de-onboarded** without affecting other teams (Tier-3 rollback per [rollback-procedures.md](rollback-procedures.md)).

## Tenant Onboarding at Scale

The Onboarding Wizard (F-021) is the same entry point for every new tenant. At scale, the wizard must support:

| Capability | Owner |
|---|---|
| Bulk role assignment via SCIM | Platform Engineer |
| Per-tenant KMS key issuance per [ADR-001](../architecture/decisions/0001-cloud-only-aws-deployment.md) | Platform Engineer |
| Per-tenant LiteLLM virtual key per [ADR-005](../architecture/decisions/0005-litellm-proxy-provider-abstraction.md) | Platform Engineer |
| Per-tenant cost ledger with budget alerts per [Forge AI Charter §Principle 4](../CHARTER.md) | Platform Engineer |
| Per-tenant audit log mirror per [ADR-008](../architecture/decisions/0008-append-only-worm-audit-trail.md) | Platform Engineer |

### Tenant Provisioning Checklist (per new tenant)

| # | Step | Owner | Verified by |
|---|---|---|---|
| 1 | Tenant record created in PostgreSQL with unique `tenant_id` | Platform Engineer | `SELECT count(*) FROM tenants WHERE slug = '<slug>';` |
| 2 | Keycloak realm imported (separate realm per tenant) | Platform Engineer | OIDC handshake test |
| 3 | KMS CMK issued per tenant | Platform Engineer | Encryption smoke test |
| 4 | LiteLLM virtual key issued | Platform Engineer | Test call to proxy |
| 5 | Cost ledger initialized with budget envelope | Platform Engineer | First cost row inserted |
| 6 | Audit log mirror configured | Platform Engineer | Daily anchor test |
| 7 | RLS policies verified | Platform Engineer | Cross-tenant isolation test |

## Multi-Tenant Cost Attribution

Cost attribution is the single biggest operational risk in P4. Per [Forge AI Charter §Multi-Tenant Model](../CHARTER.md) and [ADR-002](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md), every record carries `tenant_id` + `project_id`. The cost ledger must do the same.

### Cost Attribution Schema

| Column | Type | Description |
|---|---|---|
| `cost_id` | UUID | Unique cost row |
| `tenant_id` | UUID | Tenant |
| `project_id` | UUID | Project within tenant |
| `user_id` | UUID | User who triggered the cost |
| `workflow_id` | UUID | Workflow or `forge-*` command run |
| `cycle_id` | UUID | SDLC cycle (if applicable) |
| `model` | string | LLM model used |
| `tokens_input` | int | Input tokens |
| `tokens_output` | int | Output tokens |
| `cost_usd` | decimal | Cost in USD |
| `recorded_at` | timestamp | When the cost was recorded |

### Cost Reports

| Report | Audience | Frequency |
|---|---|---|
| Per-tenant monthly cost | Tenant sponsor | Monthly |
| Per-team cost within tenant | Tenant leads | Weekly |
| Per-cycle cost | Pilot team | Per cycle |
| Cost anomaly report | Platform Engineer | Daily |
| Cross-tenant cost comparison | KnackForge finance | Monthly |

### Budget Alerts (per tenant)

| Threshold | Action |
|---|---|
| 50% of monthly budget | Email to tenant admin |
| 80% of monthly budget | Email + Slack alert |
| 100% of monthly budget | Email + Slack + pause non-critical commands (Tier-1 rollback per [rollback-procedures.md](rollback-procedures.md)) |
| 120% of monthly budget | L3 architect escalation; consider Tenant freeze |

## Cross-Tenant Knowledge Sharing

Forge supports two layers per [Rule 5](../architecture/overview.md#layer-isolation-model):

| Layer | Tenant scope | Project scope | Examples |
|---|---|---|---|
| **Organization Knowledge** | Shared across all projects in a tenant | Tenant-wide | Standards, templates, policies, governance rules |
| **Project Intelligence** | Isolated per project | Project-scoped | Repo structure, services, dependencies, ADRs |

**Cross-tenant sharing is not permitted by default.** A Forge customer (one KnackForge customer) may have many tenants, but cross-tenant sharing happens only through:

1. **KnackForge-curated standards** that ship with the platform (read-only to all tenants).
2. **Reference architectures** published by KnackForge (read-only to all tenants).
3. **Tenant-initiated knowledge export** (explicit per-tenant action with audit log row).

### What an Organization Knowledge Steward Curates

| Category | Examples |
|---|---|
| Coding standards | Language-specific style guides, naming conventions |
| Security standards | Approved libraries, banned functions, threat modeling templates |
| Architecture patterns | Microservice templates, ADR templates, API design rules |
| Review guidelines | Code review checklists, security review checklists |
| DevOps standards | CI/CD templates, deployment patterns, observability norms |
| Governance policies | Approval workflows, retention policies |

### What Remains Project Intelligence

| Category | Examples |
|---|---|
| Repository structure | Source files, folders, configs |
| Service definitions | Services, APIs, databases, dependencies |
| Architectural history | ADRs, RFCs, design docs for the project |
| Task + ticket history | Jira tickets, task breakdowns, deployment plans |
| Communication history | Slack threads, meeting notes (if ingested) |

### Conflict Resolution

When a tenant has multiple projects with conflicting knowledge (e.g., two projects using different ADR templates), the conflict is resolved per [ADR-003](../architecture/decisions/0003-hybrid-mdm-steward-priority.md):

1. The Steward maintains a priority policy.
2. Conflicts are surfaced in the Steward queue.
3. The Steward selects a winner; the conflict is audited.

## Org-Level vs Project-Level Knowledge (Rule 5)

Rule 5 ([Forge AI Charter §Principle 4 + Layer Isolation](../CHARTER.md)) is the single most important governance rule for P4. Get this wrong and tenants leak data or suffer duplicated, conflicting knowledge.

### Decision Guide

| Question | Answer |
|---|---|
| Is the knowledge specific to one project's code, services, or decisions? | Project Intelligence |
| Is the knowledge about *how* the tenant works (standards, policies, templates)? | Organization Knowledge |
| Would two projects in the same tenant benefit from sharing it? | Probably Organization Knowledge |
| Does the knowledge contain tenant-confidential design decisions? | Project Intelligence (or restricted Organization Knowledge) |
| Is the knowledge a customer-specific secret (API key, internal hostname)? | Never store in Forge; use a secret manager |

### RLS Boundaries

| Table | RLS policy |
|---|---|
| `org_knowledge_*` | `tenant_id` match; no `project_id` requirement |
| `project_intel_*` | `tenant_id` + `project_id` match |
| `audit_log` | `tenant_id` match; project_id optional |
| `cost_ledger` | `tenant_id` + `project_id` match |

These policies are enforced at the DB layer per [ADR-002](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md). Application code uses `SET LOCAL app.tenant_id` (and `app.project_id` where applicable) before every query.

### Steward Role

The Steward role is the owner of Organization Knowledge. Per [ADR-003](../architecture/decisions/0003-hybrid-mdm-steward-priority.md), the Steward:

- Maintains the priority policy for conflicts.
- Reviews and resolves conflicts surfaced by F-111 (Incremental Sync).
- Approves promotion of project knowledge to org knowledge (rare; one-time events).
- Approves deprecation of org knowledge.

In P4, every new tenant gets a designated Steward.

## Success Metrics for Expansion

P4 success metrics extend P3 metrics with expansion-specific additions.

### Carried from P3

| Metric | Target |
|---|---|
| TTTD delta | ≥25% vs baseline, sustained |
| Acceptance rate | ≥80% |
| Cost per cycle | Within budget ±10% |
| Developer NPS | ≥30 |

### Expansion-Specific

| Metric | Target |
|---|---|
| Tenants onboarded (cumulative) | Per sponsor roadmap |
| Cycles per tenant per quarter | ≥12 |
| Cross-tenant knowledge hits (org knowledge referenced from project artifacts) | ≥10% of artifacts |
| Tenant churn (tenants that de-onboard) | <10% |
| Time to onboard a new tenant (from request to first artifact) | ≤2 weeks |
| Cost per cycle, cross-tenant average | Within budget |
| Steward resolution time for conflicts | ≤5 business days |

### Org-Wide Metrics (Wave 3+)

| Metric | Target |
|---|---|
| Total cycles per quarter (all tenants) | Per sponsor roadmap |
| Total cost per quarter (all tenants) | Per sponsor budget |
| Org knowledge library size | Growing; tracked |
| Cross-tenant incident count | 0 Tier-2+ in 90 days |

## Expansion Governance

### Cadence

| Frequency | Meeting | Owner |
|---|---|---|
| Weekly | Expansion standup | Expansion Lead |
| Monthly | Tenant sponsor review | Expansion Lead + sponsor |
| Quarterly | Cross-tenant steering | All sponsors + KnackForge leadership |

### Tenant De-onboarding

If a tenant fails its mini-P3 or causes repeated incidents, the tenant can be de-onboarded.

| Step | Action | Authority |
|---|---|---|
| 1 | Document the failure mode | Expansion Lead |
| 2 | L3 architect reviews | L3 architect |
| 3 | Tenant sponsor notified | Expansion Lead + sponsor |
| 4 | Tier-3 rollback executed | L3 architect + L4 delegate |
| 5 | Tenant archived (read-only) | Platform Engineer |

De-onboarding is a Tier-3 rollback per [rollback-procedures.md §Tier-3](rollback-procedures.md#tier-3-rollback-tenant-revert).

## Exit Gate

P4 does not have a fixed exit gate. Instead, each wave has a gate.

### Per-Wave Exit Gate Template

```text
+----------------------------------------------------------------+
| FORGE AI PILOT — P4 WAVE <N> EXIT GATE                          |
+----------------------------------------------------------------+
| Wave:    <N>                                                   |
| Teams:   <count>                                               |
| Window:  <start_date> .. <end_date>                            |
| Expansion Lead: <name>                                         |
+----------------------------------------------------------------+
| 1. METRICS                                                     |
|    [ ] All carried P3 metrics sustained                         |
|    [ ] Tenant churn: ___ (target <10%)                         |
|    [ ] Time to onboard new tenant: ___ (target ≤2 weeks)        |
|    [ ] Steward resolution time: ___ days (target ≤5)           |
+----------------------------------------------------------------+
| 2. COST                                                        |
|    [ ] Per-tenant cost within budget                           |
|    [ ] Cross-tenant average within budget                      |
+----------------------------------------------------------------+
| 3. GOVERNANCE                                                  |
|    [ ] Org knowledge library maintained                         |
|    [ ] Conflict resolution SLA met                              |
|    [ ] No unresolved Tier-2+ incidents                          |
+----------------------------------------------------------------+
| 4. RECOMMENDATION                                              |
|    [ ] EXPAND to next wave                                     |
|    [ ] STABILIZE before next wave                              |
|    [ ] PLATEAU at this scale (no further expansion)            |
|    [ ] ROLLBACK specific tenant(s)                              |
+----------------------------------------------------------------+
| Signatures                                                     |
| Expansion Lead:    ____________________  Date: __________      |
| Architect (L3):    ____________________  Date: __________      |
| Sponsor:           ____________________  Date: __________      |
+----------------------------------------------------------------+
```

When a wave is the final planned wave (per sponsor roadmap), the exit gate records `PLATEAU` and P4 enters a steady-state phase managed by day-2 operations.

## Cross-References

- **Previous phase.** [P3 — Evaluation](pilot-p3-evaluation.md) sets the expansion criteria.
- **Success metrics.** [success-metrics.md](success-metrics.md) — the authoritative KPI definitions.
- **Rollback.** [rollback-procedures.md](rollback-procedures.md) — Tier-3 covers tenant revert.
- **Layer isolation.** [ADR-003 Hybrid MDM + Steward priority](../architecture/decisions/0003-hybrid-mdm-steward-priority.md), [Architecture Overview §Layer Isolation Model](../architecture/overview.md#layer-isolation-model).
- **Multi-tenancy.** [Forge AI Charter §Multi-Tenant Model](../CHARTER.md), [ADR-002 PostgreSQL substrate](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md).
- **On-call.** [oncall-runbook.md](oncall-runbook.md) — cross-tenant incidents and alerts.
- **Incident response.** [incident-response.md](incident-response.md) — for any cross-tenant security event.

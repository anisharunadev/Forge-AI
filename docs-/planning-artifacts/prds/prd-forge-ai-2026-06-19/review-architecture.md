# Architecture Lens Review — Forge Delivery Accelerator

## Overall verdict

The PRD does a strong job of committing to **philosophical** invariants (human-in-the-loop, per-tenant isolation of Project Intelligence, audit immutability, model-provider independence) and to the **capability sequencing** (Foundation → Phase 0 → Phase 1). Those are exactly the things that should be locked at the PRD layer, and they are. The PRD is correspondingly **weak** on the architectural decisions a downstream ADR cannot defer: the **graph substrate characteristics** that OQ-006 admits to being an open question, the **source-of-truth conflict policy** OQ-007 admits to being unresolved but which several FRs already presume, the **"governance boundary"** definition that NFR-032 floats without grounding, and the **cost-attribution / freshness source-of-truth** that NFR-030 and NFR-031 each require as an architectural invariant. Architecture will have to invent more than is healthy for an artifact the PRD calls "executable."

## Top architectural risks

1. **[CRITICAL] "Governance boundary" is undefined while NFR-032 forbids autonomous cross-boundary transitions.** *Affects NFR-032, F-205, F-006, F-207, F-209.* A "boundary" is the central control point of the system and is not named anywhere in the PRD. Architecture cannot derive the state machine, the approval matrix, or the audit schema without it. This is the single largest PRD-to-Architecture hand-off gap.

2. **[CRITICAL] Source-of-truth conflict policy (OQ-007) is unresolved but F-110 (Impact Analysis) and F-103/F-104 (Architecture / Dependency Discovery) already presume one.** *Affects F-103, F-104, F-105, F-106, F-107, F-110, F-209, OQ-007.* The example "Jira says Cognito, code says Keycloak" will occur on day one of pilot. Without a resolved policy, M3 cannot be honestly demoed and F-209's "context-aware" claim is hollow.

3. **[CRITICAL] Knowledge graph substrate characteristics are absent even though F-103, F-104, F-110, F-111 imply them.** *Affects F-103, F-104, F-110, F-111, NFR-010, NFR-011, NFR-015, NFR-031, NFR-033, OQ-006.* The PRD promises graph-style traversals (impact analysis across services + APIs + DBs) and near-real-time event-driven sync, but commits to neither graph query latency, write throughput, nor partial-failure behavior. OQ-006 admits this; the FRs do not wait for it. The choice between Neo4j / PostgreSQL+AGE / graph tables / GraphRAG has direct consequences for tenant isolation, cost, and connector SDK target (NFR-027).

4. **[HIGH] Per-tenant isolation is a *constitutional* commitment but its enforcement points are not specified.** *Affects NFR-006, NFR-007, F-004, F-101, F-103, F-104, F-108, F-110, F-209.* The PRD says "enforced at query layer + storage layer" (NFR-007) but does not say *where* in M1's substrate. The Entity sketch in addendum.md has a `engagement_scope` flag for Organization-layer rows but no symmetric mechanism for Project Intelligence rows — yet those are the rows that the PRD's "never mix customer knowledge graphs" rule most strictly forbids mixing. A single query that fails to filter on `engagement_id` is a customer breach.

5. **[HIGH] Knowledge freshness (NFR-031) and cost governance (NFR-030) are stated as invariants but each subsystem will compute its own timestamp / cost without a shared source-of-truth.** *Affects F-101, F-103, F-104, F-105, F-106, F-107, F-108, F-109, F-111, F-201, F-202, F-203, F-204, F-208, F-209, NFR-030, NFR-031.* The addendum's `freshness_at` / `freshness_source` field on graph nodes and `cost_estimate` / `cost_actual` / `cost_budget` on workflow instances are the right shape, but the PRD never says *which subsystem* owns the clock (ingestion time, last successful sync, last LLM contact?) or *which subsystem* owns the cost ledger (token-level, request-level, workflow-level?). If F-103 and F-104 each compute their own freshness, the "stale" label becomes a UX bug magnet.

6. **[HIGH] M1's substrate is missing fields the rest of the build reads from.** *Affects F-005, F-006, F-010, M1 vs. M3–M7.* M1 ships F-001/F-002/F-004/F-005/F-006/F-010. M3–M5 (F-101 through F-111) and M6–M7 (F-201 through F-210) require: (a) per-tenant policy enforcement in the query layer, (b) versioned, append-only artifact storage with supersession, (c) a typed event substrate for F-111 incremental sync, (d) a typed LLM-call substrate with provider abstraction, and (e) tenant-scoped cost and freshness ledgers. None of these is an F-001–F-010 primitive. Architecture will have to either retrofit M1 or treat M1 as a moving target.

7. **[HIGH] The Approval / Versioning / Supersession state machine is under-specified.** *Affects F-205, F-006, F-207, F-209, F-210, NFR-032.* F-205 names request/review/decide/approve/reject/request-changes, F-207 names supersession with rationale, and F-209 adds context-aware generation. But: (a) what happens to a superseded artifact's *downstream* artifacts (API contract generated from a now-superseded ADR)? (b) can an ADR be in `draft` while its API contract is `approved`? (c) is there a `withdrawn` terminal state? (d) what is the rollback path from a rejected-then-revised submission? (e) does supersession require a human approval, and at what boundary? (f) can an approval be revoked after-the-fact? Each gap forces Architecture to invent a state.

8. **[HIGH] SOC2-ready posture implies architectural decisions the PRD does not name.** *Affects NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-020, NFR-021, NFR-022, NFR-023, F-005, F-007, DL-011.* "Designed for certification" requires deciding: (a) audit-log storage topology (separate account / project / region?), (b) KMS key custody (per-tenant CMK or shared?), (c) PII boundary for ingested source code and Jira content (likely contains personal data — see GDPR), (d) retention periods, (e) data subject rights handling (right-to-erasure collides with audit immutability, NFR-020), (f) the precise shape of structured logs and trace propagation (NFR-021/023) that survive the LLM call layer. None of these is an FR or NFR — they are ADR-shaped.

9. **[MEDIUM] The Connector contract (NFR-016, NFR-017, NFR-027) is well-posed as an integration requirement but is silent on failure semantics that drive the architecture.** *Affects F-007, F-101, F-111, NFR-015, NFR-033.* "Idempotent re-sync, webhook + polling fallback, 3–5 engineer-days per connector" is a target, not a contract. Architecture needs to know: (a) what does a connector do when the upstream system is down for >N hours (quarantine? back-off? operator alert?), (b) how are partial sync results represented (NFR-033 implies yes — but where in the data model?), (c) does each connector carry its own cost ledger entry, and (d) what is the connector's authentication boundary (per-tenant OAuth, organization-level PAT, service account?).

10. **[MEDIUM] Cost attribution as architecture invariant is required by NFR-030 but has no PRFAQ-level model.** *Affects NFR-030, F-201, F-202, F-203, F-204, F-209.* The PRD says "per-tenant token usage, model spend, workflow cost, budget thresholds" but does not say: (a) what is the unit of attribution (token, request, workflow, engagement-month?), (b) is there a hard kill-switch or only a soft warning, (c) are budgets Steward-set or per-tenant-admin-set, (d) does an exhausted budget block ingestion (F-101) or only generation (F-201+), and (e) how does multi-provider routing (NFR-029) interact with cost tracking when providers price differently. The addendum's `cost_estimate` / `cost_actual` / `cost_budget` on Workflow is a start, but the policy and enforcement points are absent.

11. **[MEDIUM] Pilot-vs-architecture sequencing is fragile.** *Affects M1–M8, P1.5, P2.* P1.5 is the Architecture Validation Gate (≥80% of generated outputs accepted without major correction), but it sits *after* M7 (Phase 1 governance complete). Architecture cannot wait until M7 to decide the graph substrate, the LLM provider abstraction, or the source-of-truth policy. OQ-006 and OQ-007 are flagged as "before Architecture Phase" blockers, but the build plan does not show them as explicit milestones — they will land as silent pre-work in M1 or M3 and risk becoming irreversible.

## Implicit commitments the PRD should make explicit

1. **"Governance boundary" definition.** Where: §5.8 NFR-032, §4.1 F-006, §4.3 F-205. The PRD should list candidate boundaries (artifact-type transition, e.g., draft→submitted→approved; engagement-level; standards-level vs. engagement-level) so Architecture can derive the approval matrix.

2. **Source-of-truth priority order for cross-system conflicts.** Where: §4.2 Phase 0, F-110, §6.1 OQ-007. PRD should state a provisional order (e.g., "code > docs > tickets" or "explicit human override wins") even if the final policy is ADR-shaped.

3. **Graph substrate constraints.** Where: §4.2 F-103, F-104, F-110, §6.1 OQ-006. Even one sentence on traversal-latency SLO, write-throughput target, and partial-failure tolerance would let Architecture begin. Current PRD says "graph" and trusts Architecture to make a graph.

4. **Cost attribution unit and enforcement point.** Where: §5.8 NFR-030, addendum A.3. PRD should commit to a single unit (token, request, or workflow) and a single enforcement point (request admission, post-hoc enforcement, both).

5. **Freshness source-of-truth.** Where: §5.8 NFR-031, addendum A.3. PRD should state whether freshness is owned by the ingestion layer (last successful sync), the graph layer (last node update), or computed on read (last upstream contact).

6. **Connector failure-mode policy.** Where: §4.1 F-007, §5.4 NFR-015, NFR-033, §5.5 NFR-016, NFR-017. PRD should state whether partial sync is a first-class outcome, and what the system does when a required connector is down for >24h during pilot.

7. **M1 substrate fields implied by downstream FRs.** Where: §4.1 Foundation table, §8.1 build phasing. PRD should add to M1: typed event substrate, LLM provider abstraction interface, tenant-scoped cost/freshness ledgers, query-layer isolation primitive, append-only artifact storage with supersession primitive.

8. **Per-tenant isolation enforcement points.** Where: §5.2 NFR-006, NFR-007. PRD should commit to *which* layer enforces what (e.g., "row-level security at storage layer + query-rewriter at application layer + per-tenant encryption keys").

9. **PII boundary in ingested data.** Where: §5.1 NFR-002, §4.2 F-101, F-102. PRD should state whether ingested Jira content and source code are treated as personal data, and whether pseudonymization is required.

10. **Audit-log topology and retention.** Where: §5.6 NFR-020, NFR-021, §5.1 NFR-001. PRD should commit to: (a) audit log storage in a separate logical boundary, (b) retention period, (c) right-to-erasure collision resolution.

11. **Artifact-state lattice and supersession propagation rules.** Where: §4.3 F-207, F-205. PRD should specify the state diagram (states, transitions, terminal states) and whether supersession cascades.

12. **Demo path's "architecture output" criterion.** Where: §8.6 demo step 5, §8.2 P1.5. PRD should commit to what "context-aware" means concretely (which knowledge-graph elements are required inputs, which standards are applied, what the artifact shape is when graph is stale).

## Per-lens findings

### 1. Domain model completeness

The addendum's entity sketch is plausible but **incomplete in three load-bearing places**.

- **Cross-references from artifacts to source are not represented.** F-206 (Traceability) requires that "every artifact references its source(s) and every downstream artifact can be traced back to the originating requirement." The sketch shows `Artifact` as a flat collection under `Project`, with no `source_artifact_id` / `source_requirement_id` link, and no `derived_artifact_ids` reverse edge. Without these, F-206 cannot be enforced at the data layer; it will become a runtime join that architects must invent.

- **The Knowledge Graph is a single bag of nodes, not a typed, multi-level structure.** F-103 (services, modules, boundaries), F-104 (cross-service dependencies), F-105/F-106/F-107 (API Catalog, Database Map, Service Catalog), F-110 (impact across repos, services, APIs, DBs), and F-209 (context-aware architecture generation) all read from this. The sketch collapses them into "Knowledge Graph (F-103, F-104, F-105, F-106, F-107, F-110, F-111)." Architecture cannot derive ingestion order, freshness propagation, or query latency targets from a single bag.

- **No explicit `Requirement` entity.** F-201, F-202, F-203, F-204, F-209, F-210 all take a "requirement" as input. F-205 (Approval Workflow) operates on packages submitted from requirements. F-206 (Traceability) requires traceback "to the originating requirement." Yet there is no Requirement entity in the sketch. Without one, the entire traceability chain — requirement → ADR → API contract → task breakdown → risk register → acceptance criteria → (future) code → deployment — is ungrounded.

- **No `Policy` entity despite F-003 being the Governance Policy Engine.** F-003 defines "declarative policies" and F-205 / F-006 / F-207 read from them. The addendum lists Policies under Organization but does not show their schema (rule shape, gate definitions, evaluation context). Architecture cannot derive how F-005's "mandatory vs. advisory gates per F-003" is enforced without it.

- **No `Connector` / `Integration` entity.** F-007 is the Connector / MCP Registry. NFR-016, NFR-017, NFR-027 govern its contract. F-101 / F-102 / F-111 read from it. The sketch has no Connector row, so connector-level cost (NFR-030), connector-level freshness (NFR-031), and connector-level failure modes (NFR-033) cannot be attributed to the right primitive.

- **No `User` / `Principal` entity.** F-004 is RBAC; F-005, F-006, F-205 all attribute actions to actors. Yet there is no `User` row, no role binding, no group. RBAC will need to be invented on top of `engagement_id` flags.

- **No `Snapshot` schema.** F-109 names a Snapshot as a "versioned snapshot of project intelligence at a point in time; restore + diff between snapshots." It is listed under `Project` but its row shape (what is snapshotted, how diff is computed, who can restore) is not specified. F-207 ("Snapshot diff via F-109") depends on this.

- **Counter-metric entities are not represented.** Section 2.4 names six counter-metrics; Architecture will need queryable primitives for each (e.g., gate-skip events, override events, rejection events). These should be derivable from F-005's audit log, but the sketch does not show which audit-event types are mandatory.

### 2. State machine clarity

The PRD implicitly demands **at least three distinct state machines** but defines none.

- **Artifact lifecycle (F-201, F-202, F-203, F-204, F-207, F-210).** States at minimum: `draft`, `submitted`, `under-review`, `changes-requested`, `approved`, `rejected`, `superseded`, `withdrawn`. Transitions implied: draft → submitted (Tech Lead action), submitted → under-review (Architect picks up), under-review → approved/rejected/changes-requested, changes-requested → draft (or back to submitted), approved → superseded (new version), any → withdrawn (author or steward). The PRD never names `withdrawn`, never specifies whether a `rejected` artifact can be revised-and-resubmitted, never says whether an `approved` artifact can be revoked. F-207's "new versions can supersede prior versions with explicit rationale" implies a supersession transition, but does not say whether supersession requires approval (it must, per NFR-032) and whether downstream artifacts generated from the superseded version are auto-flagged.

- **Approval workflow (F-205, F-006).** States: `requested`, `in-review`, `decided` (with sub-states `approved`, `rejected`, `changes-requested`). Open questions: can an approval be revoked? Is there a time-out auto-rejection? Is there escalation? Can a single submission require multiple approvers (e.g., both Architect and Steward)? F-003 says policies are "declarative policies defining which gates are mandatory at which artifact transitions" — but the policy shape is not in the entity sketch.

- **Connector / sync state (F-101, F-111, NFR-033).** States at minimum: `pending`, `syncing`, `healthy`, `stale`, `quarantined`, `failed`. NFR-033 ("PI remains usable even when some repositories, connectors, or documentation sources are unavailable") implies `quarantined` is a first-class state. The PRD does not say how long before `healthy` becomes `stale`, who is notified, or whether `quarantined` triggers a cost-savings stop on dependent workflows.

- **Rollback paths are absent.** F-207 mentions "restore" via F-109 snapshots, but there is no rollback path for an `approved` artifact that turns out to be wrong, no rollback path for a `superseded` artifact that the new version turns out to be wrong, and no rollback path for a `rejected` artifact whose context changed. Architecture will have to invent each.

### 3. Multi-tenancy enforcement

The PRD commits to per-tenant isolation as a constitutional property (NFR-006, DL-005) and says it is enforced at query and storage layers (NFR-007). Walking every FR for tenant-data touch:

- **F-001 / F-002 / F-003 / F-010** — Organization Knowledge. Shared across tenants with Steward-controlled publishing. *Risk: read-only cross-tenant reads mean a single missing RBAC check leaks standards to unauthorized tenants.* Enforcement point: storage layer row-level security + Steward publish-state field + application-layer RBAC.
- **F-004 / F-005 / F-006** — RBAC, Audit, Approval. RBAC is by definition per-tenant; Audit must record the tenant of every action; Approval is per-tenant. *Risk: cross-tenant approval requests (e.g., a CMC Architect approves a Honeywell artifact) is a leak. Architecture must define the tenant-binding rule for every approver assignment.*
- **F-007** — Connector registry. Connectors are likely configured per-tenant (per-tenant GitHub org, per-tenant Jira project, per-tenant Confluence space). *Risk: a single global connector with global credentials becomes a cross-tenant exfiltration vector. Architecture needs a per-tenant credential boundary.*
- **F-008** — Admin UI. Steward-facing; likely sees across tenants. *Acceptable, but the Steward role is sensitive — Architecture needs to confirm Steward is the *only* cross-tenant role, and audit all cross-tenant reads.*
- **F-101 / F-102 / F-103 / F-104 / F-105 / F-106 / F-107 / F-108 / F-109 / F-110 / F-111** — All per-tenant. **All eleven FRs in Phase 0 touch tenant data.** None of them specify the isolation enforcement. The most exposure-heavy is F-108 (Q&A Interface) — a natural-language query that crosses repos, services, APIs, and DBs is the easiest place to miss a tenant filter. The second-most exposure-heavy is F-110 (Impact Analysis) — a similar shape. F-111 (Incremental Sync) is the easiest place to miss a tenant filter at write time.
- **F-201 / F-202 / F-203 / F-204 / F-205 / F-206 / F-207 / F-208 / F-209 / F-210** — All per-tenant via F-209 (Context-Aware Architecture Generation explicitly consumes tenant's knowledge graph). F-208 (Standards Attestation) is the only one that touches shared Organization Knowledge; the attestation must reference the tenant's project but the standards are shared.

The PRD says "enforced at query layer + storage layer" but does not name the mechanism. Architecture will need to pick: row-level security (e.g., Postgres RLS), schema-per-tenant, database-per-tenant, application-layer query rewriting, or a hybrid. The choice has direct cost and ops consequences and should be an ADR, not a PRD. **The PRD should at minimum say "the substrate MUST isolate by `engagement_id` at the storage layer, and all query paths MUST be reviewed for tenant-filter completeness."**

### 4. Knowledge graph strategy

OQ-006 is correctly flagged as a blocker, but the PRD already makes commitments that constrain the choice.

- **F-104 (Dependency Graph) implies edge queries across services, repos, and DBs.** A relational representation (PostgreSQL+AGE or graph tables) can do this; a vector store (GraphRAG) cannot. If Architecture picks a vector-first strategy, F-104's "captures direct + inferred dependencies" claim breaks at M3.
- **F-110 (Impact Analysis) implies multi-hop traversal with a latency SLO (NFR-011, currently `[TO BE MEASURED]`).** A pure graph DB does this natively; PostgreSQL graph tables require careful indexing or recursive CTEs; GraphRAG's traversal cost grows with hop count.
- **F-111 (Incremental Sync) implies event-driven updates with sub-day latency.** A single graph engine (Neo4j) supports this; a federated graph (per-source sub-graphs) does not. A-007 says "single graph engine, not federated" — so this is locked, but Architecture needs to confirm the lock survives contact with connector failure modes (NFR-033).
- **F-108 (Q&A Interface) implies natural-language queries that *look* like traversal but are actually LLM-mediated.** This is where GraphRAG has a real role (vector retrieval over graph-derived embeddings). The PRD does not say where the LLM sits in the graph query path.
- **NFR-031 (Knowledge Freshness) implies per-node timestamps.** A native graph DB supports this; PostgreSQL graph tables require schema discipline.
- **NFR-007 (No cross-tenant data leakage) implies the graph engine must support tenant-scoped queries.** Neo4j supports multi-database; PostgreSQL+AGE is per-DB. Architecture's choice here directly affects how NFR-007 is enforced.

The PRD's implicit commitments — multi-hop traversal, partial-failure tolerance, sub-day freshness, tenant isolation, low-latency impact analysis — collectively rule out GraphRAG as the primary substrate and push Architecture toward either Neo4j or PostgreSQL+AGE. **The PRD should state these constraints explicitly so Architecture is not asked to "evaluate" a choice the FRs have already made.**

### 5. Source-of-truth conflicts

OQ-007 is correctly flagged as a blocker, and several FRs already presume a resolution.

- **F-103 (Architecture Discovery)** "infers services, modules, and architectural boundaries from repository + dependency evidence." This presumes **code is the source of truth** for what services exist. If Jira's project structure disagrees with the code's actual service boundary, F-103 will surface the disagreement — but the PRD does not say which wins.
- **F-105 (API Catalog)** "owner, contract reference, version, status." Owner can be claimed by Jira (component owner), Confluence (page author), or code (CODEOWNERS). The PRD does not say which.
- **F-106 (Database Map)** "schemas, table relationships, ownership metadata." Ownership metadata can be derived from code (ORM models), from Confluence (data dictionary), or from Jira (data steward). The PRD does not say which.
- **F-110 (Impact Analysis)** is the most exposed: "given a requirement, produce affected repositories, services, APIs, and databases." The requirement lives in Jira; the affected services live in code. When the requirement references a service by Jira name and the code uses a different name (very common in brownfield), the impact analysis silently under-reports. The PRD does not say how this is resolved.
- **F-209 (Context-Aware Architecture Generation)** explicitly consumes "requirement + project knowledge graph + applicable standards." The example in §8.6 is "Add MFA Authentication" — a Jira-style requirement. If the requirement's "auth-service" doesn't match the code's actual auth boundary, the generated ADR is wrong. The PRD does not say how this mismatch is resolved at generation time.
- **F-208 (Standards Attestation)** requires the artifact to declare "which standards it complies with." If Jira and Confluence disagree about which standards apply to a project, which wins?

The PRD's example "Jira says Cognito, code says Keycloak" is a Phase 0 day-one reality, not an edge case. **The PRD should state a provisional source-of-truth policy (e.g., "code wins for runtime truth, Jira wins for human-process truth, explicit human override wins for everything else") so M3 can be honestly built.** Without this, every Phase 0 output is a guess.

### 6. Knowledge freshness as architectural invariant

NFR-031 says "the system explicitly indicates freshness." The addendum A.3 says graph nodes carry `freshness_at` and `freshness_source`. This is a reasonable shape but leaves open:

- **Who owns the clock?** Three plausible candidates: (a) the ingestion layer stamps the node when the data lands; (b) the upstream connector stamps the node when it last heard from the source; (c) the graph layer stamps the node when it last updated. Each gives a different "stale" signal. If F-103 uses (a) and F-110 uses (b), the "Last Updated 2 hours ago" label disagrees with itself.
- **Granularity.** F-101 ingests repos; F-102 detects languages; F-103 infers services. Each runs at a different cadence. Is freshness per-node (fine-grained, expensive) or per-subgraph (cheaper, but masks the stale part)?
- **Propagation.** When F-111 syncs a new commit, does it update freshness on the *service* node, the *repo* node, the *API* node, and the *DB* node, or only on the one that changed?
- **Cross-tenant freshness.** CMC's knowledge graph freshness is independent of Honeywell's. Is freshness per-tenant or per-organization (Steward-visible)?
- **Staleness threshold.** NFR-031 names the signal but not the threshold. "2 hours ago" is stale for a 10-minute sync; fresh for a weekly review. Architecture needs a per-FR staleness threshold.

**The PRD should commit to: (a) freshness is owned by the graph layer, not the ingestion layer; (b) freshness is per-node; (c) staleness thresholds are defined per-FR in Architecture; (d) freshness is per-tenant.**

### 7. Cost governance as architectural invariant

NFR-030 says "per-tenant token usage, model spend, workflow cost, budget thresholds tracked and enforceable." The addendum A.3 says workflow instances carry `cost_estimate`, `cost_actual`, `cost_budget`. This is a reasonable shape but leaves open:

- **Unit of attribution.** Token? Request? Workflow? Engagement-month? Each implies a different cost ledger and a different enforcement point. If it's "token," the system must instrument every LLM call. If it's "workflow," estimates are coarse.
- **Enforcement point.** Pre-call (admission control), post-call (alert), both? A pre-call kill-switch is a hard architectural primitive; a post-call alert is a dashboard.
- **Budget ownership.** Steward-set? Per-tenant-admin-set? Per-engagement-lead-set? Each implies a different RBAC story.
- **Cost interaction with multi-provider routing (NFR-029).** Different providers price differently. If the system routes to the cheapest provider for a given task (a reasonable optimization), the cost ledger must record *which provider* per call. The addendum's `model_provider_id` covers this, but the policy is absent.
- **Cost across non-LLM operations.** F-101 ingestion can burn cost (compute, storage, third-party API calls) without any LLM involvement. NFR-030 says "per-tenant token usage, model spend, workflow cost" — the third term includes non-LLM cost, but the mechanism is unspecified.
- **Budget exhaustion during a workflow.** If a workflow has consumed 90% of its budget, can it continue? If it has consumed 100%, does it abort mid-generation? What happens to partial artifacts?

**The PRD should commit to: (a) cost attribution unit is "workflow" with token-level breakdown for analysis; (b) enforcement is pre-call admission control + post-call alert; (c) budgets are Steward-set with per-tenant override; (d) cost is recorded at every LLM call with provider + model + token count.**

### 8. Human approval as architectural invariant

NFR-032 says "no workflow may transition across defined governance boundaries without required human approvals." DL-002 reinforces. The PRD does not define "boundary."

Candidate boundaries the PRD implies but does not name:

- **Artifact-type transition** (draft → submitted → approved). This is the most natural read; F-205 / F-006 implement it.
- **Engagement-level transition** (a new engagement is created; a new project is onboarded; a project is closed). The PRD does not say whether these require approval, but the audit log (F-005) implies they are tracked.
- **Cross-tenant transition** (a Steward publishes a new standard to all tenants; a cross-tenant knowledge transfer happens). The PRD says Organization Knowledge is Steward-controlled, but does not say which Steward actions require approval.
- **Cross-system transition** (a connector is registered; a connector's scope is changed; a system of record is decommissioned). F-007 is Steward-administered; the PRD does not say which actions require approval.
- **Override transition** (a Steward overrides a policy; an Architect overrides a Steward attestation). F-005 logs overrides, but the PRD does not say which overrides are permissible and which require higher approval.
- **Supersession transition** (an approved artifact is superseded). F-207 names supersession; the PRD does not say whether supersession requires approval (it must, per NFR-032, but the boundary name is missing).

**The PRD should commit to a list of boundaries and the default approval matrix.** Without this, F-003 ("declarative policies defining which gates are mandatory at which artifact transitions") is unanchored.

### 9. Compliance scope

"SOC2-ready" (NFR-001, DL-011) implies controls for: access control (CC6), change management (CC8), risk mitigation (CC9), logical access (CC6.1), authentication (CC6.2), authorization (CC6.3), data classification (CC6.7), monitoring (CC7.2), incident response (CC7.4), backup (A1.2), availability (A1.1), processing integrity (A1.3), confidentiality (C1.1), privacy notice (P1), consent (P2), data subject rights (P3–P6), retention (P4), disposal (P5). Walking the PRD:

- **CC6 (Logical access)** — F-004 RBAC + NFR-004 SSO/OIDC. Architecture needs: per-tenant role bindings, just-in-time access for break-glass, session timeout policy.
- **CC6.7 (Data classification)** — Not in the PRD. The PRD's data classes (audit log, knowledge graph, ingested source code, ingested Jira content, ingested Confluence content, generated artifacts) have different classification levels. Ingested source code and Jira content likely contain personal data (committer names, email addresses). Architecture needs a classification primitive.
- **CC7.2 (Monitoring)** — NFR-021 (structured logging), NFR-022 (metrics), NFR-023 (trace propagation). Architecture needs: SIEM ingest, anomaly detection on gate-skip / override spikes.
- **CC7.4 (Incident response)** — Not in the PRD. NFR-014 covers DR, but not incident response (detection, escalation, post-mortem, customer notification).
- **A1.2 (Backup)** — NFR-014 (RPO ≤ 24h, RTO ≤ 4h, daily backups, tested quarterly). Adequate.
- **C1.1 (Confidentiality)** — NFR-003 (TLS + AES), NFR-005 (secrets handling). Adequate for V1 controls-ready.
- **P1–P6 (Privacy)** — NFR-002 (GDPR-ready data handling, data subject rights, lawful basis, breach notification). The PRD does not address the **collision between right-to-erasure and audit immutability (NFR-020)**: if a data subject is erased from the knowledge graph, the audit log entry that references them must be retained (regulatory requirement) but must not re-leak the personal data. Architecture needs a pseudonymization primitive.
- **NFR-008 (Data residency)** — Single-region at V1. Adequate for controls-ready, but Architecture needs to pick a region.
- **NFR-005 (Secrets handling)** — "Stored in a managed vault; rotation supported." Architecture needs: per-tenant secrets isolation, connector credential rotation policy.

**The PRD's "controls-ready" posture is honest, but Architecture will be forced to make compliance decisions the PRD does not name: data classification, pseudonymization, incident response, audit-log topology. The PRD should either name these or explicitly defer them to ADRs (with owner and date).**

### 10. Pilot-vs-architecture sequencing

The build plan (M1–M8) implies an architecture that is available at M1. Checking M1's substrate against M3–M7's requirements:

- **F-001 Standards Library** — Purely a Steward-authored CRUD. M1-safe.
- **F-002 Templates** — Depends on F-010 (Artifact Registry). M1-safe.
- **F-004 RBAC** — Pure role model. M1-safe in shape, but **M3 (F-101) and M4 (F-108) require per-tenant enforcement that is not in F-004's description.** Architecture will retrofit or extend F-004 in M3.
- **F-005 Audit Log** — Append-only, tamper-evident. M1-safe, but **M3 (F-111) requires per-event-type schemas that the PRD does not enumerate**, and M7 (F-205, F-207) requires audit events for approval and supersession that the PRD does not enumerate. Architecture will invent these schemas.
- **F-006 Approval Engine** — "Request → review → decide → record." M1-safe, but **F-205 (Approval Workflow) and F-003 (Policy Engine) require a policy-evaluation engine that F-006 does not contain.** Architecture will retrofit.
- **F-010 Artifact Registry** — "Schema, version, required fields, relationships, lifecycle." This is the most load-bearing M1 primitive. **F-207 (Versioning & Supersession) requires lifecycle management that F-010 does not fully describe** (does supersession happen at the registry level, at the storage level, or both?).
- **M1 is missing: typed event substrate for F-111, LLM provider abstraction for F-201+, tenant-scoped cost ledger for NFR-030, tenant-scoped freshness ledger for NFR-031, query-layer tenant isolation primitive, per-FR cost estimation primitive, artifact supersession primitive, snapshot/diff primitive for F-109, policy evaluation engine for F-003, connector failure-mode primitive for NFR-033.**

Each of these is a Phase 0 / Phase 1 requirement that lands at M3, M4, or M5. If Architecture waits for M3 to design them, M3 will be late. If Architecture designs them at M1, M1 will be late. The PRD should either (a) expand M1 to include the missing primitives, or (b) explicitly state which M1 primitives will be retrofitted at M3/M4/M5 and accept the rework cost.

**The P1.5 Architecture Validation Gate is the right control, but it sits after M7. By then, the graph substrate (OQ-006) and the source-of-truth policy (OQ-007) are already baked in. The validation gate should split: a Gate 0 before M3 (graph substrate + SoT policy) and a Gate 0.5 before M6 (full architecture-package flow).**

## Mechanical notes

- **FR numbering is non-sequential (F-001 to F-010, F-101 to F-111, F-201 to F-210) with F-009 listed after F-010 in the Foundation table.** Cosmetic, but the reader pauses. Reorder to F-001 to F-010 sequentially.
- **`[TO BE VALIDATED DURING PILOT]` appears 20+ times in Section 5.** This is the right posture for numeric targets, but the PRD applies the same posture to **architectural** targets (NFR-011 impact analysis latency, NFR-012 approval latency) that Architecture needs to *design against*. The PRD should distinguish "metric to be measured in pilot" from "SLO target to be committed in ADR."
- **"Out-of-V1" is overloaded.** §4.4 (capability phases), §5.10 (NFRs), §6.3 (scope), and addendum E (NFRs) are partially overlapping but use different lists. A single "Out-of-V1" appendix would prevent downstream re-litigation.
- **NFR-033 is in §5.4 (Reliability) but is functionally a multi-tenancy / partial-failure requirement.** It would read better in §5.2.
- **The "Foundational architecture constraints" list in §5.11 is the actual ADR input, not Section 4.** Architecture should treat §5.11 as the constitutional document; Section 4 is the capability inventory.
- **The Demo Path (§8.6) implicitly commits to specific architecture behavior** — "context-aware generation (requirement + project intelligence + applicable standards — not requirement alone)" — that should be a testable FR rather than a demo script claim.
- **A-004 is recorded as a "refinement" but it is a fundamental change to the multi-tenancy model** that the addendum now reflects. The PRD body still describes NFR-006 in terms of "per-tenant" without naming the hierarchy. Architecture will work from addendum A.1; UX will work from the PRD body. This is a recipe for divergent implementations.
- **The decision log (`§7` in the PRD) and the audit-trail decision log (`.decision-log.md`) are different documents with overlapping content.** The PRD's §7 is a forward-flowing summary; `.decision-log.md` is the audit trail. The relationship should be stated in both files.
- **Cost Attribution / Chargeback is in the out-of-V1 NFR list (§5.10) and the out-of-V1 addendum (E).** But NFR-030 requires per-tenant cost *tracking*. The difference between "tracking" (in-V1) and "chargeback" (out-of-V1) is unclear; Architecture needs the distinction.
- **The PRD commits to "12-factor posture" (NFR-025)** but does not name the deployment topology. OQ-005 (cloud / self-hosted / hybrid) is unresolved. The two together are contradictory if Architecture picks self-hosted (12-factor assumes cloud).
- **NFR-009 was relaxed from 1000+ to 100+ during steering** but the rationale ("V1 users are KnackForge internal") does not survive a single CMC / Honeywell pilot if both have 100+ concurrent requirements. Architecture needs a scaling path even if the V1 target is 100+.

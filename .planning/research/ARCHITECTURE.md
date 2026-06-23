<!-- refreshed: 2026-06-23 -->
# Architecture Patterns — Forge AI v2.0 Pilot Readiness

**Domain:** Enterprise SDLC Agent Operating System (LangGraph + LiteLLM + MCP + PostgreSQL/AGE)
**Researched:** 2026-06-23
**Milestone:** v2.0 pilot readiness (post-pillar1)
**Overall confidence:** HIGH (anchored on 8 locked ADRs + mapped codebase; LOW on external 2026 SOTA claims because web search was unavailable in this session)

---

## Executive Summary

Forge v2.0 is a constitutionally-governed, multi-tenant Agent Operating System. The architecture is **already locked** for the three PRD blockers (OQ-005/006/007) via accepted ADRs and the codebase map at `.planning/codebase/ARCHITECTURE.md` is the canonical reference. This research file does **not** re-derive those decisions; instead it (a) confirms what is locked, (b) names what is still open for the pilot cutover, and (c) recommends specific architecture patterns for an Agent OS in 2026 — focused on post-pillar1 substrate (Code Validator sub-graph, Refactor Agent, per-stage tool bundles, fixed-budget LLM, day-one bootstrap), pilot deploy topology, and scaling into pilot volume.

The substrate is sound: PostgreSQL 17 + Apache AGE + pgvector on a single RDS instance with RLS gives Forge one operational footprint for relational, graph, and vector workloads (ADR-002). ECS Fargate + a separate audit account gives a SOC2-ready posture (ADR-001). Hybrid MDM with a Steward-editable priority policy gives an auditable source-of-truth conflict model (ADR-003). LiteLLM Proxy gives provider-agnostic LLM traffic with virtual keys, cost attribution, and audit (ADR-005). LangGraph gives a supervisor graph with native HITL interrupts and checkpointing (ADR-007). Append-only WORM audit with daily hash chain satisfies Rule 6 (ADR-008). White-labeling via `FORGE_COMMAND_MAP` satisfies DL-024 (ADR-004). xterm.js + native PTY gives the Terminal Center with 100% audit capture (ADR-006).

The pilot cutover must add three new layers without weakening R1–R8: (1) a Code Validator sub-graph with deterministic gate (NFR-042, F-501/F-503); (2) per-stage tool-bundle guardrails wired into the agent runtime (F-505, NFR-046); and (3) fixed-budget LLM admission control with gate metadata exposure (NFR-044). On the infra side, pilot cutover must (a) land blue/green ECS Fargate deployment with circuit-breakers on the LiteLLM Proxy, (b) extend the audit account topology with cross-region read replica for DR, and (c) operationalise Apache AGE maturity mitigations (NetworkX offload, statement timeout, slow-query log).

Confidence note: the locked decisions are HIGH confidence (read directly from accepted ADRs that were reviewed by the Architecture Working Group on 2026-06-20). The post-pillar1 patterns and pilot-cutover specifics are MEDIUM — they rest on the in-repo pillar1-execution-plan and architectural inference, not external benchmarks. No external web search was successful in this session, so any claim about "2026 production Agent OS practice" beyond the locked ADRs should be re-validated before pilot commit.

---

## Status by Question

### (a) Locked — Do Not Revisit

| Decision | ADR | Why locked |
|---|---|---|
| Single cloud (AWS) for V1 | [ADR-001](../architecture/decisions/0001-cloud-only-aws-deployment.md) | Team expertise; SOC2-ready managed services; per-tenant KMS; cross-account audit topology. Re-opening now would re-litigate NFR-001, NFR-008, NFR-014, NFR-035. |
| Single persistence substrate: PostgreSQL 17 + Apache AGE + pgvector | [ADR-002](../architecture/decisions/0002-postgresql-17-apache-age-pgvector.md) | A-007 commitment (single graph engine); hybrid SQL+Cypher for F-103; RLS uniform across relational and graph; one operational footprint. |
| Hybrid MDM + Steward priority conflict resolution | [ADR-003](../architecture/decisions/0003-hybrid-mdm-steward-priority.md) | Provenance array on each node; per-entity-type priority policy; deterministic suggestion + human override; full audit trail. |
| White-label via `forge-*` commands (no GSD leakage) | [ADR-004](../architecture/decisions/0004-gsd-white-labeling.md) | DL-024. Single source of truth: `FORGE_COMMAND_MAP`. Mirrored on the frontend in `apps/forge/lib/forge-commands.ts`. |
| LiteLLM Proxy as sole LLM ingress | [ADR-005](../architecture/decisions/0005-litellm-proxy-provider-abstraction.md) | DL-025 / NFR-029. Virtual keys per workflow; cost attribution; rule-1 enforcement. |
| Terminal Center via xterm.js + native PTY | [ADR-006](../architecture/decisions/0006-terminal-center-xterm-native-pty.md) | Workspace isolation; 100% byte audit capture. |
| LangGraph SDLC supervisor + sub-graphs | [ADR-007](../architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md) | `SDLCState` as Pydantic TypedDict; HITL interrupts; `AsyncPostgresSaver` for checkpointing. |
| Append-only WORM audit with hash chain | [ADR-008](../architecture/decisions/0008-append-only-worm-audit-trail.md) | Rule 6 / NFR-020. INSERT-only DB trigger; daily anchor; separate AWS account. |

**Locked stack:** Next.js 15 + React 19 + TanStack Query + Zustand + React Flow (frontend); FastAPI + Python 3.13 + Pydantic v2 + SQLAlchemy 2.x + Alembic (backend); LangGraph + LangChain + LiteLLM + OpenTelemetry (agent runtime); PostgreSQL 17 + pgvector + Apache AGE + Redis (data); Keycloak + OIDC/SAML + RBAC (auth); ECS Fargate + RDS + ElastiCache + S3 + KMS (infra). See [docs/architecture/overview.md](../architecture/overview.md) for the locked topology diagram.

### (b) Open — Must Be Decided for Pilot Cutover

Even with OQ-005/006/007 closed, the **pilot cutover** raises architecture-level questions that the ADRs do not yet answer. Each is flagged below with a recommendation.

#### OQ-P1. Pilot cutover deploy strategy on ECS Fargate

**Question:** ADR-001 commits to AWS and ECS Fargate but does not pick blue/green vs canary vs rolling. Pilot cutover with tenant data on the line demands explicit deploy strategy.

**Recommendation: Blue/Green on ECS Fargate with CodeDeploy + circuit-breaker + 10% canary bake.** Reasons:
- Green = the new task set runs against a clone of prod RDS (a logical replica promoted at cutover) so the first run exercises the new artifact against realistic data without impacting live traffic.
- CodeDeploy's ECS blue/green lifecycle hooks (`BeforeInstall`, `AfterInstall`, `ApplicationStart`, `Validation`, `BeforeAllowTraffic`, `AfterAllowTraffic`) map cleanly to Forge's approval gates — `Validation` runs the Code Validator sub-graph against green.
- 10% canary bake (5–10 min) catches cold-start LLM regressions (LiteLLM warm-up, MCP daemon lag, AGE extension warm caches) before 100% shift.
- Circuit-breaker on LiteLLM Proxy: if the green's LLM error rate exceeds 1% over the bake window, CodeDeploy auto-rolls back to blue.

Alternatives considered and rejected:
- **Rolling update with minimum healthy 100%**: simpler but no green environment for validation; if validation fails mid-roll you cannot un-roll without restoring from backup.
- **Pure canary (no blue/green)**: good for stateless APIs; for an Agent OS where checkpoint state, MCP server warmup, and AGE session pool matter, blue/green gives a clean reset.

#### OQ-P2. Knowledge-graph substrate at pilot scale

**Question:** ADR-002 commits to Apache AGE but does not specify how Forge operationalises AGE's maturity gap at pilot volume (Neo4j is more mature for pure graph workloads).

**Recommendation: Keep Apache AGE; add a hard operational ceiling + offload tier.** Specifically:
- **Tier-1 graph queries** (≤ 3-hop, ≤ 10K nodes, single tenant) stay in AGE via `SELECT * FROM cypher(...)` — these match F-103/F-104/F-110 use cases.
- **Tier-2 graph algorithms** (PageRank, community detection, shortest path across >10K nodes) offload to NetworkX via the `apache-age-python` adapter (`age_to_networkx` / `networkx_to_age`). Tenant scope enforced on the offload boundary (no cross-tenant data in any NetworkX run).
- **Statement timeouts** on AGE queries: 30s default, 120s hard cap. Slow-query log feeds the observability dashboard.
- **AGE extension version pinning** in `infra/terraform/` so a Postgres minor upgrade never silently bumps AGE.
- **Quarterly review trigger** to re-evaluate Memgraph/FalkorDB vs AGE if pilot volume exceeds 1M nodes per tenant (the threshold where AGE's native traversal starts to dominate cost).

Why this is safe for pilot:
- Pilot tenants (CMC, Acme, Globex) are estimated at < 100K nodes per project — well inside the AGE comfort zone.
- The NetworkX offload path already exists in `apache-age-python`; no new dependency.
- pgvector HNSW tuning is co-located and benefits from the same RDS instance.

Alternatives considered and rejected for pilot:
- **Migrate to Neo4j**: rejected — ADR-002 explicitly forbids it (A-007 single-graph-engine). Adds a second engine, breaks hybrid SQL+Cypher, breaks RLS uniformity.
- **Migrate to Memgraph or FalkorDB**: rejected — same operational-footprint argument; Memgraph has no pgvector (still needs Postgres); FalkorDB is younger than AGE.
- **Polyglot (AGE for relations + dedicated graph DB)**: rejected — explicitly violates A-007.

#### OQ-P3. Source-of-truth conflict policy at pilot volume

**Question:** ADR-003 commits to Hybrid MDM with Steward priority + provenance array on every node. The ADRs do not specify the pilot cutover behavior when no Steward is configured for an entity type, or how conflict volume scales.

**Recommendation: Adopt ADR-003 verbatim, add a conflict-volume guard + auto-resolution lane.** Specifically:
- **Default policy seeded at install** per ADR-003: code wins for runtime truth, Jira wins for human-process truth, human override wins for everything else.
- **Auto-resolution lane** for low-risk divergences (e.g., description strings, non-functional comments) using the priority policy without human review. Tracked in audit, surfaced in a daily Steward digest.
- **Escalation lane** for high-risk divergences (auth mechanism, data model, deploy target) — always human review, never auto-resolved.
- **Per-tenant conflict budget** — N conflicts/day before Steward gets a paging alert. Default 50/day.
- **Conflict-resolution SLA** measured and reported (time-to-resolve), feeding the M3 demo as a concrete pilot metric.

Alternatives considered and rejected:
- **Pure last-write-wins**: ADR-003 explicitly rejected this; ignoring domain semantics is a pilot-blocking defect for the "Jira says Cognito, code says Keycloak" scenario.
- **CRDT**: ADR-003 rejected as not fitting audit-first architecture; conflicts must be surfaced, not silently converged.
- **Event sourcing with replay**: ADR-003 rejected as duplicative of the audit log; provenance still needs priority rules.

### (c) Recommended Architecture Patterns for an Agent OS in 2026

The following patterns are recommended for the **pilot cutover layer** and are specific to multi-agent Agent OS deployments (LangGraph + LiteLLM Proxy + MCP servers + Postgres/AGE) in 2026. They are MEDIUM confidence because they rely on architectural inference from the in-repo pillar1-execution-plan and 2026-era Agent OS literature, not on external benchmarks validated this session.

#### Pattern 1: Sub-Graph Independence (NFR-043)

The Code Validator (F-501) and Refactor Agent (F-601) must be **separate LangGraph sub-graphs** with their own TypedDict state, separate prompt templates, separate LiteLLM virtual-key prefixes, and **no import** from `sdlc_agent.py` or development-agent tools. This is constitutional for agent validation (NFR-043 — "independent validator reasoning"): if the validator shares a prompt template or tool bundle with the developer, it cannot reason independently about code it just wrote.

**Why:** Production Agent OSes in 2026 (LangGraph-based) isolate validator and refactor sub-graphs to prevent self-justification bias. Independence is structurally enforced, not policy-declared.

**How to recognise it working:** A new validator prompt template cannot be invoked from a development node; a developer LiteLLM virtual key is rejected by the validator sub-graph.

#### Pattern 2: Deterministic Merge Gate (NFR-042)

The pre-commit security gate (F-503) returns `GateDecision.allowed: bool` based on a **rules-only** check against the ValidationReport produced by F-501. **LLM does not participate in the gate decision.** Pre-call admission rejects the call if LiteLLM cost projection exceeds the per-commit cap.

**Why:** An LLM in the gate path is a security regression — it can be coerced, prompt-injected via commit message, or hallucinated into a PASS. The gate must be deterministic so a tampered commit cannot bypass it. Rule 3 (human approval) is additive, not replaced.

**How to recognise it working:** A test mocks LiteLLM to raise and asserts the gate still returns the correct `GateDecision`. Audit row is written for every gate invocation regardless of outcome.

#### Pattern 3: Per-Stage Tool Bundle Guardrails (F-505, NFR-046)

Each SDLC stage (ideation, architecture, development, testing, security, deployment) declares a `ToolBundle` with `permitted_tools` and `denied_tools`. The agent runtime enforces it at the tool-invocation boundary — not via prompt, not via developer discipline. Default bundles ship in `services/tool_bundles.py`; Steward can override per tenant.

**Why:** Production Agent OSes in 2026 use declarative tool-bundle guardrails to prevent the "IDE shell became a deploy shell" class of failure. Policy is data, not code — overrides are auditable.

**How to recognise it working:** A development-stage agent that attempts `deploy` raises `ToolBundleViolation` and writes an audit row. No deployment agent can run `code_write` tools.

#### Pattern 4: Fixed-Budget LLM Admission Control (NFR-044)

Every workflow declares a `WorkflowBudget { ceiling_usd, spent_usd, status }` at start. Pre-call admission in `litellm_client.py` blocks LLM calls whose projected cost would exceed `ceiling_usd - spent_usd`. Gate metadata at every approval boundary exposes `budget.state` (R3 + NFR-044).

**Why:** Without a hard ceiling, an agentic loop can blow a budget silently. Production Agent OSes in 2026 enforce fixed budgets declaratively at admission time; the budget is part of the workflow definition, not a runtime side-effect.

**How to recognise it working:** A workflow whose projected cost exceeds ceiling gets a `BLOCKED` decision *before* the LiteLLM call is made; the audit log records the block; the approval gate displays the budget state.

#### Pattern 5: Day-One Bootstrap with Reference Standards (F-507, NFR-045)

Project onboarding triggers an idempotent `load_baseline(project_id)` that pulls the KnackForge reference standards (F-001), layers customer overrides, and persists the result. Project is not marked `active` until bootstrap completes. Re-running produces identical state.

**Why:** Production Agent OSes in 2026 treat tenant onboarding as a typed, idempotent bootstrap with a clear "done" signal. Without it, a partial bootstrap leaves the tenant in an undefined state and downstream agents reason against an incomplete governance baseline.

**How to recognise it working:** `GET /api/v1/projects/{id}/bootstrap/status` returns a typed `BootstrapStatus` with one of `PENDING | RUNNING | COMPLETE | FAILED`. Idempotency is asserted by a test that runs the bootstrap twice and compares outputs.

#### Pattern 6: Multi-Account Audit Topology with Cross-Region Read Replica

ADR-001 + ADR-008 commit to a separate AWS audit account. Pilot cutover should add **a cross-region read replica of the audit database** for DR (NFR-014: RPO ≤ 24h, RTO ≤ 4h).

**Why:** Single-region audit is the pilot's largest availability risk. A cross-region read replica satisfies RPO and gives an RTO path without rebuilding the audit chain.

**How to recognise it working:** A simulated regional failure (region blocked via SCP) still allows the audit log to be queried from the secondary region's read replica within the RTO window.

#### Pattern 7: Circuit-Breaker on LiteLLM Proxy and MCP Servers

Each MCP server and the LiteLLM Proxy must implement circuit-breaker semantics with explicit `closed / open / half-open` states, retry budgets, and exponential backoff. ECS Fargate health checks should fail the task if the LiteLLM upstream is `open`.

**Why:** In an Agent OS the LLM and MCP planes are the long tail of failure modes. Without a circuit-breaker, a degraded upstream causes cascading agent-run failures and a stuck event bus. Production Agent OSes in 2026 treat the LLM and MCP planes as the most likely failure surface.

**How to recognise it working:** A load test that disables the LiteLLM upstream for 60s causes the agent runtime to return a typed `UpstreamUnavailable` error within 5s; once the upstream returns, the circuit transitions to `half-open` and then `closed`.

---

## Component Boundaries (Confirmed from Codebase Map)

The component map is already canonical at `.planning/codebase/ARCHITECTURE.md` (372 lines) and at `docs/architecture/overview.md`. The map below confirms the boundaries and adds the **pilot-cutover** components.

| Layer | Component | Responsibility | Communicates with |
|---|---|---|---|
| Frontend | `apps/forge/` | Single Forge app; persona middleware; typed API client | `api/proxy/[...path]` → FastAPI |
| Edge | `api/proxy/[...path]` | Catch-all; injects `X-Forge-Tenant-Id`; persona cookie pass-through | FastAPI |
| API | `backend/app/api/v1/*` | 40+ feature routers; @audit on every endpoint | services/ |
| WebSocket | `backend/app/api/ws/*` | Terminal, runs, ideation real-time | services/ |
| Agent orchestration | `backend/app/agents/sdlc_agent.py` | Supervisor; HITL; checkpointing | services/, tools/ |
| Agent sub-graphs | `code_validator.py`, `refactor_agent.py` | Independent sub-graphs (NFR-043) | services/ via narrow tool bundles (F-505) |
| Approval gate | `backend/app/agents/approval_gate.py` | R3 enforcement; budget state exposure (NFR-044) | services/approval_workflow |
| Tools | `backend/app/agents/tools/*` | LLM wrappers, MCP client, repomix, KG | services/ |
| Service layer | `backend/app/services/*` | Domain logic; framework-free; sole writer to DB, bus, LLM | db/, core/ |
| **Pilot cutover services** | `merge_gate.py`, `steering_rules.py`, `tool_bundles.py`, `workflow_budget.py`, `day_one_bootstrap.py`, `aws_transform_client.py` | Deterministic gate, rule catalog, tool bundles, budget admission, bootstrap, AWS Transform | db/, core/, services/litellm_client.py |
| Persistence | `backend/app/db/*` | SQLAlchemy 2.0; RLS context; every row tenant+project | PostgreSQL 17 + AGE + pgvector |
| Schema | `backend/app/schemas/*` | Pydantic v2 request/response + typed artifacts | routers, services |
| Core | `backend/app/core/*` | Config, auth, audit decorator, idempotency, telemetry | third-party only |
| Cache/queue | Redis Pub/Sub | Event bus; one channel per EventType | services/event_bus |
| Provider abstraction | LiteLLM Proxy | Sole LLM ingress; virtual keys; cost attribution | services/litellm_client |
| External tool plane | `mcp-servers/<vendor>/` | One TS package per integration | services/connector_manager |
| Infra (locked) | AWS ECS Fargate + RDS + ElastiCache + S3 + KMS (audit account) | ADR-001, ADR-008 | all |

**Pilot cutover additions** (in `services/`):
- `merge_gate.py` — F-503 deterministic security gate
- `steering_rules.py` — F-504 Markdown steering rules engine
- `tool_bundles.py` — F-505 per-stage tool-bundle guardrails
- `workflow_budget.py` — NFR-044 fixed-budget LLM admission
- `day_one_bootstrap.py` — F-507 day-one bootstrap with reference standards
- `aws_transform_client.py` — DL-029 Refactor Agent leverage of AWS Transform

**Pilot cutover additions** (in `agents/`):
- `code_validator.py` + sub-nodes — F-501 Code Validator sub-graph (independent per NFR-043)
- `refactor_agent.py` + state — F-601 Refactor Agent sub-graph

**Pilot cutover additions** (in `api/v1/`):
- `validation_reports.py` — submit/retrieve ValidationReport (F-502)
- `steering_rules.py` — list/add/remove steering rules
- `tool_bundles.py` — list/override tool bundles
- `workflows.py` — budget declare/status/history (NFR-044)
- `projects.py` — bootstrap trigger/status/rerun (F-507)
- `webhooks.py` — `/github/pre-commit` for F-503

---

## Data Flow (Pilot Cutover)

The end-to-end data flow is already canonical at `.planning/codebase/ARCHITECTURE.md` (lines 184–219). The pilot cutover adds two flows:

### Flow A — Code Validator + Merge Gate

```
git push → GitHub pre-commit webhook
   → POST /api/v1/webhooks/github/pre-commit
   → services/merge_gate.enforce_security_gate(commit_sha, project_id)
      ├─ services/workflow_budget.check_budget(...) → BLOCKED? → 403
      ├─ agents/code_validator.run(sub_graph)         → ValidationReport (PASS/FAIL)
      └─ decision: rules-only, no LLM in gate path
   → services/remediation_router on FAIL: Jira ticket via F-007 MCP
   → audit row (PASS or FAIL) → audit_log
   → response: 200 + allowed=true | 403 + allowed=false
```

### Flow B — Day-One Bootstrap

```
F-021 onboarding wizard → last step
   → services/day_one_bootstrap.load_baseline(project_id)
      ├─ pull F-001 reference standards
      ├─ layer customer overrides (project metadata)
      ├─ persist typed BootstrapResult (idempotent: rerun returns same state)
      └─ audit row → audit_log
   → project.active = true (only after bootstrap COMPLETE)
   → UI shows bootstrap status from /api/v1/projects/{id}/bootstrap/status
```

### Flow C — Refactor Agent (Phase 4)

```
User triggers refactor analysis in UI (apps/forge/app/refactor/new)
   → services/refactor_agent.run(sub_graph)
      ├─ inventory_source → typed inventory
      ├─ plan_target (uses AWS Transform via aws_transform_client — DL-029)
      ├─ generate_phases → MigrationPlan (typed artifact, F-010)
      ├─ risk_register
      └─ push_to_jira on approval → F-213
   → audit row + MigrationPlan stored via artifact registry
   → UI displays phased view (apps/forge/components/refactor/PhaseTimeline)
```

---

## Pilot-Cutover Build Order

Dependencies flow downward. Each phase is independently shippable; the build order reflects risk reduction first, then feature completeness.

### Phase 1 — Substrate Lock (post-pillar1, before pilot cutover)

Sequencing rationale: pilot cannot run without (a) deterministic gate so a misbehaving agent cannot push to a customer repo, (b) budget admission so a runaway agent cannot blow the pilot cost cap, (c) tool bundles so a development-stage agent cannot deploy.

1. **Code Validator sub-graph** (`agents/code_validator.py` + nodes) — independent sub-graph per NFR-043. No LLM in gate path. Tracked in ValidationReport artifact (F-502).
2. **Steering Rules Engine** (`services/steering_rules.py`) — Markdown auto-discovery; watchdog-based re-index; per-engagement catalog. Tenant-scoped.
3. **Merge Gate** (`services/merge_gate.py`) — deterministic gate; pre-call admission; webhook integration with GitHub pre-commit. Remediation ticket on FAIL.
4. **Tool Bundle Guardrails** (`services/tool_bundles.py`) — declarative bundles per stage; runtime enforcement hook; Steward override with audit.
5. **Workflow Budget** (`services/workflow_budget.py`) — fixed-budget admission in `litellm_client.py`; budget state exposed at every approval gate (NFR-044).
6. **Day-One Bootstrap** (`services/day_one_bootstrap.py`) — idempotent reference-standards loader; project not active until COMPLETE.
7. **Refactor Agent** (`agents/refactor_agent.py`) — leverages AWS Transform (DL-029); MigrationPlan typed artifact; push-to-Jira on approval.

### Phase 2 — Pilot Cutover

1. **Blue/Green deploy on ECS Fargate** via CodeDeploy; `BeforeAllowTraffic` validation hook runs Code Validator against the green task set.
2. **Cross-region read replica** of audit database in a second AWS region; failover runbook tested in staging.
3. **Circuit-breaker on LiteLLM Proxy** + per-MCP-server circuit-breaker; typed `UpstreamUnavailable` errors surfaced at the agent runtime.
4. **Conflict-volume guard** — per-tenant conflict budget; auto-resolution lane for low-risk divergences; escalation lane for high-risk; Steward paging alert at threshold.
5. **AGE operational ceiling** — statement timeout 30s default, 120s cap; slow-query log; NetworkX offload for >10K-node algorithms; quarterly review trigger to re-evaluate substrate.

### Phase 3 — Pilot Volume Scaling

1. Per-tenant conflict budget tuned to actual pilot volume (review after first 30 days).
2. AGE query plan observation — if any tenant exceeds the Tier-1 ceiling (3-hop / 10K nodes), trigger the NetworkX offload path.
3. LiteLLM virtual-key quota tuning per tenant based on actual usage (NFR-030 cost attribution).
4. Audit chain anchor frequency review — daily default, increase to 6h if pilot audit volume warrants.

---

## Pilot-Cutover Implications

| Implication | Decision |
|---|---|
| Pilot cutover deploy strategy | Blue/Green on ECS Fargate via CodeDeploy; 10% canary bake; circuit-breaker on LiteLLM upstream. |
| Pilot KG substrate | Keep Apache AGE + pgvector. Tier-1 in AGE; Tier-2 offload to NetworkX. Quarterly review at >1M nodes/tenant. |
| Pilot conflict policy | Hybrid MDM with Steward priority per ADR-003. Add auto-resolution lane (low-risk) and escalation lane (high-risk). Per-tenant conflict budget with paging. |
| Validator independence | Code Validator is a separate LangGraph sub-graph with own state, prompts, virtual-key prefix. No import from `sdlc_agent.py`. |
| Deterministic gate | Merge Gate is rules-only; LLM does not participate in the decision path. Pre-call admission on cost. |
| Tool bundle posture | Per-stage declarative bundles enforced at the agent-runtime boundary; Steward override is auditable. |
| Budget admission | Workflow budget declared at start; pre-call admission blocks overrun; gate metadata exposes budget state. |
| Day-one bootstrap | Idempotent reference-standards loader; project not active until COMPLETE. |
| Audit topology | Separate audit account per ADR-001/ADR-008; cross-region read replica for NFR-014 DR. |
| Failure isolation | Circuit-breaker on LiteLLM Proxy and per-MCP server. Typed `UpstreamUnavailable` at agent runtime. |

---

## Anti-Patterns to Avoid (Pilot Cutover Specific)

1. **Sharing prompt template or tool bundle between development and validator sub-graphs** — breaks NFR-043 independence. Production Agent OS in 2026 enforces independence structurally (separate virtual keys, separate sub-graphs).
2. **Allowing LLM in the gate decision path** — F-503 is rules-only. An LLM in the gate is a security regression.
3. **Auto-promoting a project to `active` before bootstrap COMPLETE** — leaves the tenant in an undefined governance state; downstream agents reason against an incomplete baseline.
4. **Single-region audit without cross-region read replica** — violates NFR-014 RTO ≤ 4h in a regional failure.
5. **Quiet conflict resolution** — any conflict resolution without an audit row violates Rule 6.
6. **Direct provider SDK in code_validator or refactor_agent** — even sub-graphs must go through `litellm_client.py`. Violates Rule 1.
7. **Tool bundle bypass via direct service import** — enforcement is at the agent-runtime boundary; bypass through a service layer call is a stealth defect.
8. **Customer-visible GSD reference** — even in the validator or refactor UI. DL-024 / ADR-004 forbids.

---

## Scalability Considerations (Pilot Volume)

| Concern | Pilot (CMC, Acme, Globex) | 10x pilot volume | 100x |
|---|---|---|---|
| KG query latency (Tier-1 in AGE) | <100 ms (3-hop, 10K nodes) | <300 ms with HNSW tuning | Offload Tier-2 to NetworkX; consider read replica |
| LiteLLM Proxy throughput | 1 instance handles pilot volume | Auto-scale ECS service | Multi-region proxy; per-tenant rate limit |
| ECS Fargate task count | 2 tasks (one per AZ) | 4–6 tasks; blue/green = 2x at cutover | Multi-region active-active |
| Audit log volume | <10K rows/day | <100K rows/day; daily anchor sufficient | 6h anchor; partition audit table by month |
| Conflict volume | <50/day per tenant | 50–200/day; auto-resolution lane engages | Steward workload scaling; per-tenant policy tuning |
| MCP server fan-out | Per-vendor single task | Per-vendor multi-task | Per-tenant MCP isolation |
| NetworkX offload memory | <1 GB per run | <8 GB per run | Container memory limits + spill-to-disk |

---

## Confidence Assessment

| Area | Confidence | Reason |
|---|---|---|
| Locked decisions (OQ-005/006/007 + ADRs 001–008) | HIGH | Read directly from accepted ADRs reviewed by the Architecture Working Group on 2026-06-20. Cross-referenced in `docs/architecture/overview.md`, `.planning/codebase/ARCHITECTURE.md`, and the PRD. |
| Component boundaries + data flow | HIGH | Already mapped in `.planning/codebase/ARCHITECTURE.md` (372 lines) and the locked overview. |
| Pilot-cutover recommendations (OQ-P1/P2/P3) | MEDIUM | Inferred from ADR consequences + pillar1-execution-plan. Not externally benchmarked in this session (web search unavailable). |
| 2026 production Agent OS patterns (sub-graph independence, deterministic gate, tool bundles, fixed-budget, bootstrap) | MEDIUM | Architectural inference from the pillar1-execution-plan. Should be re-validated against external benchmarks before pilot commit. |
| Operational mitigations (cross-region read replica, circuit-breaker, AGE statement timeout) | MEDIUM | Standard AWS production patterns + ADR-001 consequences. Not benchmarked in this session. |
| Anti-patterns | HIGH | Drawn directly from `.planning/codebase/ARCHITECTURE.md` (lines 304–339) and ADR-004 (white-labeling). |

---

## Gaps to Address (Phase-Specific Research Flags)

| Gap | Where to research |
|---|---|
| External 2026 SOTA benchmarks for Agent OS deploy topology | Phase 1 spike: AWS Well-Architected review + LangGraph production case studies; LiteLLM Enterprise throughput benchmarks. |
| AGE vs Memgraph/FalkorDB at >1M nodes/tenant | Quarterly review trigger; only needed if pilot tenant exceeds the ceiling. |
| Code Validator prompt template quality | Phase 1 spike: prompt engineering for bandit/trufflehog/checkov/semgrep result interpretation. |
| AWS Transform SDK maturity for Refactor Agent | Phase 1 spike: boto3 AWS Transform coverage; mock fallback if SDK incomplete. |
| Cross-region read replica cost model | Phase 2 spike: AWS pricing for RDS read replica + cross-region data transfer. |
| Circuit-breaker thresholds (error rate, retry budget, half-open interval) | Phase 2 spike: load test with LiteLLM upstream degraded. |

---

## Cross-References

- `.planning/codebase/ARCHITECTURE.md` — 372-line architecture map (canonical)
- `docs/architecture/overview.md` — single-page architecture summary + topology diagram
- `docs/architecture/decisions/0001-cloud-only-aws-deployment.md` — ADR-001 (OQ-005)
- `docs/architecture/decisions/0002-postgresql-17-apache-age-pgvector.md` — ADR-002 (OQ-006)
- `docs/architecture/decisions/0003-hybrid-mdm-steward-priority.md` — ADR-003 (OQ-007)
- `docs/architecture/decisions/0004-gsd-white-labeling.md` — ADR-004 (DL-024)
- `docs/architecture/decisions/0005-litellm-proxy-provider-abstraction.md` — ADR-005 (DL-025)
- `docs/architecture/decisions/0006-terminal-center-xterm-native-pty.md` — ADR-006
- `docs/architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md` — ADR-007
- `docs/architecture/decisions/0008-append-only-worm-audit-trail.md` — ADR-008
- `docs/architecture/pillar1-execution-plan.md` — 30-task / 4-phase plan for Code Validator + Steering + MCP + Refactor Agent
- `docs/architecture/pillar1-prd-amendments.md` — Tier 1/2/3 PRD amendments
- `docs/research-forge-architecture-decisions-2026-06-20.md` — Source research for ADRs 001–008 (665 lines)
- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md` — Constitutional NFRs and FRs

---

*Architecture research: 2026-06-23. Anchored on 8 locked ADRs + 372-line codebase map + 60KB pillar1-execution-plan. Web search was unavailable in this session, so external 2026 SOTA claims are MEDIUM confidence and should be re-validated before pilot commit.*

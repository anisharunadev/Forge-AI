# Research Summary — Forge AI v2.0 Pilot Readiness

**Project:** Forge AI v2.0 — Pilot Readiness Milestone
**Domain:** Enterprise SDLC Agent Operating System
**Researched:** 2026-06-23
**Confidence:** HIGH on locked substrate + critical pitfalls; MEDIUM on pilot-cutover specifics

## Executive Summary

Forge v2.0 is a constitutionally-governed, multi-tenant Agent Operating System. The three PRD open questions (OQ-005/006/007) are **LOCKED** by ADRs 001/002/003 (accepted 2026-06-20). The substrate is sound: PostgreSQL 17 + Apache AGE + pgvector on one RDS with RLS, LangGraph supervisor with HITL interrupts, LiteLLM Proxy, Keycloak, React Flow, and an append-only WORM audit chain. Pilot is a *first-user-benchmark*: one tenant, one full SDLC workflow, every capability visualized, every gate live.

The recommended approach is a five-phase cutover: **Phase 0** (Tailwind drift reconciliation + `node-pty` package refactor), **Phase 1** (Substrate Lock — Code Validator sub-graph, Merge Gate, Tool Bundles, Workflow Budget, Day-One Bootstrap, Refactor Agent), **Phase 2** (Pilot Cutover Hardening — blue/green ECS, cross-region audit replica, circuit-breakers, conflict-volume guard, AGE ceiling, Approval Timeline page, Constitution rulebook), **Phase 3** (Pilot Volume Scaling), **Phase 4** (Expansion / multi-tenant verification with tenant-isolation smoke test before tenant #2).

Key risks are: approval-gate UX bypass via direct API call (PITFALL-1), LLM cost explosion because pre-call admission pre-authorizes $0.05 vs $0.40–$1.20 actual long-context cost (PITFALL-2), RLS silent leak that surfaces only when tenant #2 is added (PITFALL-4), audit/observability gap because `BasePhaseNode` writes to event bus not `audit_events` (PITFALL-5), and hard-coded 24h approval timeout leaving runs stuck over weekends (PITFALL-6). All have named behavioral mitigations.

## Key Findings (Top 7)

1. **OQ-005/006/007 are LOCKED.** ADR-001 (AWS), ADR-002 (PostgreSQL 17 + Apache AGE + pgvector), ADR-003 (hybrid MDM with Steward priority) are accepted. No Phase-1 OQ research is needed. The remaining pilot-cutover questions (OQ-P1 deploy strategy, OQ-P2 KG substrate at scale, OQ-P3 conflict policy at volume) are recommended as **ADR-009/010/011** before Phase 2 plan commits, not as full research phases.
2. **Stay on Tailwind 3.4.x for pilot.** CLAUDE.md declares Tailwind 4 but `apps/forge/package.json` pins `3.4.14`. Tailwind 4 is a breaking change (CSS-first config, Oxide engine, removed `@apply`). Update docs to match reality; defer Tailwind 4 to a dedicated post-pilot phase.
3. **TS-5 Approval Timeline is the highest-impact gap.** `apps/forge/app/governance-center/page.tsx` may not exist with a pending-decisions panel. PILOT-05 is a load-bearing hypothesis; without this page, the reviewer cannot see "who approved what and when" as a click, not a query. Verify before Phase 2 plan commits.
4. **PITFALL-2 cost explosion must be fixed in Phase 1.** `_DEFAULT_PROJECTED_CHAT_USD = 0.05` pre-auth vs $0.40–$1.20 actual for a 60k-context call to `claude-sonnet-4-6`. Derive per-call projected cost from prompt estimate × model price; enforce cumulative cap; pin a cheaper model for discovery/planning; surface "Run budget: $5.00 / Used: $0.34" before run starts.
5. **PITFALL-4 RLS silent leak.** `apps/forge/lib/api.ts:54` hard-codes `DEV_TENANT_UUID`; `tenant_id: UUID | str | None = None` defaults across 12+ ideation signatures; `workflow_budget.py` writes org-wide; `IDEATION_JIRA_PROJECT_KEY = 'FORA'` hard-coded; `audit_service.record` substitutes sentinel `"00000000-..."` for missing `project_id`. Run a tenant-isolation smoke test before any second-tenant onboarding; make `tenant_id`/`project_id` required (drop `= None`); CI grep gate forbids UUID literals in `apps/forge/lib/`.
6. **PITFALL-1 approval gate bypass.** `state.metadata.get(f"approval:{...}")` is stringly-typed; architecture/security/deployment services trust the supervisor. Add `@require_approval_phase(...)` decorator on every artifact-writing route; freeze `pending_approval` / `gate_decided_by` on the run-state Pydantic model; require `Idempotency-Key` on decisions.
7. **Audit/observability gap (PITFALL-5).** `BasePhaseNode` writes to event bus not `audit_events`; `gsd_wrapper` default `audit_sink` is in-memory (records vanish on restart); `OTEL_EXPORTER_OTLP_ENDPOINT=None` drops OTel spans. Default `gsd_wrapper.audit_sink` to `audit_service.record` in production; wire `OTEL_EXPORTER_OTLP_ENDPOINT` in `docker-compose.yml`; add `audit_sink=` and `otel_exporter_configured=` probes to `/healthz`.

## Implications for Roadmap

### Phase 0: Pre-Roadmap Hygiene (must land before any Phase 1 plan commits)

**Rationale:** Two known issues will keep producing wrong plan-phase assumptions downstream. Resolve them once.

**Delivers:**
- (a) `CLAUDE.md` / `overview.md` updated to "Tailwind 3.4.x" OR a committed Tailwind 4 migration scope
- (b) `node-pty` + `terminal-server.mjs` moved into `packages/forge-terminal-server`
- (c) CI grep gate: only `backend/app/services/litellm_client.py` may `import litellm`

**Addresses:** Stack drift in `.planning/PROJECT.md`; Rule 1 enforcement hardening.
**Avoids:** Tailwind 4 mid-pilot surprise (STACK §1.1); Rule 1 accidental regression.

### Phase 1: Substrate Lock (post-pillar1, before pilot cutover)

**Rationale:** Pilot cannot run safely without (a) deterministic gate so a misbehaving agent cannot push to a customer repo, (b) budget admission so a runaway agent cannot blow the pilot cost cap, (c) tool bundles so a development-stage agent cannot deploy. All six services are scoped in `docs/architecture/pillar1-execution-plan.md`.

**Delivers:**
1. `code_validator.py` sub-graph (F-501) — independent sub-graph per NFR-043; own state, prompts, virtual-key prefix; no import from `sdlc_agent.py`. Emits typed `ValidationReport` (F-502).
2. `services/steering_rules.py` (F-504).
3. `services/merge_gate.py` (F-503) — deterministic, rules-only; pre-call admission on cost; GitHub pre-commit webhook; remediation ticket on FAIL via F-007 MCP.
4. `services/tool_bundles.py` (F-505, NFR-046) — declarative bundles per stage; runtime enforcement at agent boundary; Steward override with audit.
5. `services/workflow_budget.py` (NFR-044) — fixed-budget admission in `litellm_client.py`; gate metadata exposes `budget.state`; derive per-call projected cost from prompt estimate × model price.
6. `services/day_one_bootstrap.py` (F-507) — idempotent reference-standards loader; project not `active` until COMPLETE; `GET /api/v1/projects/{id}/bootstrap/status` returns typed `BootstrapStatus`.
7. `agents/refactor_agent.py` (F-601) — leverages AWS Transform (DL-029); emits typed `MigrationPlan`; push-to-Jira on approval.

**ADR-009 (cost ledger schema), ADR-010 (conflict policy schema), ADR-011 (pilot-vs-multi-tenant KMS)** before any of the above code lands. KMS is LOW priority for pilot — single tenant, single key is fine; defer per-tenant CMK to tenant #3 or #5.

**Addresses:** DIFF-1, DIFF-2, DIFF-6, DIFF-7, DIFF-8, DIFF-9, TS-13.
**Avoids:** PITFALL-1 (`@require_approval_phase(...)` added with API router work), PITFALL-2 (pre-call admission enforced), PITFALL-5 partial (default audit_sink wiring).
**Research flag:** NONE for substrate items. **One small follow-up:** LangGraph 0.3 vs 0.4 breaking-change analysis before pinning `langgraph>=0.2.0` upward.

### Phase 2: Pilot Cutover Hardening

**Rationale:** The substrate must be operationalised for one-tenant production-grade pilot volume. Each item closes a PITFALL or a Constitution-in-UI gap.

**Delivers:**
1. **Blue/green ECS Fargate deploy** via CodeDeploy; 10% canary bake; `BeforeAllowTraffic` validation hook runs Code Validator against green. (OQ-P1)
2. **Cross-region read replica** of audit database; failover runbook tested in staging. (NFR-014 RPO ≤ 24h, RTO ≤ 4h)
3. **Circuit-breaker on LiteLLM Proxy** + per-MCP-server circuit-breaker; typed `UpstreamUnavailable` errors at agent runtime.
4. **Conflict-volume guard** — per-tenant conflict budget (default 50/day); auto-resolution lane for low-risk; escalation lane for high-risk; Steward paging alert. (OQ-P3)
5. **AGE operational ceiling** — statement timeout 30s default, 120s cap; slow-query log; NetworkX offload for >10K-node algorithms; quarterly review trigger at >1M nodes/tenant. (OQ-P2)
6. **`/constitution` page** (DIFF-1, PILOT-09) — 8 live health queries (e.g., Rule 1: `grep -r "from openai" backend/ apps/` should return zero non-test matches; Rule 2: every row has `tenant_id`; Rule 3: every approval had a human decision).
7. **TS-5 Approval Timeline page** — `apps/forge/app/governance-center/page.tsx` with pending-decisions panel; one-click approve/reject wired to `approval_workflow.py`. **Verify page exists before Phase 2 plan commits; if missing, this is the highest-pilot-impact gap.**
8. **TS-4 Audit Timeline page polish** — performance with >1000 events; rationale capture on approval/reject.
9. **TS-15 Real-time WS run progress** (F-210, PITFALL-8) — `architecture.section.*` events streamed via WebSocket; pre-warm KG 24h before `forge-arch-new`.
10. **Frontend RBAC enforcement** — `apps/forge/lib/rbac.ts` + `<RequirePermission>` component; same permission strings on frontend and backend.
11. **DIFF-3 Seven Visualizations** — audit gap; ship Knowledge Graph, Repository Graph, Dependency Graph, Workflow Graph, Audit Timeline, Approval Timeline; Agent Execution Graph is nice-to-have.
12. **Approval timeout scheduler** (PITFALL-6) — `APPROVAL_EXPIRED` event; UI badge; per-phase / per-tenant timeout config.

**Addresses:** TS-3, TS-4, TS-5, TS-15, DIFF-1, DIFF-3, DIFF-4.
**Avoids:** PITFALL-2 (hard ceiling enforced), PITFALL-3 (per-connector-type secrets buckets), PITFALL-5 (OTel wired, audit_sink default), PITFALL-6 (scheduler fires APPROVAL_EXPIRED), PITFALL-8 (streaming + pre-warm).
**Research flag:** One spike for circuit-breaker thresholds (load test with LiteLLM upstream degraded). OQ-P1/P2/P3 as ADR-009/010/011 before plan commits.

### Phase 3: Pilot Volume Scaling

**Rationale:** After 30 days of pilot traffic, tune to actual usage.

**Delivers:** per-tenant conflict budget tuned; AGE query plan observation (offload Tier-2 if any tenant exceeds 3-hop / 10K nodes); LiteLLM virtual-key quota tuning per tenant; audit chain anchor frequency review.

**Addresses:** Scalability row of `docs/architecture/overview.md`; cost attribution accuracy.
**Avoids:** Per-tenant overruns masked by org-level queries (PITFALL-2 mask).

### Phase 4: Expansion (Multi-Tenant + Multi-Region)

**Rationale:** Pilot is single-tenant; constitutional Rules 1–8 are designed for multi-tenant, but multi-tenancy must be *verified*, not assumed.

**Delivers:**
1. **Tenant-isolation smoke test** (PITFALL-4) — provision a second tenant; log in as non-admin; list first tenant's artifacts/audit/cost rows; every endpoint must return empty or 403, not 200-empty. **Run before any second-tenant onboarding.**
2. Make `tenant_id` and `project_id` *required* on every ideation / cost / audit signature. Drop `= None` default. Raise `TypeError` at the boundary.
3. CI grep gate: no UUID literals in `apps/forge/lib/`.
4. Startup assertion: `if dev_auth_bypass and settings.environment != "development": raise`.
5. Wire `IDEATION_JIRA_PROJECT_KEY` from connector config.
6. Per-tenant CMK (ADR-011 follow-up) at tenant #3 or #5.
7. Multi-region active-active LiteLLM Proxy; per-tenant rate limit.

**Avoids:** PITFALL-4 (RLS silent leak) — this entire phase is dedicated to second-tenant verification.
**Research flag:** AGE at >1M nodes/tenant vs Memgraph/FalkorDB (quarterly review trigger; only if pilot tenant exceeds the ceiling).

### Phase Ordering Rationale

- **Phase 0 first** because Tailwind 4 drift will keep producing wrong plan-phase assumptions until reconciled.
- **Phase 1 before Phase 2** because deterministic gate, budget admission, and tool bundles are preconditions for safe pilot traffic.
- **Phase 2 before Phase 3** because operational mitigations are load-bearing for the *first user's* first session, not the 30-day review.
- **Phase 4 last** because pilot is single-tenant; multi-tenancy verification is non-negotiable before the first second-tenant login.
- **Dependency flow downward:** each phase is independently shippable; build order reflects risk reduction first, then constitutional enforcement, then operational safety, then scale, then multi-tenancy verification.

## Anti-Recommendations (What NOT to Do)

- **NOT Neo4j** — forces second DB engine; RLS is Postgres-only; breaks hybrid SQL+Cypher; invalidates ADR-002.
- **NOT FalkorDB / Memgraph** — splits data plane; breaks single-substrate commitment; loses RLS uniformity.
- **NOT OpenRouter as primary LLM gateway** — keep LiteLLM Proxy. OpenRouter is a routing marketplace, not an audit instrument. LiteLLM Proxy can route *to* OpenRouter as a provider.
- **NOT Temporal as agent orchestrator** — Temporal is workflow-as-code, not LLM-aware. LangGraph provides stateful checkpoints, HITL interrupts, typed state.
- **NOT CrewAI / AutoGen** — role-playing multi-agent abstractions don't map to Forge's *state machine*. LangGraph's `StateGraph` + `interrupt` is the right primitive.
- **NOT direct LLM provider SDKs anywhere** — Rule 1 constitutional. Add CI grep gate.
- **NOT `@fora/*` scope in v2.0 active code** — `forge-*` (apps) or `@forge-ai/*` (packages); `archive/paperclip/` is history only.
- **NOT Tailwind 4 mid-pilot** — breaking change. Stay on 3.4.x; defer to post-pilot.
- **NOT promotion to `active` before day-one bootstrap COMPLETE** — leaves tenant in undefined governance state.
- **NOT LLM in the merge-gate decision path** — F-503 is rules-only.
- **NOT shared prompt template or tool bundle between development and validator sub-graphs** — breaks NFR-043 independence.
- **NOT single-region audit without cross-region read replica** — violates NFR-014.
- **NOT quiet conflict resolution** — any conflict resolution without an audit row violates Rule 6.

## Pilot-Readiness Blockers (must land before any pilot-phase plan commits)

1. **TS-5 Approval Timeline page exists** — verify `apps/forge/app/governance-center/page.tsx` has a pending-decisions panel and one-click approve/reject wired to `approval_workflow.py`. **If missing, this is the single highest-impact pilot blocker.** (PILOT-05, PITFALL-1, BLOCKING)
2. **ADR-009 cost ledger schema** + integration test asserting every LiteLLM completion writes exactly one `cost_ledger` row with non-null `workflow_id`. (NFR-030, NFR-044, PILOT-05 cost gates, BLOCKING)
3. **ADR-010 source-of-truth conflict schema** — `conflicted` state, `priority_policy` table, `conflict_events` audit record. Without this, PILOT-03 has no `conflicted` state to color. (PILOT-03, BLOCKING)
4. **Tailwind drift reconciled** — update `CLAUDE.md` and `overview.md` to "Tailwind 3.4.x" (matching reality), OR commit to a Tailwind 4 migration with a clear scope.
5. **PITFALL-4 mitigations shipped before second-tenant onboarding** — make `tenant_id` / `project_id` required on every ideation / cost / audit signature; remove `DEV_TENANT_UUID`; CI grep gate for UUID literals; startup assertion refuses to boot when `DEV_AUTH_BYPASS=1` and `environment != "development"`; wire `IDEATION_JIRA_PROJECT_KEY` from connector config.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (locked substrate) | HIGH | 8 ADRs accepted 2026-06-20; verified in source files. |
| Stack (drift fixes) | MEDIUM | Versions verified against upstream release pages; exact 2026-stable minor may shift. |
| Stack (missing for pilot) | HIGH | Inferred directly from PILOT-01..PILOT-10 acceptance criteria + NFRs. |
| Stack (anti-recommendations) | HIGH | Already decided in ADRs and 2026-06-20 research; rationale restated. |
| Features (table stakes) | HIGH | PRD + PROJECT.md + pilot-runbooks enumerate what's expected. |
| Features (differentiators) | MEDIUM | DIFF-1..5 HIGH (built or committed); DIFF-6..10 MEDIUM (committed but unverified end-to-end). |
| Features (anti-features) | HIGH | PROJECT.md "Out of Scope" + PRD §5.6 + Constitutional Rules enumerate exclusions. |
| Architecture (locked) | HIGH | Read directly from accepted ADRs reviewed by the Architecture Working Group on 2026-06-20. |
| Architecture (pilot-cutover) | MEDIUM | Inferred from ADR consequences + `pillar1-execution-plan.md`. Not externally benchmarked (web search unavailable). |
| Architecture (2026 Agent OS patterns) | MEDIUM | Architectural inference from `pillar1-execution-plan.md`. Should be re-validated before pilot commit. |
| Pitfalls (critical) | HIGH | Derived from `CONCERNS.md`, `ARCHITECTURE.md`, `TESTING.md`, P0/P1 runbooks, and incident-response runbook. |
| OQ-005/006/007 LOCKED | HIGH | ADR-001/002/003 accepted 2026-06-20; OQ-P1/P2/P3 are *new* pilot-cutover questions, not re-opens. |

**Overall confidence:** HIGH on locked substrate + critical pitfalls; MEDIUM on pilot-cutover specifics and 2026 SOTA patterns. The roadmap is ready to be drafted against Phase 0/1/2/3 as structured above.

## Gaps to Address (20 items)

1. **TS-5 Approval Timeline page** — does `apps/forge/app/governance-center/page.tsx` exist with a pending-decisions panel? Verify before Phase 2.
2. **TS-6 end-to-end path** — can a Tech Lead start an idea, watch it through gates, see the Jira ticket without API calls? Verify in Phase 1.
3. **TS-7 SDLC supervisor** — has the full graph been run on a real sample project? Verify in Phase 1 (`pillar1-execution-plan.md` M3).
4. **DIFF-3 seven visualizations** — how many of the seven exist as React Flow canvases? Likely 2–3 of 7. Audit gap before Phase 2.
5. **DIFF-1 Constitution rule health queries** — what is the query for each of 8 rules? Define 8 queries before building the page.
6. LangGraph 0.3 vs 0.4 breaking-change analysis (short follow-up).
7. LiteLLM Enterprise tier SLA — required before pilot ships if any customer commits to a 99.9% uptime SLO.
8. Apache AGE multi-tenant benchmark at 100+ concurrent traversals.
9. Floci vs LocalStack Community vs Moto for dev — `:latest` pinning is a smell.
10. WS client library choice — TanStack Query 5.62+ `streamedQuery` vs `react-use-websocket` (short follow-up).
11. Frontend RBAC pattern — Shadcn permission pattern composes with `policy_engine.py`? (short follow-up)
12. External 2026 SOTA benchmarks for Agent OS deploy topology (Phase 1 spike).
13. Code Validator prompt template quality (Phase 1 spike).
14. AWS Transform SDK maturity for Refactor Agent (Phase 1 spike).
15. Cross-region read replica cost model (Phase 2 spike).
16. Circuit-breaker thresholds (Phase 2 spike).
17. Realistic long-context prompt size for ADR generation at pilot repo size, and what model + price the pilot cap should assume.
18. Does Apache AGE's `cypher()` planner degrade past 1k graph nodes, or is RLS overhead the bottleneck?
19. Is the scheduler capable of detecting `pending_approval` runs older than the timeout, or is this a new scheduled job?
20. Does the architecture node already emit progress events on the event bus, or is that a Phase 2 deliverable?

## Sources

### Primary (HIGH confidence — accepted ADRs + codebase map)

- `docs/architecture/decisions/0001-cloud-only-aws-deployment.md` — ADR-001 (OQ-005 LOCKED)
- `docs/architecture/decisions/0002-postgresql-17-apache-age-pgvector.md` — ADR-002 (OQ-006 LOCKED)
- `docs/architecture/decisions/0003-hybrid-mdm-steward-priority.md` — ADR-003 (OQ-007 LOCKED)
- `docs/architecture/decisions/0004-gsd-white-labeling.md` — ADR-004 (DL-024)
- `docs/architecture/decisions/0005-litellm-proxy-provider-abstraction.md` — ADR-005 (DL-025 / NFR-029)
- `docs/architecture/decisions/0006-terminal-center-xterm-native-pty.md` — ADR-006
- `docs/architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md` — ADR-007
- `docs/architecture/decisions/0008-append-only-worm-audit-trail.md` — ADR-008 (Rule 6 / NFR-020)
- `docs/research-forge-architecture-decisions-2026-06-20.md` — 36KB source research for ADRs 001–008
- `docs/architecture/overview.md`
- `.planning/codebase/ARCHITECTURE.md` — 372-line architecture map
- `.planning/codebase/STACK.md` — installed versions inventory
- `.planning/codebase/INTEGRATIONS.md`
- `.planning/codebase/CONCERNS.md` — 290 lines of v2.0 violations and tech debt
- `.planning/codebase/TESTING.md`
- `.claude/CLAUDE.md` — constitutional Rules 1–8 + UI First Principle + 7 visualization targets
- `.planning/PROJECT.md` — Validated/Active (PILOT-01..10)/Out-of-Scope requirements

### Primary (HIGH confidence — pillar1 execution plan)

- `docs/architecture/pillar1-execution-plan.md` — 30-task / 4-phase plan for Code Validator + Steering + MCP + Refactor Agent
- `docs/architecture/pillar1-prd-amendments.md` — Tier 1/2/3 PRD amendments
- `docs/architecture/pillar1-gap-analysis.md`
- `docs/architecture/pillar1-alignment.md`

### Primary (HIGH confidence — pilot operations runbooks)

- `docs/operations/pilot-p0-pre-pilot.md` — P0 exit criteria, Keycloak import, sample repo selection
- `docs/operations/pilot-p1-kickoff.md` — `forge-arch-new` flow, First Aha Time targets
- `docs/operations/pilot-p2-stabilization.md`
- `docs/operations/pilot-p3-evaluation.md`
- `docs/operations/pilot-p4-expansion.md`
- `docs/operations/success-metrics.md` — TTTD + counter-metrics + adoption signals
- `docs/operations/incident-response.md` — severity matrix, triage SLA, Tier-1/2/3 rollback triggers
- `docs/operations/oncall-runbook.md`
- `docs/operations/rollback.md`

### Primary (HIGH confidence — PRD v2)

- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md` — PRD v2 (86KB)
- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/review-pilot-readiness.md`
- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/review-architecture.md`
- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/reconcile-brief.md`
- `docs/planning-artifacts/briefs/brief-forge-ai-2026-06-18/brief.md`

### Primary (HIGH confidence — research outputs being synthesized)

- `.planning/research/STACK.md` — stack delta research
- `.planning/research/FEATURES.md` — pilot-cutover feature landscape
- `.planning/research/ARCHITECTURE.md` — pilot-cutover architecture patterns
- `.planning/research/PITFALLS.md` — pilot cutover pitfalls

### Secondary (MEDIUM confidence — to validate before pilot commit)

- Tailwind 4 release notes (breaking-change shape well-documented; minor versions may shift)
- React 19 GA release notes (RC pin pattern verified)
- LangGraph 0.3 vs 0.4 breaking-change analysis — not yet performed
- AWS Well-Architected review + LangGraph production case studies (web search unavailable)
- LiteLLM Enterprise throughput benchmarks — to be commissioned

### Tertiary (LOW confidence — defer to spike)

- Memgraph / FalkorDB at >1M nodes/tenant vs Apache AGE (only if pilot tenant exceeds the ceiling)
- AWS Transform SDK coverage (boto3) — fallback to mock if incomplete
- Circuit-breaker thresholds (load test required)
- Cross-region read replica cost model (AWS pricing lookup needed)

---

*Generated 2026-06-23 by gsd-research-synthesizer (self-heal: agent returned content as text per the #222 false-refusal pattern; orchestrator persisted file to disk).*

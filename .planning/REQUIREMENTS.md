# Requirements: Forge AI v2.0

**Defined:** 2026-06-23
**Core Value:** Every shipped capability is visible, governed, and traceable end-to-end — from requirement → ADR → task → code → test → deployment — through a unified React Flow UI, with multi-tenant isolation, auditability, and human approval gates as constitutional invariants.

## v1 Requirements

Pilot-readiness milestone. Each requirement maps to a roadmap phase.

### Pilot Onboarding

- [ ] **PILOT-01**: Internal user can complete onboarding in <30 min via single wizard (project name, primary connector, LLM provider, sample repo URL) without code changes.
- [ ] **PILOT-02**: SDLC supervisor runs the full `discovery → planning → architecture → implementation → testing → security → review → deployment` chain on a sample project, with HITL interrupts only at the three constitutionally-required gates (Architecture, Security, Deployment).

### Visualization & UI

- [ ] **PILOT-03**: Every artifact produced by an agent is queryable in the **Knowledge Graph visualization** (React Flow) — node per artifact, edge per relationship, color-coded by status (draft / approved / conflicted / deployed).
- [ ] **PILOT-04**: Every artifact appears in the **Audit Timeline** with `{agent, model, prompt, tool, cost, artifact, timestamp, result}` from the `audit_log` table.
- [ ] **PILOT-05**: Approval workflow shows pending decisions on a dedicated **Approval Timeline** with one-click approve/reject from the UI, wired through `approval_workflow.py`.
- [ ] **PILOT-09**: Constitution rendered in the UI as a visible rulebook with a per-rule health indicator (green/yellow/red) showing real-time compliance status across 8 rules.
- [ ] **PILOT-10**: All 40+ REST routers under `/api/v1/*` have a corresponding page or panel in the UI — no backend-only capability.

### Real-time & Connectors

- [ ] **PILOT-06**: Terminal Center streams live agent execution (logs, tool calls, file diffs) over WebSocket with replay capability.
- [ ] **PILOT-07**: Connectors can be added via the **Connector Marketplace** UI without restart; auth secrets resolved through `mcp-secrets` (AWS Secrets Manager).

### Operational Lockdown (substrate + constitutional enforcement)

- [ ] **OPS-01**: **PITFALL-1 fix** — `@require_approval_phase(...)` decorator on every artifact-writing route; `pending_approval` / `gate_decided_by` frozen on the run-state Pydantic model; `Idempotency-Key` required on decisions.
- [ ] **OPS-02**: **PITFALL-2 fix** — pre-call cost admission in `litellm_client.py` derives projected cost from prompt estimate × model price; cumulative cap enforced; per-run budget visible in UI before run starts.
- [ ] **OPS-03**: **PITFALL-5 fix** — `gsd_wrapper.audit_sink` defaults to `audit_service.record` in production; `OTEL_EXPORTER_OTLP_ENDPOINT` wired in `docker-compose.yml`; `audit_sink=` and `otel_exporter_configured=` probes on `/healthz`.
- [ ] **OPS-04**: **PITFALL-6 fix** — `APPROVAL_EXPIRED` scheduler fires; UI badge; per-phase / per-tenant timeout config.
- [ ] **OPS-05**: **Code Validator sub-graph (F-501)** — independent sub-graph per NFR-043; own state, prompts, virtual-key prefix; no import from `sdlc_agent.py`. Emits typed `ValidationReport` (F-502).
- [ ] **OPS-06**: **Merge Gate (F-503)** — deterministic, rules-only; pre-call admission on cost; GitHub pre-commit webhook; remediation ticket on FAIL via F-007 MCP.
- [ ] **OPS-07**: **Tool Bundles (F-505, NFR-046)** — declarative bundles per stage; runtime enforcement at agent boundary; Steward override with audit.
- [ ] **OPS-08**: **Workflow Budget (NFR-044)** — fixed-budget admission in `litellm_client.py`; gate metadata exposes `budget.state`.
- [ ] **OPS-09**: **Day-One Bootstrap (F-507)** — idempotent reference-standards loader; project not `active` until COMPLETE; `GET /api/v1/projects/{id}/bootstrap/status` returns typed `BootstrapStatus`.
- [ ] **OPS-10**: **Refactor Agent (F-601)** — leverages AWS Transform (DL-029); emits typed `MigrationPlan`; push-to-Jira on approval.
- [ ] **OPS-11**: **Steering Rules Engine (F-504)** — `services/steering_rules.py` wired to live filesystem events.
- [ ] **OPS-12**: **ADR-009 (cost ledger schema)** + integration test asserting every LiteLLM completion writes exactly one `cost_ledger` row with non-null `workflow_id`.
- [ ] **OPS-13**: **ADR-010 (source-of-truth conflict schema)** — `conflicted` state, `priority_policy` table, `conflict_events` audit record.
- [ ] **OPS-14**: **ADR-011 (pilot-vs-multi-tenant KMS)** — defer per-tenant CMK to tenant #3 or #5.

### Pilot Cutover Hardening

- [ ] **OPS-15**: **Blue/green ECS Fargate deploy** via CodeDeploy; 10% canary bake; `BeforeAllowTraffic` validation hook runs Code Validator against green. (OQ-P1)
- [ ] **OPS-16**: **Cross-region read replica** of audit database; failover runbook tested in staging. (NFR-014 RPO ≤ 24h, RTO ≤ 4h)
- [ ] **OPS-17**: **Circuit-breaker on LiteLLM Proxy** + per-MCP-server circuit-breaker; typed `UpstreamUnavailable` errors at agent runtime.
- [ ] **OPS-18**: **Conflict-volume guard** (OQ-P3) — per-tenant conflict budget (default 50/day); auto-resolution lane for low-risk; escalation lane for high-risk; Steward paging alert.
- [ ] **OPS-19**: **AGE operational ceiling** (OQ-P2) — statement timeout 30s default, 120s cap; slow-query log; NetworkX offload for >10K-node algorithms; quarterly review trigger at >1M nodes/tenant.
- [ ] **OPS-20**: **TS-4 Audit Timeline page polish** — performance with >1000 events; rationale capture on approval/reject.
- [ ] **OPS-21**: **TS-15 Real-time WS run progress** (F-210) — `architecture.section.*` events streamed via WebSocket; pre-warm KG 24h before `forge-arch-new`.
- [ ] **OPS-22**: **Frontend RBAC enforcement** — `apps/forge/lib/rbac.ts` + `<RequirePermission>` component; same permission strings on frontend and backend.

### Hygiene

- [ ] **HYG-01**: **Tailwind drift reconciled** — `CLAUDE.md` and `overview.md` updated to "Tailwind 3.4.x" (matching reality), OR committed Tailwind 4 migration scope.
- [ ] **HYG-02**: **`node-pty` package refactor** — `node-pty` + `terminal-server.mjs` moved into `packages/forge-terminal-server`.
- [ ] **HYG-03**: **CI grep gate** — only `backend/app/services/litellm_client.py` may `import litellm`; no UUID literals in `apps/forge/lib/`.
- [ ] **HYG-04**: **Startup assertion** — refuses to boot when `DEV_AUTH_BYPASS=1` and `environment != "development"`.

## v2 Requirements

Deferred to post-pilot. Tracked but not in current roadmap.

### Multi-tenant Verification (Phase 4)

- [ ] **PILOT-04-MT**: **Tenant-isolation smoke test** — provision a second tenant; log in as non-admin; list first tenant's artifacts/audit/cost rows; every endpoint must return empty or 403, not 200-empty. **Run before any second-tenant onboarding.**
- [ ] **PILOT-04-MT2**: Make `tenant_id` and `project_id` *required* on every ideation / cost / audit signature. Drop `= None` default. Raise `TypeError` at the boundary.
- [ ] **PILOT-04-MT3**: Wire `IDEATION_JIRA_PROJECT_KEY` from connector config.
- [ ] **PILOT-04-MT4**: Per-tenant CMK (ADR-011 follow-up) at tenant #3 or #5.
- [ ] **PILOT-04-MT5**: Multi-region active-active LiteLLM Proxy; per-tenant rate limit.

### Pilot Volume Scaling (Phase 3)

- [ ] **PILOT-V1**: Per-tenant conflict budget tuned.
- [ ] **PILOT-V2**: AGE query plan observation (offload Tier-2 if any tenant exceeds 3-hop / 10K nodes).
- [ ] **PILOT-V3**: LiteLLM virtual-key quota tuning per tenant.
- [ ] **PILOT-V4**: Audit chain anchor frequency review.

## Out of Scope

| Feature | Reason |
|---------|--------|
| **External pilot customer** | Internal dogfooding first; bringing in external pilot before v2.0 stabilizes risks both the pilot relationship and the platform. Defer to v2.0.x post-completion. |
| **Mobile / native client** | Web-first per CLAUDE.md `UI First Principle`; mobile deferred to v3+. |
| **Real-time collaborative editing of artifacts** | Out of scope for pilot; artifacts are versioned through the audit log, not CRDT-collaborative. |
| **Public Connector Marketplace (third-party submissions)** | Pilot ships a fixed catalog of 13 internal connectors plus `mcp-router` for self-hosted MCP servers. |
| **Cross-tenant Organization Knowledge sharing** | Rule 5 keeps Org Knowledge tenant-isolated; "shared" is *within* a tenant, not *across* tenants. |
| **Marketing site / pricing page / sales tooling** | Internal product only. |
| **Direct LLM provider SDK usage outside `litellm_client.py`** | Rule 1 constitutional; test fixtures must go through abstraction. |
| **`@fora/*` scope references in active code** | v2.0 naming convention; `archive/paperclip/` is history only. |
| **Tailwind 4 migration** | Breaking change mid-pilot. Stay on 3.4.x; defer to dedicated post-pilot phase. |
| **Neo4j / FalkorDB / Memgraph as KG substrate** | ADR-002 LOCKED — Postgres + Apache AGE + pgvector on one RDS with RLS. |
| **OpenRouter as primary LLM gateway** | ADR-005 — LiteLLM Proxy is the only LLM ingress; OpenRouter is a routing marketplace, not an audit instrument. |
| **Temporal as agent orchestrator** | ADR-007 — LangGraph provides stateful checkpoints + HITL interrupts + typed state. |
| **CrewAI / AutoGen** | Role-playing multi-agent abstractions don't map to Forge's state machine. |
| **Shared prompt template or tool bundle between development and validator sub-graphs** | NFR-043 — independence required. |
| **LLM in the merge-gate decision path** | F-503 is rules-only; LLM stays out of the gate decision. |
| **Single-region audit without cross-region read replica** | NFR-014 RPO ≤ 24h, RTO ≤ 4h. |
| **Quiet conflict resolution** | Any conflict resolution without an audit row violates Rule 6. |
| **Per-tenant CMK for pilot** | ADR-011 — defer to tenant #3 or #5; single key is fine for one-tenant pilot. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HYG-01 | Phase 0 | Pending |
| HYG-02 | Phase 0 | Pending |
| HYG-03 | Phase 0 | Pending |
| HYG-04 | Phase 0 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 1 | Pending |
| OPS-03 | Phase 1 | Pending |
| OPS-04 | Phase 1 | Pending |
| OPS-05 | Phase 1 | Pending |
| OPS-06 | Phase 1 | Pending |
| OPS-07 | Phase 1 | Pending |
| OPS-08 | Phase 1 | Pending |
| OPS-09 | Phase 1 | Pending |
| OPS-10 | Phase 1 | Pending |
| OPS-11 | Phase 1 | Pending |
| OPS-12 | Phase 1 | Pending |
| OPS-13 | Phase 1 | Pending |
| OPS-14 | Phase 1 | Pending |
| PILOT-01 | Phase 2 | Pending |
| PILOT-02 | Phase 2 | Pending |
| PILOT-03 | Phase 2 | Pending |
| PILOT-04 | Phase 2 | Pending |
| PILOT-05 | Phase 2 | Pending |
| PILOT-06 | Phase 2 | Pending |
| PILOT-07 | Phase 2 | Pending |
| PILOT-09 | Phase 2 | Pending |
| PILOT-10 | Phase 2 | Pending |
| OPS-15 | Phase 2 | Pending |
| OPS-16 | Phase 2 | Pending |
| OPS-17 | Phase 2 | Pending |
| OPS-18 | Phase 2 | Pending |
| OPS-19 | Phase 2 | Pending |
| OPS-20 | Phase 2 | Pending |
| OPS-21 | Phase 2 | Pending |
| OPS-22 | Phase 2 | Pending |
| PILOT-V1 | Phase 3 | Pending |
| PILOT-V2 | Phase 3 | Pending |
| PILOT-V3 | Phase 3 | Pending |
| PILOT-V4 | Phase 3 | Pending |
| PILOT-04-MT | Phase 4 | Pending |
| PILOT-04-MT2 | Phase 4 | Pending |
| PILOT-04-MT3 | Phase 4 | Pending |
| PILOT-04-MT4 | Phase 4 | Pending |
| PILOT-04-MT5 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 35 total (4 HYG + 14 OPS substrate + 9 PILOT + 8 OPS pilot-cutover = 35; PILOT-08 validated via ADR-001/002/003 LOCKED, no separate checkbox)
- v2 requirements: 9 (4 PILOT-V + 5 PILOT-04-MT) — tracked separately, mapped to Phase 3/4
- Mapped to phases: 35 v1 + 9 v2 = 44 total
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-23*
*Last updated: 2026-06-23 after initial v1.0 milestone bootstrap (YOLO mode — synthesized from PRD + codebase map + research SUMMARY)*

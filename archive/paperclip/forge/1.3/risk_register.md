# Risk Register — Epic "Forge Ideation Agent · Requirement Ingestion"

**Stage:** Ideation (sub-goal 1.3 of [Forge AI-15](/Forge AI/issues/Forge AI-15) → [Forge AI-17](/Forge AI/issues/Forge AI-17))
**Issue:** [Forge AI-61](/Forge AI/issues/Forge AI-61) — Sub-goal 1.3 — Epic generator (Epic + stories + acceptance criteria)
**Producer:** `ba-agent` (Hire #3, BMAD PM + BA, reports to CTO)
**Generated at:** 2026-06-17
**Companion artefacts:** [`epic_package.md`](./epic_package.md) · [`dependency_graph.json`](./dependency_graph.json) · [`cost_estimate.json`](./cost_estimate.json)
**Scoring:** Likelihood (L/M/H), Impact (L/M/H/C), Composite = `L × I` mapped to a 1–9 score; **Sev = P0/P1/P2/P3** by composite band (P0 ≥ 6 with Critical impact or any cross-tenant/PII/CISO-wedge failure; P1 = 6–8; P2 = 3–5; P3 ≤ 2).

---

## 1. Story-level risks (per story)

### S1 — Ideation Trigger Intake

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| R1.1 | Trigger shape drift between Slack / Forge console / API sources breaks normalization | L | M | P3 | Pin a single `trigger_shape` schema per source; lint step rejects any non-conforming input | Dev | Lint pass fails > 5 % of runs |
| R1.2 | Missing `received_at` or `verbatim` provenance fields | L | M | P3 | Schema-level required-field check at intake; reject before trigger_token issuance | Dev | Missing field caught in audit sample |

---

### S2 — Knowledge Layer Allow-List Reader

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R2.1** | **Agent reads outside the v1 allow-list due to prompt injection** | **M** | **H** | **P0** | **Allow-list enforced at the runtime layer, not the prompt (per `workspace/memory/security.md` §5). Any read attempt outside the allow-list returns `P0_AUDIT_FINDING` and halts the run. Per-tenant namespace on every read.** | **Security (Epic 5)** | **Any successful read outside the allow-list — page on-call immediately** |
| R2.2 | Allow-list itself becomes stale (new files added to workspace without updating the allow-list) | L | M | P3 | Allow-list versioned in the same repo as the workspace files; CI lint checks that every file referenced by the agent is in the allow-list | Dev | Stale allow-list detected by CI lint |
| R2.3 | `content_hash` collision on file content (extremely unlikely with sha256, but tracked) | L | L | P3 | sha256 is collision-resistant; tracked for completeness | Dev | Hash collision in audit log |

---

### S3 — Jira MCP Context Fetcher

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| R3.1 | Jira MCP outage during a run | M | L | P3 | Degraded-mode fallback: the run proceeds with Knowledge Layer only and emits a `degraded_mode: true` flag on the brief | Dev | MCP outage > 5 min during a run |
| R3.2 | Cross-project Jira reads via incorrect `project_pin` | L | C | P0 | Project-pin enforced at the MCP server layer (`mcp-servers/jira/README.md` §1); daily audit sample | Security (Epic 5) | Any cross-project read detected — page on-call |
| R3.3 | Confluence MCP not yet production-ready (CTO-resolved: in scope for v1; module is under-built per `tech_debt_score.json` MAINT-1) | M | M | P2 | Ship Jira-only first, gate Confluence on Architecture ADR approval; if Confluence not ready by first design-partner run, drop to Jira-only | Architect + Dev | Confluence MCP build-out slips past 2026-07-01 |
| R3.4 | Stubbed MCPs (Zendesk, Slack) return inconsistent `not_wired` shape over time | L | L | P3 | Schema-versioned stub responses; smoke test on every stub at startup | Dev | Stub schema drift caught in CI |

---

### S4 — `requirement_brief.json` Generator

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| R4.1 | Schema drift on `requirement_brief.json` breaks downstream stages | L | M | P3 | Schema versioned (`schema_version: "1.0"`); every breaking change requires an ADR; downstream stages pin to a specific version | Dev | Schema breaking change without ADR |
| R4.2 | Open questions without `owner` or `blocks` field (per Forge AI-59 §10 bar) | M | M | P2 | Lint step rejects briefs with `null` fields in `open_questions[]` | Dev | Lint fails > 5 % of runs |
| R4.3 | Success metrics without `number + baseline + target` | M | M | P2 | Lint step enforces all four fields; missing field → pair with `open_question_id` | Dev | Lint fails > 5 % of runs |
| R4.4 | Cost-attribution impossible because `tokens_in` / `tokens_out` not carried in the brief | L | M | P3 | Brief includes a `cost` block with `tokens_in`, `tokens_out`, `cost_usd`, `model` | Dev | Cost block missing in audit sample |

---

### S5 — `draft_prd.md` Generator

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R5.1** | **Agent hallucinates a section rather than marking it `partial`** — this is the failure mode that destroys customer trust (per Forge AI-59 §9) | **M** | **H** | **P0** | **Lint step: every section must have a `data_source` annotation. Sections without a source are hard errors. Eval set covers the "guess vs surface" failure mode.** | **PM + QA** | **Any hallucinated section detected in eval — page PM immediately** |
| R5.2 | PRD sections drift from the 11-section template (`workspace/project/PRD.md`) | L | M | P3 | Template-mirror lint check; block merge on drift | Dev | Template drift detected |
| R5.3 | Success metrics missing `number + baseline + target` slip into the PRD | M | M | P2 | Same lint as the brief; this is the bar | Dev | Metric missing > 5 % of PRDs |
| R5.4 | Internal ticket references left as bare ids (e.g., `Forge AI-61`) instead of clickable links | L | L | P3 | Lint step: regex match for `Forge AI-\d+` patterns not wrapped in `[...](/Forge AI/issues/...)` | Dev | Bare id detected |
| R5.5 | Cost / latency exceeds Draft PRD §8 guardrails (p50 ≤ 5 min, p95 ≤ 10 min; cost p50 ≤ $0.50, p95 ≤ $3.00) | M | M | P2 | Hard budget gate at the orchestrator layer (S8); prompt cache on; per-tenant token budgets | DevOps | p95 > 10 min OR cost p95 > $3.00 for 3 consecutive runs |

---

### S6 — Ambiguity Detection + `ask_user_questions` Interaction

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| R6.1 | Interaction schema gotchas — `selectionMode: "single"|"multi"` (NOT `type: "single_select"`); `request_confirmation` payload restrictions | M | M | P2 | "Read the reference first" rule; unit-test the interaction shape before posting; capture gotchas in `feedback-paperclip-ask-user-questions-schema.md` | Dev | Interaction rejected by API |
| R6.2 | Board never responds; the run parks forever | M | M | P2 | 7-day timeout on the interaction; auto-return to `in_progress` + "no board response" comment + CTO page | Dev | Timeout fires |
| R6.3 | `continuationPolicy` set to `none` so the agent never wakes up to continue | L | M | P3 | Always set `wake_assignee` on `ask_user_questions`; unit-test the policy field | Dev | Run stalls after board response |
| R6.4 | Ambiguity detector over-marks sections as `partial`, blocking downstream work on trivial gaps | M | L | P3 | Severity threshold: only mark `partial` if the gap is blocking (impacts Architecture or Dev handoff); otherwise emit as a non-blocking `open_question` | PM | False-positive rate > 20 % in eval |

---

### S7 — Audit Log Capture (Sub-goal 1.1)

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R7.1** | **Audit-log completeness < 100 % — a required entry is missing.** This is the CISO wedge (Forge AI-60 §4.1 differentiator #2); missing data is unrecoverable. | **L** | **C** | **P0** | **Daily audit sample (n=10 random runs); missing entry is a P0 and pages the Security agent immediately. Audit-sink write path is fail-closed (write fails → run halts, not "swallow the failure").** | **Security (Epic 5)** | **Any missing entry in the daily sample — page on-call** |
| R7.2 | Cross-tenant leak in the audit log itself (one tenant sees another's `tenant_id` queryable) | L | C | P0 | Per-tenant namespace on the audit sink; verified by the same tenancy-lint rules as the data layer | Security (Epic 5) | Any cross-tenant query returns > 0 rows — page on-call |
| R7.3 | Prompt/response capture (`Forge AI_LOG_LLM=1`) accidentally captures secrets | L | H | P0 | Secret-detection layer runs before write; if a prompt/response matches a secret pattern, the entry is redacted and a `REDACTION_APPLIED` audit entry is written | Security (Epic 5) | Secret detected in prompt/response — page on-call |
| R7.4 | Audit sink latency causes the agent run to slow beyond the p95 budget | L | M | P3 | Audit sink is async + best-effort with bounded retry; the *success* of an audit write is logged in-band, the *payload* is queued | DevOps | p95 audit-write latency > 100 ms |

---

### S8 — Per-Tenant Isolation + Per-Run Budget Enforcement

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R8.1** | **Cross-tenant data leak** — a run for tenant A reads tenant B's Knowledge Layer or MCP data. Per `workspace/memory/security.md` §4 this is a P0 critical incident. | **L** | **C** | **P0** | **Per-tenant MCP namespace enforced at the MCP server framework layer; tenancy-lint wired into CI Tier 1; daily audit sample.** | **Security (Epic 5)** | **Any successful cross-tenant read — page on-call** |
| **R8.2** | **Budget enforcement is bypassed** — agent reads past the $5.00 hard ceiling because the budget gate lives at the prompt layer, not the orchestrator layer | **M** | **H** | **P0** | **Budget gate enforced at the orchestrator layer; per-run cost tracked in-band; on crossing $5.00 the run halts and a `BUDGET_EXCEEDED` audit entry is emitted. Pinned unit test on the gate.** | **DevOps + Security** | **Any run exceeds the ceiling without halting — page on-call** |
| R8.3 | Per-tenant budget isolation: one tenant's runaway burn exhausts the shared budget pool | L | M | P3 | Per-tenant token budgets enforced independently of the per-run budget | DevOps | One tenant exceeds 20 % of the day's budget |
| R8.4 | Q6 (secrets ownership) unresolved → the MCP router or agent holds raw credentials in violation of `workspace/memory/security.md` §3 | M | H | P0 | Track Q6; if Q6 unresolved by Architecture handoff, escalate to CTO + Security (Epic 5) | CTO + Security | Q6 past 2026-06-25 without resolution |

---

## 2. Cross-cutting risks (spanning multiple stories)

| ID | Risk | L | I | Sev | Spans | Mitigation | Owner |
|----|------|---|---|-----|-------|------------|-------|
| R-X1 | LLM cost / latency creeps above the Draft PRD §8 guardrails | M | M | P2 | S4, S5, S7 | Hard budget at orchestrator (S8); prompt cache on (per `workspace/project/tech-stack.md` §8); per-tenant token budgets | CTO |
| R-X2 | Atlassian ships "Idea → PRD + audit" inside Jira Product Discovery before Forge AI's first design partner is signed | M | H | P1 | Epic-level | Knowledge Layer grounding + end-to-end SDLC closure is hard to replicate inside Atlassian; watch Atlassian Summit + Jira Product Discovery release notes | CEO + CTO |
| R-X3 | `apps/agent-runtime/` is TS-only despite `workspace/project/tech-stack.md` §2 saying Python 3.12 — documented vs actual divergence | L | L | P3 | S2, S3, S4, S5, S7 | Add ADR candidate ("TS in v1; Python tooling later"); Q8 — CTO due 2026-07-01 | CTO |
| R-X4 | No prompt-injection regression test set visible — `workspace/memory/security.md` §5 requires it | M | H | P1 | S2, S6, S7 | Q7 — ba-agent + future security-agent seed 5 prompt-injection + 5 role-violation eval cases before first design-partner run (due 2026-07-15) | PM + Security |
| R-X5 | No secrets client module exists; agent must not read Jira credentials from `process.env` | M | H | P1 | S3, S7, S8 | Q6 — CTO + Security (Epic 5) confirm secret-ownership path before Architecture handoff (due 2026-06-25) | CTO + Security |
| R-X6 | The "first design partner" scenario is too narrow to validate the agent end-to-end | M | M | P2 | Epic-level | Q3 2026 milestone #7: "First design partner runs a real feature end-to-end." Schema designed for that scenario, not for Forge AI-internal dogfood. | PM + CEO |

---

## 3. Risk roll-up

| Severity | Count | Notable |
|----------|-------|---------|
| **P0** | 6 | R2.1 (allow-list bypass), R3.2 (cross-project Jira), R5.1 (hallucinated section), R7.1 (audit incompleteness), R7.2 (cross-tenant audit), R7.3 (secret in prompt log), R8.1 (cross-tenant), R8.2 (budget bypass), R8.4 (secrets ownership) — **9 P0s** once R8.4 is counted (Q6-driven). |
| **P1** | 3 | R-X2 (Atlassian bundling), R-X4 (no safety eval set), R-X5 (no secrets client) |
| **P2** | 8 | R3.3, R4.2, R4.3, R5.3, R5.5, R6.1, R6.2, R-X1, R-X6 |
| **P3** | 12+ | Track-and-document; no escalation required |

**Composite risk profile:** moderate, dominated by **P0 controls** (cross-tenant, audit completeness, secrets ownership). The control framework exists (`tenancy-lint`, LocalStack runbook, ADR-0003, MCP project-pin), but several controls are not yet *verified* against this Epic's runtime path. The Composite from `tech_debt_score.json` is 43/100, which is consistent with this register's P0/P1 concentration — under the bar but not by much.

---

## 4. Risk → Story → Stage routing

| Severity | Story | Stage where the control is implemented | Stage where the control is verified |
|----------|-------|---------------------------------------|--------------------------------------|
| P0 | S2 (allow-list) | Dev | Security (Epic 5) |
| P0 | S3 (Jira cross-project) | Dev | Security (Epic 5) |
| P0 | S5 (PRD hallucination) | Dev | QA |
| P0 | S7 (audit completeness) | Dev | Security (Epic 5) |
| P0 | S7 (audit cross-tenant) | Dev | Security (Epic 5) |
| P0 | S7 (audit secret-leak) | Dev | Security (Epic 5) |
| P0 | S8 (cross-tenant) | Dev | Security (Epic 5) |
| P0 | S8 (budget bypass) | DevOps | Security (Epic 5) |

The P0 controls are predominantly Dev-built + Security-verified — this is the architecturally correct shape for an SDLC operating system (Sec verifies what Dev built). The PM/BA role here is to ensure the Story-level AC explicitly references the control (this Epic does; see R2.1 → S2 AC, R7.1 → S7 AC, R8.1 → S8 AC).

---

## 5. Open risk questions

| ID | Question | Owner | Due |
|----|----------|-------|-----|
| R-Q1 | Should S8 be merged with S2 and S3 (allow-list + MCP fetcher each carry their own isolation check), or kept as an orthogonal cross-cutting story? Current recommendation: keep separate for testability. | Architect + CTO | Architecture ADR (Sub-goal 2.1) |
| R-Q2 | What is the exact behavior of the 7-day timeout — auto-return to `in_progress` or auto-cancel? The Draft PRD §6.3 says "auto-return + CTO page"; confirm with the Master Orchestrator behavior. | Dev + CTO | Before S6 ships |
| R-Q3 | Per-tenant budget granularity: per tenant per day, per tenant per run, or both? Affects S8 AC and the per-tenant budget dashboard. | DevOps + CTO | Before S8 ships |

---

## 6. Related

- [epic_package.md](./epic_package.md) — 8 stories with AC
- [dependency_graph.json](./dependency_graph.json) — story-to-story edges
- [cost_estimate.json](./cost_estimate.json) — downstream stage cost roll-up
- [Draft PRD §9 Risks](/Forge AI/issues/Forge AI-59) — Epic-level risks (inherited)
- [Feasibility memo §10](/Forge AI/issues/Forge AI-60) — consolidated risks (inherited)
- [Tech-debt score `tech_debt_score.json`](./tech_debt_score.json) — sub-scores that motivate this register's P0 concentration
- [workspace/memory/security.md](../../../workspace/memory/security.md) §4 (tenant isolation), §5 (prompt-injection), §3 (secrets), §8 (runbooks)

---

**Change log**

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v1.0 | 2026-06-17 | BA (`99b34c5d-87d4-42a0-a66a-c65a916aeeec`) | Initial risk register — 9 P0s, 3 P1s, 8 P2s. P0 controls map cleanly to Security (Epic 5) verification path. |
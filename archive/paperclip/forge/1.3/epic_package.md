# Epic Package — Forge Ideation Agent · Requirement Ingestion

**Stage:** Ideation (sub-goal 1.3 of [Forge AI-15](/Forge AI/issues/Forge AI-15) → [Forge AI-17](/Forge AI/issues/Forge AI-17))
**Issue:** [Forge AI-61](/Forge AI/issues/Forge AI-61) — Sub-goal 1.3 — Epic generator (Epic + stories + acceptance criteria)
**Producer:** `ba-agent` (Hire #3, BMAD PM + BA, reports to CTO) — `99b34c5d-87d4-42a0-a66a-c65a916aeeec`
**Generated at:** 2026-06-17
**Inputs consumed:**
- [Draft PRD — Forge AI-59](/Forge AI/issues/Forge AI-59) (`forge/1.1/draft_prd.md`, attached as `ad8b9a31-54b9-4612-ac74-2da832085f4b`)
- [Requirement brief — Forge AI-59](/Forge AI/issues/Forge AI-59) (`forge/1.1/requirement_brief.json`, attached as `791378bc-129a-4f81-b151-9a2d74f5f07e`)
- [Feasibility memo — Forge AI-60](/Forge AI/issues/Forge AI-60) (`forge/1.2/feasibility_memo.md`, attached as `e0a79ebb-5d0c-4dba-82ab-ebbbc4ab3bfa`)
- [Tech-debt score — Forge AI-60](/Forge AI/issues/Forge AI-60) (`forge/1.2/tech_debt_score.json`, attached as `aa4b9204-0130-4e9c-85a2-3b1df2537491`)
**Companion artefacts:** [`dependency_graph.json`](./dependency_graph.json) · [`risk_register.md`](./risk_register.md) · [`cost_estimate.json`](./cost_estimate.json)
**N:** 8 stories (at the default cap — justified below)
**Board gate required:** yes — sub-goal 1.3 exit is gated on board approval per Forge AI-15 §3.3 and Forge AI-17 description.

---

## 1. Epic header

| Field | Value |
|-------|-------|
| **Epic title** | Forge Ideation Agent — Requirement Ingestion (Sub-goal 1.1) |
| **Parent Epic** | [Forge AI-17](/Forge AI/issues/Forge AI-17) "Epic 1 — Forge Ideation Agent" |
| **Parent Goal** | Enterprise AI SDLC Operating System (`5a1e3325-6383-447e-a7b6-f4f383fbfb95`) |
| **BMAD role** | PM (handoff-ready) → Architect → Dev → QA → Security → DevOps → Docs |
| **Producer of this Epic** | `ba-agent` (BA / PM, Hire #3) |
| **Consumer** | Architect (Sub-goal 2.1, [Forge AI-27](/Forge AI/issues/Forge AI-27)) takes the approved Epic and writes the Architecture design. |
| **Pushed to Jira by** | Sub-goal 1.4 ([Forge AI-62](/Forge AI/issues/Forge AI-62)) once the board approves this Epic package. |
| **Success metric (inherited)** | North star: ≥ 80 % of Draft PRDs pass structural lint on first try and advance to Architect without rework (per [Forge AI-59 §8](/Forge AI/issues/Forge AI-59)). |
| **Recommendation from 1.2** | GO with three conditions (Q1+Q5 before 1.3 hand-off, Q6 before Architecture handoff). Composite tech-debt = 43/100 (below 70 escalation). |

### 1.1 Why 8 stories (not more, not fewer)

The Draft PRD's product surface (Forge AI-59 §5) defines **8 distinct capability surfaces** that each need their own design + test + ship unit: (1) trigger intake, (2) Knowledge Layer reader, (3) Jira MCP fetcher, (4) brief generator, (5) PRD generator, (6) ambiguity interaction, (7) audit capture, (8) tenant isolation + budget. Collapsing any pair creates a story that touches >1 surface, which has historically violated the "smallest verifiable unit" rule in `workspace/memory/coding.md` §10 and produced stories that fail the lint gate. Splitting S5 (PRD generator) further would produce stories that don't ship independently. Eight is the right count for the Draft PRD's scope; a future iteration that adds Zendesk/Slack MCPs would push N to 10–12.

---

## 2. The Epic — "Forge Ideation Agent · Requirement Ingestion"

> **One-line:** Given a one-line product idea from a PM, return a board-approvable Draft PRD + structured requirement brief in under 10 minutes, with every agent step auditable and tenant-isolated.

**In scope (this Epic):**
- Accept a one-line ideation trigger from Slack / Forge console / direct API.
- Normalize the trigger into a `trigger_token`-keyed run.
- Read the customer's Knowledge Layer (v1 allow-list) and Jira MCP context.
- Produce a `requirement_brief.json` (schema-versioned) and a `draft_prd.md` aligned to `workspace/project/PRD.md`.
- Surface ambiguity as a structured `ask_user_questions` interaction.
- Capture every agent step in the audit log under `stage=ideation`.
- Enforce per-tenant isolation and per-run budget.

**Out of scope (v1 of this Epic, Forge AI-59 §7):**
- Writing to the Knowledge Layer.
- Calling tools outside the v1 MCP allow-list (Zendesk / Slack stubbed `not_wired`; Confluence **added** per CTO resolution of Q2 — see §6).
- Generating the Jira Epic or pushing to Jira (handled by Forge AI-61 itself + Forge AI-62).
- Auto-resolving ambiguity.
- Replacing the PM.

---

## 3. The 8 stories

Each story has: a description, Given/When/Then acceptance criteria, dependencies, rough effort (S/M/L), and a risk pointer (full risk detail in `risk_register.md`). Stories are labelled `S1`–`S8`.

### S1 — Ideation Trigger Intake

**Description:** Accept a one-line prompt from one of three sources (Slack message, Forge console "New idea" form, direct API call). Normalize the input into the `requirement_brief` trigger shape with `verbatim`, `received_at`, `source`, and a generated `trigger_token`. Stamp every downstream artefact (`requirement_brief.json`, `draft_prd.md`, audit entries) with the `trigger_token`.

**Acceptance criteria (Given/When/Then):**
- **Given** a PM drops a one-line prompt in the Forge console
- **When** the agent receives the trigger
- **Then** the `requirement_brief.ideation_trigger` block contains `raw_prompt`, `verbatim`, `source`, `source_url`, `received_at`, and a `trigger_token`
- **And** every downstream artefact written under this run is queryable by `trigger_token`.

**Dependencies:** none (entry point)
**Effort:** S
**Risk:** low — trigger shapes are deterministic; the only failure mode is a missing provenance field, which is caught by the lint step on the brief.

---

### S2 — Knowledge Layer Allow-List Reader

**Description:** Read the v1 allow-list (`workspace/project/{PRD,roadmap,tech-stack}.md`, `workspace/customer/{standards,conventions,glossary}.md`, `workspace/memory/ideation.md`). Enforce the allow-list at the **runtime layer** (not at the prompt layer — a prompt injection cannot widen the read-set, per `workspace/memory/security.md` §5). Emit one audit log entry per file read with `path`, `content_hash`, `byte_size`, `read_at`.

**Acceptance criteria (Given/When/Then):**
- **Given** an Ideation run is in progress
- **When** the agent reads a Knowledge Layer file
- **Then** the read is permitted only if `path` is in the v1 allow-list
- **And** any read attempt outside the allow-list is rejected, returns a `P0_AUDIT_FINDING` audit entry, and the run is halted
- **And** every successful read emits an audit entry with `path`, `content_hash` (sha256), `byte_size`, `read_at`
- **And** the read-set is reproducible — re-running the same trigger on the same Knowledge Layer produces the same `content_hash` list (modulo legitimate edits).

**Dependencies:** S1
**Effort:** M
**Risk:** medium — the allow-list must be enforced at runtime, not at prompt; this is the SEC-5 control and the failure mode (silent widening) is a P0.

---

### S3 — Jira MCP Context Fetcher

**Description:** Read existing epics, stories, dependencies, and status from the Jira MCP via project-pin (per `mcp-servers/jira/README.md` §1 — the project-pin safety posture is mandatory). Per the CTO resolution of Q2 (captured in [Forge AI-17 comment `74a3de28`](/Forge AI/issues/Forge AI-17#comment-74a3de28)), **Confluence is also in scope for v1** (read-only); Zendesk and Slack are stubbed with `not_wired`. Fall back to a "degraded mode" if the Jira MCP is unavailable: the run proceeds with Knowledge Layer only and emits a `degraded_mode` audit marker.

**Acceptance criteria (Given/When/Then):**
- **Given** an Ideation run is in progress and the customer's tenant has Jira MCP enabled
- **When** the agent calls Jira MCP
- **Then** every call carries the correct `project_pin` (no cross-project reads)
- **And** every call returns structured `epic` / `story` / `dependency` / `status` records
- **And** every call emits one audit entry under `stage=ideation`, `tool=jira_mcp`, with `query`, `response_count`, `response_hash`
- **And** if Jira MCP is unreachable, the run enters `degraded_mode`, the absence of Jira context is logged, and the brief includes a `degraded_mode: true` flag.

**Dependencies:** S1
**Effort:** M
**Risk:** low — the Jira MCP is well-built (E2 in `tech_debt_score.json`); the risk lives in the degraded-mode fallback, which has not yet been tested under real outage.

---

### S4 — `requirement_brief.json` Generator

**Description:** Produce a schema-versioned (`schema_version: "1.0"`) `requirement_brief.json` with the contract: `prompt`, `normalized_prompt`, `context_snapshot{workspace_files,mcp_sources,linked_artifacts}`, `problem_hypothesis`, `target_users[]` (each: `<persona> — <why they care>`), `out_of_scope[]`, `open_questions[]` (each: `id`, `question`, `owner`, `blocks`, `due_by`), `success_metrics[]` (each: `name`, `baseline`, `target`, `timeframe`), `constraints[]`, `links{parent_epic, draft_prd}`. Each `open_question` MUST carry an `owner` and a `blocks` field per the Draft PRD §10 bar.

**Acceptance criteria (Given/When/Then):**
- **Given** S1+S2+S3 have completed
- **When** the agent generates `requirement_brief.json`
- **Then** the JSON validates against the schema in `forge/1.1/requirement_brief.json` (`schema_version: "1.0"`)
- **And** every `open_question` has `owner`, `blocks`, `due_by` (no null fields)
- **And** every `success_metric` has `name`, `baseline`, `target`, `timeframe`
- **And** `links.parent_epic == "Forge AI-17"` and `links.draft_prd == "draft_prd.md"`
- **And** the brief is attached to Forge AI-59 (in 1.1) and is referenced by `parentId` on this Epic's stories.

**Dependencies:** S2, S3
**Effort:** M
**Risk:** medium — schema drift is a known failure mode (Forge AI-59 §9 risk #7); every schema change requires an ADR, downstream stages pin to a specific version.

---

### S5 — `draft_prd.md` Generator

**Description:** Produce a Draft PRD aligned to the 11 sections of `workspace/project/PRD.md`: Vision, Problem, Target customer, Core value propositions, Product surface, Key user journeys, Non-goals, Success metrics, Risks and mitigations, Open questions, Related. Lint step: every section non-empty; every `partial` section paired with an `open_question_id`; every success metric has `number + baseline + target`; every internal reference is a clickable `/Forge AI/issues/<id>` link per the Paperclip comment-style rule.

**Acceptance criteria (Given/When/Then):**
- **Given** S4 has completed
- **When** the agent generates `draft_prd.md`
- **Then** all 11 sections are present and non-empty (no `UNKNOWN` markers without a paired `open_question_id`)
- **And** every success metric has `number`, `baseline`, `target`
- **And** every ticket reference is a Markdown link with the `Forge AI-` prefix
- **And** every cross-reference to a workspace file uses the relative path that resolves from the issue thread
- **And** the PRD passes the structural lint defined in `workspace/project/PRD.md` (single source of truth for the template).

**Dependencies:** S4
**Effort:** L (largest story; this is the artifact)
**Risk:** high — if sections are vague, downstream stages inherit the vagueness; the north-star metric (% of Draft PRDs that pass lint on first try) measures this story directly.

---

### S6 — Ambiguity Detection + `ask_user_questions` Interaction

**Description:** Detect ambiguity in the Draft PRD (sections marked `partial`, open questions without `owner`, success metrics without `target`). For every **blocking** question, post an `ask_user_questions` interaction on the issue with `selectionMode: single|multi` per the Paperclip schema (NOT `type: single_select` — see `feedback-paperclip-ask-user-questions-schema.md`). On resolution, the Master Orchestrator clears the gate; on a 7-day timeout, the issue auto-returns to `in_progress` with a "no board response" comment and the CTO is paged.

**Acceptance criteria (Given/When/Then):**
- **Given** S5 produced a Draft PRD
- **When** the agent detects ≥ 1 blocking ambiguity
- **Then** the agent posts an `ask_user_questions` interaction on the issue with `selectionMode: "single"` for binary questions and `"multi"` for selection lists
- **And** the agent moves the issue to `in_review` with a comment naming what the board must decide
- **And** the agent sets `continuationPolicy: "wake_assignee"` so the run resumes after the board responds
- **And** on a 7-day timeout, the agent auto-returns the issue to `in_progress` and @-mentions the CTO.

**Dependencies:** S5
**Effort:** M
**Risk:** medium — interaction schema has known gotchas (`selectionMode` vs `type`, `request_confirmation` payload restrictions) captured in `feedback-paperclip-ask-user-questions-schema.md` and `feedback-paperclip-ask-user-questions-schema.md`; treat as a "read the reference first" story.

---

### S7 — Audit Log Capture (Sub-goal 1.1)

**Description:** Every Knowledge Layer file read (S2), every MCP call (S3), every prompt/response pair (when `Forge AI_LOG_LLM=1`) is captured in the audit log under `stage=ideation`, keyed by `run_id` and queryable by `tenant_id`. The Audit agent (Epic 5, once hired) reads this log for SOC 2 export; the Customer CISO reads it through the Forge console's audit view (per Draft PRD §6.2). Daily audit sample. P0 if any required entry is missing.

**Acceptance criteria (Given/When/Then):**
- **Given** S2 or S3 has executed
- **When** any read or MCP call completes
- **Then** one audit entry is written under `stage=ideation` with `run_id`, `tenant_id`, `tool`, `query_hash`, `response_hash`, `latency_ms`, `tokens_in`, `tokens_out`, `cost_usd`
- **And** the audit entry is queryable by `tenant_id` (no cross-tenant leak in the audit log)
- **And** when `Forge AI_LOG_LLM=1`, every prompt/response pair is captured with the same `run_id`
- **And** the daily audit sample (n=10 random runs) finds 100 % completeness — a missing entry is a P0 and pages the Security agent.

**Dependencies:** S2, S3 (audit captures their output)
**Effort:** M
**Risk:** high — audit completeness is a P0; missing data is unrecoverable. The audit log is the CISO wedge (Forge AI-60 §4.1 differentiator #2).

---

### S8 — Per-Tenant Isolation + Per-Run Budget Enforcement

**Description:** Enforce per-tenant namespace on every read and MCP call — a run for tenant A must never read tenant B's Knowledge Layer or MCP data. Enforce the per-run budget: **p50 ≤ $0.50, p95 ≤ $3.00, hard ceiling $5.00** (per Forge AI-59 §8). Above the ceiling, the run halts and the CTO is paged. Both controls are enforced at the orchestrator layer, not at the agent prompt.

**Acceptance criteria (Given/When/Then):**
- **Given** any Ideation run is in progress
- **When** the agent attempts a read or MCP call
- **Then** the call carries the correct `tenant_id` (verified by tenancy-lint's RLS-equivalent MCP-namespace enforcement)
- **And** a cross-tenant read returns a `P0_CROSS_TENANT` error and the run is halted
- **And** cumulative `cost_usd` is tracked per run; on crossing $5.00, the run halts and a `BUDGET_EXCEEDED` audit entry is emitted
- **And** the per-run budget report is included in the run comment at completion.

**Dependencies:** S1, S2, S3 (encloses all of them)
**Effort:** M
**Risk:** high — cross-tenant leak is P0 critical (per `tech_debt_score.json` SEC-1); budget enforcement must live at the orchestrator layer to be tamper-resistant.

---

## 4. Story-to-stage routing (which downstream role consumes each story)

| Story | Primary downstream stage | Secondary | First deliverable after board approval |
|-------|--------------------------|-----------|---------------------------------------|
| S1 Trigger Intake | Architecture (2.1) | Dev | Architecture ADR for trigger shape + token lifecycle |
| S2 Knowledge Layer Reader | Architecture (2.1) | Security | Runtime-enforced allow-list design (no prompt-only enforcement) |
| S3 Jira MCP Fetcher | Architecture (2.1) | Dev | Architecture decision: degraded-mode fallback shape |
| S4 `requirement_brief.json` | Architecture (2.1) | Dev | JSON schema ADR (pinned to `schema_version: "1.0"`) |
| S5 `draft_prd.md` Generator | Architecture (2.1) | Dev | LLM-call topology + prompt template + lint step |
| S6 Ambiguity + Interaction | Dev | QA | Interaction wiring (selectionMode, continuationPolicy, timeout) |
| S7 Audit Log Capture | Security (Epic 5) | Dev | Audit sink + daily sample harness |
| S8 Tenant Isolation + Budget | Security (Epic 5) | DevOps | Per-tenant namespace + orchestrator-level budget gate |

---

## 5. Story effort + risk summary (full detail in companion artefacts)

| Story | Effort | Risk | Notes |
|-------|--------|------|-------|
| S1 | S | low | Deterministic input shape |
| S2 | M | medium | Runtime allow-list (not prompt) — see SEC-5 |
| S3 | M | low | Jira MCP is solid; degraded-mode is the risky bit |
| S4 | M | medium | Schema drift is the known failure mode |
| S5 | L | high | North-star metric lives here |
| S6 | M | medium | Interaction schema gotchas — read the reference first |
| S7 | M | high | P0 if incomplete; CISO wedge |
| S8 | M | high | P0 if isolation fails; budget at orchestrator layer |

**Total effort:** S(1) + M(6) + L(1) = ~7 engineer-weeks of design + build (rough; Architect will refine).

---

## 6. Open questions inherited from 1.1 + 1.2 (must track through this Epic)

| ID | Question | Owner | Blocks | Status / resolution |
|----|----------|-------|--------|---------------------|
| Q1 | Trigger semantics — real customer vs Forge AI-self-dogfood? | CEO | Forge AI-60, Forge AI-61, Forge AI-62 | Open, due 2026-06-20. This Epic is trigger-agnostic; the *first* Epic shipped will be one or the other. |
| Q2 | MCP read-set for 1.1 | CTO | Forge AI-60 | **Resolved** (per [Forge AI-17 comment `74a3de28`](/Forge AI/issues/Forge AI-17#comment-74a3de28)): Jira + Confluence in v1; Zendesk + Slack stubbed `not_wired`. **S3 updated to reflect Confluence.** |
| Q3 | Worked example inclusion | PM / CTO | none | Open, due 2026-06-25 — does not affect this Epic. |
| Q4 | Cost measurement basis | CTO | none | Open, due 2026-06-18 — does not affect this Epic. |
| Q5 | Owner reassignment 1.2–1.4 | CEO | none (process) | Open, due 2026-06-20 — does not affect this Epic, but answers who closes Forge AI-62. |
| Q6 | Secrets-ownership path | CTO + Security | Architecture ADR | Open, due 2026-06-25 — **blocks** Architecture handoff (S2 allow-list enforcement depends on this). |
| Q7 | Seed safety eval set | ba-agent + future security-agent | First design-partner run | Open, due 2026-07-15 — does not block this Epic, blocks first prod run. |
| Q8 | ADR for agent-runtime TS-vs-Python | CTO | Knowledge Layer v1.0 sign-off | Open, due 2026-07-01 — does not block this Epic. |

---

## 7. Acceptance criteria for this Epic package (per Forge AI-61 description)

- [x] `epic_package.md` attached, latest revision.
- [x] `dependency_graph.json` attached.
- [x] `risk_register.md` attached.
- [x] `cost_estimate.json` attached.
- [ ] `request_confirmation` interaction posted; status of Forge AI-61 → `in_review`; comment names what the board must decide.
- [ ] On board approval → issue moves to `done`; Forge AI-62 unblocks automatically.
- [ ] On board rejection → issue moves to `in_progress`; follow-up comments with the board's reason.

---

## 8. Related

- Parent Epic — [Forge AI-17](/Forge AI/issues/Forge AI-17) "Epic 1 — Forge Ideation Agent"
- Draft PRD (input) — [Forge AI-59](/Forge AI/issues/Forge AI-59) (Sub-goal 1.1)
- Feasibility memo (input) — [Forge AI-60](/Forge AI/issues/Forge AI-60) (Sub-goal 1.2)
- BMad workflow — [Forge AI-15](/Forge AI/issues/Forge AI-15) (done)
- Next sub-goal — [Forge AI-62](/Forge AI/issues/Forge AI-62) (Sub-goal 1.4 — Jira sync, currently blocked on this issue)
- Workspace PRD template — [`workspace/project/PRD.md`](../../../workspace/project/PRD.md)
- Workspace tech-stack — [`workspace/project/tech-stack.md`](../../../workspace/project/tech-stack.md)
- Workspace memory — [`architecture.md`](../../../workspace/memory/architecture.md), [`security.md`](../../../workspace/memory/security.md), [`coding.md`](../../../workspace/memory/coding.md)
- Audit trail run — `e951dbfb-bd89-4508-bc9e-e8f462651c19`

---

**Change log**

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v1.0 | 2026-06-17 | BA (`99b34c5d-87d4-42a0-a66a-c65a916aeeec`) | Initial Epic package — 8 stories decomposed from the Draft PRD's product surface, aligned to Forge AI-17's sub-goal scope. |
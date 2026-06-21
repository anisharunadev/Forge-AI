# Multi-Agent Execution Plan — Pillar 1 Gap Closure

**Use with:** Claude Code multi-agent mode (ultrawork, team, or autopilot). Paste this entire file as the orchestrator prompt.

**Inputs consumed:**
- `docs/architecture/pillar1-gap-analysis.md` (gap matrix + decisions)
- `docs/architecture/pillar1-prd-amendments.md` (draft insertion text)
- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md` (PRD v2.0 — target of edits)

**Goal:** Apply 14 PRD amendments + implement 6 backend capabilities + 3 new MCP scaffolds to close the gap between Forge AI v2.0 and Pillar 1 Deep-Dive (Phase 1 + Phase 2).

**Success criteria:**
- All Tier 1 amendments applied to `prd.md` and committed.
- Code Validator Agent exists in code as a separate LangGraph sub-graph with own state.
- New MCP scaffolds exist for Adobe XD and Kiro.
- Refactor Agent sub-graph exists with AWS Transform orchestration hook.
- All R1–R8 constitutional rules preserved.
- Build passes, tests pass, no new errors.

---

## Phase Overview

| Phase | Title | Tasks | Tier | Dependencies |
|---|---|---|---|---|
| 1 | Foundation — Tier 1 PRD + Code Validator substrate | 11 tasks (4 waves) | sonnet / opus / haiku | None |
| 2 | MCP Coverage — Tier 2 amendments + new MCP servers | 7 tasks (2 waves) | sonnet / opus | None (independent of Phase 1) |
| 3 | Modernization Path — Tier 3 amendments + Refactor Agent | 6 tasks (3 waves) | sonnet / opus | Phase 1 (architectural patterns) |
| 4 | Closure — Resolve OQs + alignment note | 5 tasks (2 waves) | sonnet / opus / haiku | Phases 1–3 for verification |

Phases 1 and 2 can run in parallel. Phase 3 follows Phase 1 (reuses validator patterns). Phase 4 follows all.

---

## Dependency Matrix

```
Wave 1.1 ─┬─> Wave 1.2 ─┬─> Wave 1.3 ─> Wave 1.4
          │             │
Wave 2.1 ─┴─> Wave 2.2 ─┘ (parallel with Wave 1.3)
                         │
Wave 3.1 ─> Wave 3.2 ──> Wave 3.3 (depends on Phase 1 architecture)
                                              │
                       (all phases) ─────────┴─> Wave 4.1 ─> Wave 4.2
```

**Independence summary:**
- Wave 1.1 ⊥ Wave 2.1 ⊥ Wave 3.1 (all can fire simultaneously at start)
- Wave 1.2 waits for Wave 1.1
- Wave 1.3 waits for Wave 1.2
- Wave 2.2 waits for Wave 2.1
- Wave 3.2 waits for Wave 3.1 + Phase 1 Wave 1.2 (Code Validator sub-graph pattern)
- Wave 3.3 waits for Wave 3.2
- Wave 4.1 waits for Phases 1–3
- Wave 4.2 waits for Wave 4.1

---

# PHASE 1 — Foundation: Tier 1 PRD + Code Validator Substrate

**Goal:** Lock Pillar 1 Phase 1 substrate in PRD and code. This phase closes the 6 must-have Tier 1 amendments and implements the Code Validator Agent that Pillar 1 §11 requires as independent sub-agent.

**Acceptance criteria:**
- All 6 Tier 1 rows added to `prd.md` at specified insertion points.
- `backend/app/agents/code_validator.py` exists as separate LangGraph sub-graph.
- `backend/app/services/steering_rules.py` exists with workspace Markdown auto-discovery.
- `backend/app/services/merge_gate.py` exists with rules-based PASS/FAIL enforcement.
- `apps/forge/app/validator/page.tsx` exists with findings table.
- No R1–R8 weakening.

---

## Wave 1.1 — PRD Tier 1 Edits (fire all in parallel)

### T1.1 — Insert §5.4a Phase 1.5 Validators (F-501, F-502, F-503)

```yaml
id: T1.1
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Insert the new §5.4a "Phase 1.5 — Pillar 1 Validators (F-501..F-503)" section into
  docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md between §5.4 (line ~353)
  and §5.5 (line ~357).

  Use the EXACT insertion text from docs/architecture/pillar1-prd-amendments.md
  under heading "### F-501 Code Validator Agent + F-502 Validation Report + F-503
  Deterministic Security Gate".

  Steps:
  1. Read pillar1-prd-amendments.md to find the insertion block (copy the code block verbatim).
  2. Read prd.md around line 353-357 to confirm placement.
  3. Use Edit tool with old_string being the exact transition from §5.4 to §5.5.
  4. Verify no other text was changed.
  5. Run: grep -n "F-501\|F-502\|F-503" prd.md — must show 4 hits (3 in new section + 1 in deps).

  Report back: insertion success, line numbers of new rows, verification grep output.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - grep "F-501" returns 4+ matches
  - section §5.4a header exists
  - table row format matches §5.1a style
```

### T1.2 — Insert F-504 Steering Rules Engine

```yaml
id: T1.2
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Insert F-504 (Steering Rules Engine) as a new row in §5.1a (Foundation — Core Governance)
  of docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md, AFTER the F-010 row
  (line ~257).

  Use the EXACT insertion text from pillar1-prd-amendments.md under heading
  "### F-504 Steering Rules Engine".

  Steps:
  1. Read the F-504 block from pillar1-prd-amendments.md.
  2. Read prd.md §5.1a to find F-010 row context.
  3. Use Edit tool to insert the row after F-010.
  4. Verify F-504 appears between F-010 and §5.1b header.
  5. Run: grep -nE 'F-(010|504|011)' prd.md — confirm ordering.

  Report back: line number of F-504 row, grep output.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - F-504 row exists in §5.1a
  - Persona column lists "Steward, Tech Lead, Architect"
  - Depends column includes "F-001, F-010"
```

### T1.3 — Insert NFR-042 + NFR-043

```yaml
id: T1.3
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Insert two new NFR rows into docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md:

  - NFR-042 (Deterministic merge gate): insert in §6.6 (line ~475) AFTER the NFR-020 row.
  - NFR-043 (Independent validator reasoning): insert in §6.8 (line ~493) AFTER the NFR-030 row.

  Use the EXACT insertion text from pillar1-prd-amendments.md under headings
  "### NFR-042 Deterministic merge gate" and "### NFR-043 Independent validator reasoning".

  Steps:
  1. Read both NFR blocks from pillar1-prd-amendments.md.
  2. Read prd.md §6.6 and §6.8 to confirm insertion points.
  3. Two separate Edit calls — one per section.
  4. Verify NFR ordering remains monotonic within each section.
  5. Run: grep -nE 'NFR-(020|030|042|043|044)' prd.md — confirm ordering.

  Report back: line numbers of NFR-042 and NFR-043, monotonic ordering confirmed.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - NFR-042 in §6.6, NFR-043 in §6.8
  - Both reference F-501/F-503 in Notes column
  - NFR numbering remains monotonic
```

### T1.4 — Insert DL-031

```yaml
id: T1.4
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Insert DL-031 (IDE-integration-via-MCP-only) as a new row in §2 Decision Log of
  docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md AFTER the DL-027 row (line ~142).

  Use the EXACT insertion text from pillar1-prd-amendments.md under heading
  "### DL-031 IDE-integration-via-MCP-only".

  Steps:
  1. Read the DL-031 block from pillar1-prd-amendments.md.
  2. Read prd.md §2 to confirm DL-027 row context.
  3. Use Edit tool to insert DL-031 after DL-027.
  4. Verify DL numbering remains monotonic.
  5. Run: grep -nE 'DL-(027|028|029|030|031)' prd.md — confirm ordering.

  Report back: line number of DL-031, monotonic ordering confirmed.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - DL-031 in §2 after DL-027
  - Locked by column says "Pillar 1 Deep-Dive §11"
```

---

## Wave 1.2 — Code Validator + Steering Rules implementation (fire all in parallel; depends on T1.1, T1.2)

### T1.5 — Implement Code Validator Agent sub-graph

```yaml
id: T1.5
subagent_type: oh-my-claudecode:executor
model: opus
run_in_background: false
prompt: |
  Create the Code Validator Agent as a separate LangGraph sub-graph in
  backend/app/agents/code_validator.py with these requirements:

  Architecture:
  - File: backend/app/agents/code_validator.py
  - Sub-graph StateGraph with its own CodeValidatorState TypedDict (separate from SDLCState).
  - Nodes: scan_secrets, scan_iac, scan_vulns, scan_standards, aggregate_findings.
  - Entry point: scan_secrets (runs first). Fan-out to remaining scanners via Send API.
  - All scans return ValidationFinding objects (Pydantic) with: finding_id, severity,
    file_path, line, rule_id, evidence, recommended_fix, standards_ref.
  - Aggregate node produces ValidationReport artifact (per F-502 spec).

  Independence (NFR-043):
  - Separate prompt template file: backend/app/agents/prompts/code_validator.j2
    (do NOT reuse development agent prompts).
  - Separate LiteLLM virtual key prefix: forge_validator_* (via services/litellm_client.py).
  - No import from backend/app/agents/sdlc_agent.py or its nodes.
  - Own tool bundle (separate from development agent): bandit, trufflehog, checkov,
    semgrep. NEVER reaches for terminal, IDE-state, or git-write tools.

  Determinism (NFR-042):
  - Final output is ValidationReport { decision: Literal["PASS", "FAIL"], findings: [...] }
  - PASS requires zero findings with severity >= "high".
  - FAIL surfaces all findings in the report.

  Tests:
  - backend/tests/agents/test_code_validator.py with 6+ unit tests:
    1. Empty scan returns PASS.
    2. High-severity finding returns FAIL.
    3. Scanner fan-out executes all 4 scanners in parallel.
    4. State isolation: CodeValidatorState does not import SDLCState.
    5. Prompt template loads correctly.
    6. Independence: cannot import development-agent tools.

  Reference existing patterns:
  - backend/app/agents/sdlc_agent.py (LangGraph supervisor style — same library, NOT same graph).
  - backend/app/agents/sdlc_state.py (TypedDict pattern).
  - backend/app/agents/approval_gate.py (PASS/FAIL pattern).
  - backend/app/services/litellm_client.py (virtual key creation).

  DO NOT:
  - Add new external dependencies unless absolutely required.
  - Modify sdlc_agent.py.
  - Touch apps/ (UI is T1.9).

  Report back: file paths created, test count, build status, any blockers.
files_to_touch:
  - backend/app/agents/code_validator.py (new)
  - backend/app/agents/code_validator_state.py (new)
  - backend/app/agents/prompts/code_validator.j2 (new)
  - backend/app/agents/code_validator_nodes/__init__.py (new)
  - backend/app/agents/code_validator_nodes/scan_secrets.py (new)
  - backend/app/agents/code_validator_nodes/scan_iac.py (new)
  - backend/app/agents/code_validator_nodes/scan_vulns.py (new)
  - backend/app/agents/code_validator_nodes/scan_standards.py (new)
  - backend/app/agents/code_validator_nodes/aggregate_findings.py (new)
  - backend/tests/agents/test_code_validator.py (new)
dependencies: [T1.1, T1.2]
verification:
  - pytest backend/tests/agents/test_code_validator.py passes
  - No import from sdlc_agent.py in code_validator.py
  - LiteLLM key prefix is forge_validator_*
  - Returns ValidationReport with PASS/FAIL decision
```

### T1.6 — Implement Validation Report artifact schema

```yaml
id: T1.6
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Create the F-502 Validation Report artifact schema in
  backend/app/schemas/validation_report.py with these requirements:

  Schema (Pydantic v2):
  - ValidationReport: report_id, run_id, timestamp, validator_version, decision (PASS/FAIL),
    findings: list[ValidationFinding], summary: ValidationSummary, evidence_pack_url.
  - ValidationFinding: finding_id, severity (Literal["critical","high","medium","low","info"]),
    file_path, line, rule_id, evidence (str), recommended_fix, standards_ref (list[str]).
  - ValidationSummary: total_findings, by_severity (dict[str, int]), scan_duration_ms,
    scanners_executed (list[str]).

  Registration:
  - Add "validation_report" to backend/app/schemas/artifact_types.py registry
    (or create the file if it doesn't exist, following the F-010 pattern).
  - Schema-versioned: schema_version = "1.0.0".

  Storage:
  - ValidationReport persisted via existing audit log mechanism (F-005/ADR-008).
  - Append-only. Stored as JSON. Hash-chained.

  API:
  - POST /api/v1/validation-reports — submit a report.
  - GET /api/v1/validation-reports/{report_id} — retrieve.
  - GET /api/v1/validation-reports?commit_sha=X — list by commit.

  Tests:
  - backend/tests/schemas/test_validation_report.py — 4 tests covering schema validation,
    severity enum, summary aggregation, API round-trip.

  Reference existing patterns:
  - backend/app/schemas/ (existing Pydantic v2 schemas — match style).
  - backend/app/api/v1/ (existing routers — match style).
  - backend/app/core/audit.py (WORM pattern).

  Report back: files created, test count, API endpoints reachable.
files_to_touch:
  - backend/app/schemas/validation_report.py (new)
  - backend/app/api/v1/validation_reports.py (new router, register in main.py)
  - backend/tests/schemas/test_validation_report.py (new)
dependencies: [T1.1]
verification:
  - Pydantic schema validates sample report
  - API endpoints return 200 for valid input
  - Schema registered in artifact_types registry
```

### T1.7 — Implement Steering Rules Engine

```yaml
id: T1.7
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Create the F-504 Steering Rules Engine in
  backend/app/services/steering_rules.py with these requirements:

  Functionality:
  - Auto-discovers workspace Markdown files matching pattern: **/steering/*.md,
    **/.forge/steering.md, **/AGENTS.md, **/CLAUDE.md (configurable).
  - Parses each file as Markdown; extracts YAML front-matter (rule_id, scope,
    applies_to_stages[]).
  - Builds a typed SteeringRuleCatalog (Pydantic) at session start.
  - Re-injects on file change (file watcher via watchdog library — add to
    backend/requirements.txt if absent).
  - Provides inject_into_context(agent_state) -> dict[str, str] that returns
    rule markdown keyed by stage.

  Storage:
  - Per-engagement steering rule catalog persisted to Postgres (new table:
    steering_rules with tenant_id, project_id, file_path, content_hash, indexed_at).
  - RLS-enforced (DL-026).

  API:
  - GET /api/v1/steering-rules — list catalog for current project.
  - POST /api/v1/steering-rules — add rule file.
  - DELETE /api/v1/steering-rules/{rule_id} — remove.

  Integration:
  - Hook into existing F-017 Hook Orchestration (pre-plan, pre-code, pre-commit stages).
  - Steering rules injected as system_message fragment before agent invocation.

  Tests:
  - backend/tests/services/test_steering_rules.py — 5 tests:
    1. Auto-discovery finds files in test workspace.
    2. YAML front-matter parsing.
    3. File watcher triggers re-index.
    4. RLS isolation (tenant_a cannot see tenant_b rules).
    5. inject_into_context returns expected dict for each stage.

  Reference existing patterns:
  - backend/app/services/forge_commands.py (service pattern).
  - backend/app/db/rls.py (RLS pattern).
  - backend/app/api/v1/ (router pattern).

  Report back: files created, test count, watchdog dependency decision.
files_to_touch:
  - backend/app/services/steering_rules.py (new)
  - backend/app/api/v1/steering_rules.py (new router)
  - backend/app/db/models/steering_rule.py (new SQLAlchemy model)
  - backend/app/db/migrations/versions/XXXX_add_steering_rules.py (new Alembic)
  - backend/tests/services/test_steering_rules.py (new)
  - backend/requirements.txt (if watchdog added)
dependencies: [T1.2]
verification:
  - pytest backend/tests/services/test_steering_rules.py passes
  - Workspace Markdown auto-discovery works
  - RLS prevents cross-tenant access
  - File watcher re-injects on change
```

---

## Wave 1.3 — Merge Gate + UI (fire all in parallel; depends on T1.5, T1.7)

### T1.8 — Implement Deterministic Security Gate

```yaml
id: T1.8
subagent_type: oh-my-claudecode:executor
model: opus
run_in_background: false
prompt: |
  Create the F-503 Deterministic Security Gate in
  backend/app/services/merge_gate.py with these requirements:

  Functionality:
  - Service function: enforce_security_gate(commit_sha, project_id) -> GateDecision
  - Logic:
    1. Trigger F-501 Code Validator sub-graph (T1.5) on the diff.
    2. Read ValidationReport.decision (PASS/FAIL).
    3. If PASS → return GateDecision(allowed=True, report_id=X).
    4. If FAIL → return GateDecision(allowed=False, report_id=X, findings=Y).
  - LLM does NOT participate in the decision (NFR-042).
  - Pre-call admission: deny if LiteLLM cost projection exceeds per-commit cap.

  Webhook integration:
  - POST /api/v1/webhooks/github/pre-commit — invoked by GitHub pre-commit hook.
  - Returns 200 + allowed=true → GitHub allows push.
  - Returns 403 + allowed=false → GitHub blocks push.
  - Audit row written to F-005 regardless.

  Remediation routing:
  - On FAIL, auto-create a Jira ticket (via F-007 Jira MCP) with:
    - Title: "Security gate failure on {commit_sha}"
    - Body: ValidationReport JSON + remediation suggestions.
    - Assignee: commit author.

  Tests:
  - backend/tests/services/test_merge_gate.py — 6 tests:
    1. PASS decision allows commit.
    2. FAIL decision blocks commit.
    3. LLM is NOT called in the gate decision (mock + assert).
    4. Audit row created on both PASS and FAIL.
    5. Remediation ticket created on FAIL (mock Jira MCP).
    6. Pre-call admission blocks when cost cap exceeded.

  Reference existing patterns:
  - backend/app/agents/approval_gate.py (gate pattern).
  - backend/app/services/audit_service.py (audit pattern).
  - backend/app/services/litellm_client.py (cost projection).

  Report back: files created, test count, webhook integration tested.
files_to_touch:
  - backend/app/services/merge_gate.py (new)
  - backend/app/api/v1/webhooks.py (add /github/pre-commit endpoint)
  - backend/app/services/remediation_router.py (new — Jira auto-ticket)
  - backend/tests/services/test_merge_gate.py (new)
dependencies: [T1.5, T1.7]
verification:
  - pytest backend/tests/services/test_merge_gate.py passes
  - Gate decision is rules-based (no LLM call in decision path)
  - Webhook integration tested with mock GitHub payload
  - Audit row created on every gate invocation
```

### T1.9 — Code Validator UI page

```yaml
id: T1.9
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Create the Code Validator UI surface in apps/forge/ with these requirements:

  Routes:
  - apps/forge/app/validator/page.tsx — list view of recent ValidationReports per project.
  - apps/forge/app/validator/[report_id]/page.tsx — detail view with findings table.
  - apps/forge/app/validator/live/page.tsx — live tail of running scans.

  Components:
  - apps/forge/components/validator/ValidationReportCard.tsx — PASS/FAIL banner + summary.
  - apps/forge/components/validator/FindingsTable.tsx — severity-sorted, file-path-grouped.
  - apps/forge/components/validator/SeverityBadge.tsx — colored badge (critical=red, high=orange, medium=yellow, low=blue).
  - apps/forge/components/validator/RemediationPanel.tsx — suggested fixes per finding.

  API integration:
  - Use apps/forge/lib/api.ts (existing typed client) — add new methods:
    - listValidationReports(projectId)
    - getValidationReport(reportId)
  - TanStack Query hooks under apps/forge/lib/hooks/useValidationReports.ts.

  Tests (Playwright):
  - apps/forge/tests/validator/page.test.tsx — page renders, PASS/FAIL visible.
  - apps/forge/tests/validator/[report_id]/page.test.tsx — findings table sortable by severity.

  Reference existing patterns:
  - apps/forge/app/connector-center/ (existing detail page pattern).
  - apps/forge/components/ConnectorCard.tsx (card pattern).
  - apps/forge/lib/api.ts (API client pattern).

  DO NOT:
  - Modify the SDLC Agent UI.
  - Touch backend code.

  Report back: routes created, components count, tests pass.
files_to_touch:
  - apps/forge/app/validator/page.tsx (new)
  - apps/forge/app/validator/[report_id]/page.tsx (new)
  - apps/forge/app/validator/live/page.tsx (new)
  - apps/forge/components/validator/ValidationReportCard.tsx (new)
  - apps/forge/components/validator/FindingsTable.tsx (new)
  - apps/forge/components/validator/SeverityBadge.tsx (new)
  - apps/forge/components/validator/RemediationPanel.tsx (new)
  - apps/forge/lib/api.ts (add validation report methods)
  - apps/forge/lib/hooks/useValidationReports.ts (new)
  - apps/forge/tests/validator/page.test.tsx (new)
  - apps/forge/tests/validator/[report_id]/page.test.tsx (new)
dependencies: [T1.5, T1.6]
verification:
  - Routes build without TypeScript errors
  - PASS/FAIL banner renders correctly
  - Findings table sortable by severity
  - Tests pass
```

---

## Wave 1.4 — Constitutional verification + build (fire both in parallel)

### T1.10 — Constitutional R1–R8 verifier

```yaml
id: T1.10
subagent_type: oh-my-claudecode:verifier
model: opus
run_in_background: false
prompt: |
  Verify that all Phase 1 amendments do NOT weaken any of R1–R8 from
  /home/arunachalam.v@knackforge.com/forge-ai/.claude/CLAUDE.md.

  Specifically check:

  R1 (Model-provider agnosticism):
  - backend/app/agents/code_validator.py must use LiteLLM (not direct provider SDK).
  - All new code paths go through services/litellm_client.py.

  R2 (Multi-tenancy by default):
  - All new tables (steering_rules) have tenant_id + project_id columns.
  - RLS policies defined (DL-026 pattern).

  R3 (Mandatory human approval gates):
  - F-503 (deterministic gate) is ADDITIVE before human gate, NOT replacement.
  - Verify: code_validator returns PASS/FAIL; final human approval still required.

  R4 (Typed artifacts only):
  - F-501 produces ValidationReport (typed).
  - F-503 produces GateDecision (typed).
  - No free-form data.

  R5 (Layer isolation):
  - Steering Rules Engine respects tenant boundary.
  - Code Validator does not leak cross-tenant findings.

  R6 (Mandatory auditability):
  - Every gate decision writes F-005 audit row.
  - Every validation run writes F-005 audit row.

  R7 (Mandatory observability):
  - Structured logs with trace_id for all new code paths.
  - OpenTelemetry spans for validator sub-graph.

  R8 (Configurable everything):
  - No hard-coded agent identity in code_validator.
  - Per-engagement rule_id allowlist via Steering Rules Engine.

  Steps:
  1. Read .claude/CLAUDE.md Rules 1-8.
  2. Read each new file from Wave 1.2 and 1.3.
  3. For each rule, produce a verdict: PASS / FAIL / N/A.
  4. List any violations with file_path:line_number.

  Report back: 8 verdicts, any violations with line refs, overall PASS/FAIL.
files_to_touch: []
dependencies: [T1.5, T1.6, T1.7, T1.8, T1.9]
verification:
  - 8 verdicts produced (one per rule)
  - All rules PASS
  - Any FAILs must be remediated before Phase 2
```

### T1.11 — Build + typecheck

```yaml
id: T1.11
subagent_type: oh-my-claudecode:executor
model: haiku
run_in_background: true
prompt: |
  Run the full build and typecheck for both backend and frontend:

  Backend:
  - cd backend && python -m pytest tests/agents/test_code_validator.py
    tests/services/test_steering_rules.py tests/services/test_merge_gate.py
    tests/schemas/test_validation_report.py -v
  - cd backend && python -m mypy app/

  Frontend:
  - cd apps/forge && pnpm install
  - cd apps/forge && pnpm typecheck
  - cd apps/forge && pnpm test validator/

  Aggregate results. If any fail, report exact error. If all pass, report success.

  DO NOT modify any code.
files_to_touch: []
dependencies: [T1.5, T1.6, T1.7, T1.8, T1.9]
verification:
  - All pytest suites pass
  - mypy returns 0 errors
  - pnpm typecheck passes
  - pnpm test validator/ passes
```

---

# PHASE 2 — MCP Coverage: Tier 2 amendments + new MCP servers

**Goal:** Close MCP coverage gaps (ClickUp / Adobe XD / Kiro) and lock the per-stage tool-bundle posture rule in PRD and code.

**Acceptance criteria:**
- F-508, F-509, F-510 rows added to PRD §5.1a / §5.1b.
- NFR-046, F-505 added.
- DL-029 added.
- `mcp-servers/adobe-xd/` scaffold exists.
- `mcp-servers/kiro/` scaffold exists.
- Per-stage tool-bundle guardrails enforced at agent runtime.
- Connector Center UI shows new adapters.

---

## Wave 2.1 — PRD Tier 2 edits (fire all in parallel)

### T2.1 — Insert F-508 / F-509 / F-510

```yaml
id: T2.1
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Insert three new FR rows into
  docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md:

  - F-508 (ClickUp MCP Adapter): in §5.1a AFTER F-007 row.
  - F-509 (Adobe XD MCP Adapter): in §5.1a AFTER F-508 row.
  - F-510 (Kiro MCP Adapter): in §5.1b AFTER F-011 row.

  Use the EXACT insertion text from pillar1-prd-amendments.md under headings
  "### F-508 ClickUp MCP Adapter", "### F-509 Adobe XD MCP Adapter",
  "### F-510 Kiro MCP Adapter".

  Steps:
  1. Read all three blocks from pillar1-prd-amendments.md.
  2. Three Edit calls — one per FR.
  3. Verify ordering: F-007 → F-508 → F-509 → (section break) → F-011 → F-510.
  4. Run: grep -nE 'F-(007|508|509|011|510)' prd.md — confirm.

  Report back: line numbers of each new FR, ordering confirmed.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - F-508, F-509 in §5.1a; F-510 in §5.1b
  - Persona columns populated
  - Depends columns populated
```

### T2.2 — Insert NFR-046 + F-505

```yaml
id: T2.2
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Insert two rows into
  docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md:

  - NFR-046 (Per-stage tool isolation): in §6.8 AFTER NFR-043 row.
  - F-505 (Per-Stage Tool Bundle Guardrails): in §5.4a (new section from T1.1) AFTER F-503 row.

  Use the EXACT insertion text from pillar1-prd-amendments.md under headings
  "### NFR-046 Per-stage tool isolation" and "### F-505 Per-Stage Tool Bundle Guardrails".

  Steps:
  1. Read both blocks from pillar1-prd-amendments.md.
  2. Two Edit calls.
  3. Update §5.4a section header from "F-501..F-503" to "F-501..F-505".
  4. Verify NFR-046 in §6.8.

  Report back: line numbers, section header updated.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - F-505 in §5.4a, NFR-046 in §6.8
  - Section header updated to "F-501..F-505"
```

### T2.3 — Insert DL-029

```yaml
id: T2.3
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Insert DL-029 (Refactor Agent leverages cloud-provider tooling) as a new row in §2
  Decision Log of docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
  AFTER the DL-027 row (line ~142) and BEFORE DL-031 (inserted by T1.4).

  Use the EXACT insertion text from pillar1-prd-amendments.md under heading
  "### DL-029 Refactor Agent leverages cloud-provider tooling".

  Steps:
  1. Read DL-029 block from pillar1-prd-amendments.md.
  2. Edit tool to insert after DL-027 and before DL-031.
  3. Verify final ordering: DL-027 → DL-029 → DL-031.

  Report back: line number of DL-029, ordering confirmed.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - DL ordering: 027, 029, 031
  - Locked by column says "Pillar 1 Deep-Dive §6"
```

---

## Wave 2.2 — MCP implementations + tool-bundle guardrails (fire all in parallel; depends on T2.1, T2.2, T2.3)

### T2.4 — Adobe XD MCP server scaffold

```yaml
id: T2.4
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Create the Adobe XD MCP server scaffold at mcp-servers/adobe-xd/ matching the
  existing mcp-servers/figma/ structure.

  Required files (mirror figma/ layout):
  - mcp-servers/adobe-xd/package.json (name: @forge-ai/mcp-adobe-xd)
  - mcp-servers/adobe-xd/tsconfig.json
  - mcp-servers/adobe-xd/bin/adobe-xd-mcp (executable)
  - mcp-servers/adobe-xd/src/index.ts (MCP server entry)
  - mcp-servers/adobe-xd/src/client.ts (Adobe XD API client)
  - mcp-servers/adobe-xd/src/config.ts (config + auth)
  - mcp-servers/adobe-xd/src/tools.ts (tool definitions)
  - mcp-servers/adobe-xd/docs/README.md
  - mcp-servers/adobe-xd/test/integration.test.ts

  Tools to implement:
  - get_asset(asset_id) — fetch design asset by ID.
  - list_components(file_id) — list components in XD file.
  - export_spec(file_id, format) — export design spec (JSON).
  - get_design_tokens(file_id) — extract design tokens (colors, type, spacing).

  Auth:
  - OAuth2 via Adobe IMS (per F-016 connector contract).

  Tests:
  - 4 unit tests + 2 integration tests (mocked).

  Reference:
  - mcp-servers/figma/ (exact layout — copy and adapt).
  - mcp-servers/figma/src/tools.ts (tool definition pattern).

  Report back: files created, package name, test count.
files_to_touch:
  - mcp-servers/adobe-xd/ (new directory + files)
dependencies: [T2.1]
verification:
  - pnpm install in mcp-servers/adobe-xd/ succeeds
  - pnpm test passes
  - Tools list matches F-509 spec
```

### T2.5 — Kiro MCP server scaffold

```yaml
id: T2.5
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Create the Kiro MCP server scaffold at mcp-servers/kiro/ matching the existing
  mcp-servers/figma/ structure.

  Required files (mirror figma/ layout):
  - mcp-servers/kiro/package.json (name: @forge-ai/mcp-kiro)
  - mcp-servers/kiro/tsconfig.json
  - mcp-servers/kiro/bin/kiro-mcp (executable)
  - mcp-servers/kiro/src/index.ts (MCP server entry)
  - mcp-servers/kiro/src/client.ts (Kiro IDE state client)
  - mcp-servers/kiro/src/config.ts (config + auth)
  - mcp-servers/kiro/src/tools.ts (tool definitions)
  - mcp-servers/kiro/docs/README.md
  - mcp-servers/kiro/test/integration.test.ts

  Tools to implement (per F-510):
  - get_open_files() — list files currently open in Kiro IDE.
  - get_current_selection() — file path + line range of current selection.
  - get_active_task_queue() — pending/running tasks in Kiro task system.
  - get_agent_run_history(limit) — recent agent runs (last N).

  Auth:
  - Kiro daemon socket or REST API (per Kiro MCP specification).

  Tests:
  - 4 unit tests + 2 integration tests (mocked daemon).

  Reference:
  - mcp-servers/figma/ (layout pattern).

  Report back: files created, package name, test count.
files_to_touch:
  - mcp-servers/kiro/ (new directory + files)
dependencies: [T2.1]
verification:
  - pnpm install in mcp-servers/kiro/ succeeds
  - pnpm test passes
  - Tools list matches F-510 spec
```

### T2.6 — Per-stage tool-bundle guardrails

```yaml
id: T2.6
subagent_type: oh-my-claudecode:executor
model: opus
run_in_background: false
prompt: |
  Implement F-505 Per-Stage Tool Bundle Guardrails in
  backend/app/services/tool_bundles.py with these requirements:

  Functionality:
  - ToolBundle TypedDict: stage (Literal["ideation","architecture","development","testing","security","deployment"]),
    permitted_tools: list[str], denied_tools: list[str], rationale.
  - ToolBundleRegistry service: load bundles from F-003 Governance Policy Engine.
  - enforce_bundle(agent_state, current_stage) -> Decision:
    - If agent attempts to invoke a tool NOT in permitted_tools → raise ToolBundleViolation.
    - Audit row written to F-005 with: agent_id, stage, attempted_tool, decision.
  - Hook into agent_runtime (backend/app/services/agent_runtime.py) at tool-invocation boundary.

  Default bundles (ship in service):
  - ideation: permitted=[idea_intake, opportunity_scoring, push_to_delivery], denied=[code_write, deploy, security_scan]
  - architecture: permitted=[adr_generator, api_contract_generator], denied=[code_write, deploy]
  - development: permitted=[code_write, code_review], denied=[deploy, security_scan]
  - testing: permitted=[test_runner, test_generator], denied=[code_write, deploy]
  - security: permitted=[security_scan, validator], denied=[deploy, code_write]
  - deployment: permitted=[deploy, iac_apply], denied=[code_write]

  API:
  - GET /api/v1/tool-bundles — list all bundles.
  - PUT /api/v1/tool-bundles/{stage} — Steward override (audit row created).

  Tests:
  - backend/tests/services/test_tool_bundles.py — 6 tests:
    1. Default bundles ship with all 6 stages.
    2. Cross-stage tool invocation raises ToolBundleViolation.
    3. Audit row created on violation.
    4. Steward override updates registry.
    5. Override audited.
    6. Integration: agent_runtime enforces bundle.

  Reference:
  - backend/app/services/agent_runtime.py (hook point).
  - backend/app/services/policy_engine.py (declarative policy pattern).
  - backend/app/services/audit_service.py.

  Report back: files, test count, hook integration verified.
files_to_touch:
  - backend/app/services/tool_bundles.py (new)
  - backend/app/services/agent_runtime.py (add bundle enforcement)
  - backend/app/api/v1/tool_bundles.py (new router)
  - backend/tests/services/test_tool_bundles.py (new)
dependencies: [T2.2]
verification:
  - pytest passes
  - ToolBundleViolation raised on cross-stage invocation
  - Audit row created on every enforcement
```

### T2.7 — Connector Center UI for new MCPs

```yaml
id: T2.7
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Update the existing Connector Center UI to show the 3 new MCP adapters
  (ClickUp, Adobe XD, Kiro).

  Changes:
  - apps/forge/lib/mcp-registry.ts — add entries for: mcp-adobe-xd, mcp-kiro,
    verify mcp-clickup entry exists (per explore finding).
  - apps/forge/app/connector-center/page.tsx — new MCPs appear in list automatically
    (verify the registry-driven render works).
  - apps/forge/components/ConnectorCard.tsx — show Adobe XD / Kiro / ClickUp icons.
  - apps/forge/lib/connectors/audit-feed-types.ts — add new MCP event types.

  Tests (Playwright):
  - apps/forge/tests/connector-card.test.tsx (existing) — extend to cover new MCPs.

  Reference:
  - apps/forge/lib/mcp-registry.ts (existing pattern).

  Report back: list updated, tests pass.
files_to_touch:
  - apps/forge/lib/mcp-registry.ts
  - apps/forge/app/connector-center/page.tsx
  - apps/forge/components/ConnectorCard.tsx
  - apps/forge/lib/connectors/audit-feed-types.ts
  - apps/forge/tests/connector-card.test.tsx
dependencies: [T2.4, T2.5]
verification:
  - 3 new MCPs visible in Connector Center
  - Icons render correctly
  - Tests pass
```

---

# PHASE 3 — Modernization Path: Tier 3 amendments + Refactor Agent

**Goal:** Promote the Refactor Agent from out-of-V1 to Phase 4 in-scope. Lock fixed-budget and day-one-bootstrap posture rules.

**Acceptance criteria:**
- New §5.7 inserted in PRD with F-601.
- "Phase 6 — Modernization / Refactor Accelerator" removed from §5.6.
- NFR-044, NFR-045, F-507 added.
- `backend/app/agents/refactor_agent.py` exists as separate sub-graph.
- AWS Transform orchestration hook implemented.
- Fixed-budget LLM enforcement active.
- Day-one bootstrap loader active.

---

## Wave 3.1 — PRD Tier 3 edits (fire both in parallel)

### T3.1 — Insert §5.7 + remove from §5.6

```yaml
id: T3.1
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Two edits to docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md:

  EDIT 1 (insert new section):
  Insert new §5.7 "Phase 4 — Modernization / Refactor Accelerator (F-601)" AFTER §5.5
  (line ~402) and BEFORE §5.6 (line ~406).

  Use the EXACT insertion text from pillar1-prd-amendments.md under heading
  "### F-601 Refactor Agent (Modernization Path)" — insert the entire new section
  including the "### 5.7 Phase 4 — Modernization / Refactor Accelerator (F-601)"
  heading and table.

  EDIT 2 (remove from out-of-V1 list):
  Remove the line "**Phase 6 — Modernization / Refactor Accelerator:** Legacy
  migration plans, target architecture." from §5.6 (line ~410).

  Steps:
  1. Read F-601 block from pillar1-prd-amendments.md.
  2. Edit 1: insert new §5.7 section.
  3. Edit 2: remove Phase 6 bullet from §5.6.
  4. Verify: grep -nE 'Phase [4-7] —' prd.md shows Phases 4 (in new §5.7), 5, 7
    but NOT 6.
  5. Verify §5.6 closing line still makes sense (it says "Foundation + Phase 0 +
    Phase 1 + Phase 2 + Phase 3 constitute...") — note this may need to mention
    Phase 4, but defer that decision to leadership. Leave closing line as-is.

  Report back: new §5.7 line number, §5.6 Phase 6 bullet removed, Phase 6 grep shows 0 hits.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - §5.7 exists with F-601
  - "Phase 6" string absent from §5.6 (or 0 grep hits in §5.6 context)
  - §5.6 still has Phases 5 and 7
```

### T3.2 — Insert NFR-044 + NFR-045 + F-507

```yaml
id: T3.2
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Insert three new rows into docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md:

  - NFR-044 (Fixed-budget workflow execution): in §6.8 AFTER NFR-030 row.
  - NFR-045 (Day-one reference standards): in §6.7 AFTER NFR-026 row.
  - F-507 (Day-One Bootstrap with Reference Standards): in §5.1c AFTER F-021 row.

  Use the EXACT insertion text from pillar1-prd-amendments.md under headings
  "### NFR-044 Fixed-budget workflow execution", "### NFR-045 Day-one reference
  standards", and "### F-507 Day-One Bootstrap with Reference Standards".

  Steps:
  1. Read all three blocks from pillar1-prd-amendments.md.
  2. Three Edit calls.
  3. Verify monotonic NFR ordering in each section.
  4. Run: grep -nE 'NFR-(030|043|044|026|045)' prd.md — confirm ordering.

  Report back: line numbers, ordering confirmed.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: []
verification:
  - NFR-044 in §6.8, NFR-045 in §6.7, F-507 in §5.1c
  - Cross-references to NFR-030, F-021, F-001 preserved
```

---

## Wave 3.2 — Refactor Agent + cost/bootstrap (fire all in parallel; depends on T3.1, T3.2)

### T3.3 — Implement Refactor Agent sub-graph

```yaml
id: T3.3
subagent_type: oh-my-claudecode:executor
model: opus
run_in_background: false
prompt: |
  Implement F-601 Refactor Agent as a separate LangGraph sub-graph in
  backend/app/agents/refactor_agent.py with these requirements:

  Architecture:
  - File: backend/app/agents/refactor_agent.py
  - Sub-graph StateGraph with own RefactorAgentState TypedDict.
  - Nodes: inventory_source, plan_target, generate_phases, risk_register, push_to_jira.
  - Entry: inventory_source. Linear flow to push_to_jira.

  AWS Transform orchestration:
  - Backend integration: backend/app/services/aws_transform_client.py (new).
    Wraps AWS Transform SDK (boto3 + transform service).
  - Refactor Agent invokes aws_transform_client.start_job(source_inventory) which
    returns job_id; polls until done; pulls results.
  - Forge does NOT reimplement source-to-target translation (DL-029).

  Phased migration plan:
  - Typed artifact (Pydantic) MigrationPlan with: source_inventory, target_architecture,
    phased_plan: list[MigrationPhase], risk_register, effort_estimate, dependencies.
  - Stored via F-010 artifact registry.
  - On approval, push_to_jira node invokes F-213 Push to Delivery.

  Prompt:
  - Separate prompt template: backend/app/agents/prompts/refactor_agent.j2.

  Tests:
  - backend/tests/agents/test_refactor_agent.py — 5 tests:
    1. Sub-graph compiles.
    2. inventory_source produces typed inventory.
    3. AWS Transform integration (mocked boto3).
    4. MigrationPlan schema validation.
    5. push_to_jira calls F-213.

  Reference:
  - backend/app/agents/sdlc_agent.py (LangGraph style).
  - backend/app/services/ideation/ (typed-artifact pattern).
  - backend/app/agents/code_validator.py (Phase 1 — same independent-sub-graph pattern).

  DO NOT:
  - Reimplement source-to-target translation.
  - Block on AWS Transform availability (graceful degradation).

  Report back: files created, AWS Transform client tested, plan generation works.
files_to_touch:
  - backend/app/agents/refactor_agent.py (new)
  - backend/app/agents/refactor_agent_state.py (new)
  - backend/app/agents/prompts/refactor_agent.j2 (new)
  - backend/app/services/aws_transform_client.py (new)
  - backend/app/schemas/migration_plan.py (new)
  - backend/tests/agents/test_refactor_agent.py (new)
dependencies: [T3.1]
verification:
  - Sub-graph compiles
  - AWS Transform client (mocked) round-trips
  - MigrationPlan schema validates
  - push_to_jira calls F-213 (mocked)
```

### T3.4 — Implement fixed-budget LLM enforcement

```yaml
id: T3.4
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Implement NFR-044 Fixed-budget workflow execution in
  backend/app/services/workflow_budget.py with these requirements:

  Functionality:
  - WorkflowBudget TypedDict: workflow_id, ceiling_usd, spent_usd, status.
  - declare_budget(workflow_id, ceiling_usd) — creates budget, persists.
  - check_budget(workflow_id, projected_cost_usd) -> Decision:
    - If spent + projected > ceiling → return BLOCKED.
    - Else → return ALLOWED, deduct projected from spent on completion.
  - surface_at_gate(workflow_id) — exposes budget state at every approval gate (NFR-032).

  Integration:
  - Hook into LiteLLM (NFR-030) via pre-call admission control.
  - Wire into existing F-006 Approval Engine — gate metadata includes budget state.

  API:
  - POST /api/v1/workflows/{workflow_id}/budget — declare budget.
  - GET /api/v1/workflows/{workflow_id}/budget — current state.
  - GET /api/v1/workflows/{workflow_id}/budget/history — audit trail of decisions.

  Tests:
  - backend/tests/services/test_workflow_budget.py — 5 tests:
    1. Declare budget persists.
    2. check_budget returns BLOCKED when exceeded.
    3. check_budget returns ALLOWED when under.
    4. Audit row on BLOCKED.
    5. Gate metadata includes budget state.

  Reference:
  - backend/app/services/litellm_client.py (cost tracking).
  - backend/app/services/audit_service.py.
  - backend/app/agents/approval_gate.py.

  Report back: files, test count, hook integration verified.
files_to_touch:
  - backend/app/services/workflow_budget.py (new)
  - backend/app/services/litellm_client.py (add budget check)
  - backend/app/agents/approval_gate.py (add budget state to gate metadata)
  - backend/app/api/v1/workflows.py (add budget endpoints)
  - backend/tests/services/test_workflow_budget.py (new)
dependencies: [T3.2]
verification:
  - pytest passes
  - BLOCKED decision triggers audit row
  - Gate metadata exposes budget state
```

### T3.5 — Implement Day-One Bootstrap loader

```yaml
id: T3.5
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Implement F-507 Day-One Bootstrap with Reference Standards in
  backend/app/services/day_one_bootstrap.py with these requirements:

  Functionality:
  - load_baseline(project_id) -> BootstrapResult:
    - Pulls KnackForge reference standards from F-001 baseline catalog.
    - Layers customer-specific overrides on top (per project metadata).
    - Returns typed BootstrapResult { standards: list[Standard], templates:
      list[Template], governance_policies: list[Policy], steering_rules:
      list[SteeringRule] }.
  - Idempotent: re-running does not duplicate references (per F-507 spec).
  - Bootstrap state captured in F-005 audit log.
  - Triggered by F-021 Project Onboarding Wizard at engagement start.

  Integration:
  - Hook into F-021 onboarding flow as final step.
  - Bootstrap completes before project is marked "active" in DB.

  API:
  - POST /api/v1/projects/{project_id}/bootstrap — trigger bootstrap.
  - GET /api/v1/projects/{project_id}/bootstrap/status — current state.
  - POST /api/v1/projects/{project_id}/bootstrap/rerun — idempotent rerun.

  Tests:
  - backend/tests/services/test_day_one_bootstrap.py — 5 tests:
    1. Baseline loads.
    2. Customer overlay applied correctly.
    3. Idempotent (rerun produces same state).
    4. Audit row created.
    5. Project not active until bootstrap completes.

  Reference:
  - backend/app/services/standards_library.py (F-001).
  - backend/app/services/project_onboarding/wizard.py (F-021).

  Report back: files, test count, idempotency verified.
files_to_touch:
  - backend/app/services/day_one_bootstrap.py (new)
  - backend/app/services/project_onboarding/wizard.py (call bootstrap on completion)
  - backend/app/api/v1/projects.py (add bootstrap endpoints)
  - backend/tests/services/test_day_one_bootstrap.py (new)
dependencies: [T3.2]
verification:
  - pytest passes
  - Idempotent rerun returns identical state
  - Bootstrap completes before project activation
```

---

## Wave 3.3 — Refactor Agent UI

### T3.6 — Refactor Agent UI

```yaml
id: T3.6
subagent_type: oh-my-claudecode:executor
model: sonnet
run_in_background: false
prompt: |
  Create the Refactor Agent UI surface in apps/forge/ with these requirements:

  Routes:
  - apps/forge/app/refactor/page.tsx — list of recent migration plans per project.
  - apps/forge/app/refactor/[plan_id]/page.tsx — plan detail with phased view.
  - apps/forge/app/refactor/new/page.tsx — wizard to trigger new migration analysis.

  Components:
  - apps/forge/components/refactor/MigrationPlanCard.tsx — phased plan summary.
  - apps/forge/components/refactor/PhaseTimeline.tsx — visual timeline of phases.
  - apps/forge/components/refactor/RiskRegister.tsx — risk table linked to phases.
  - apps/forge/components/refactor/EffortEstimate.tsx — effort badge per phase.
  - apps/forge/components/refactor/PushToJiraButton.tsx — invokes F-213.

  API integration:
  - apps/forge/lib/api.ts — add methods: listMigrationPlans(projectId),
    getMigrationPlan(planId), triggerRefactorAnalysis(source).
  - apps/forge/lib/hooks/useMigrationPlans.ts (TanStack Query hooks).

  Tests (Playwright):
  - apps/forge/tests/refactor/page.test.tsx — list renders.
  - apps/forge/tests/refactor/[plan_id]/page.test.tsx — phased view renders.

  Reference:
  - apps/forge/app/ideation/ (similar wizard pattern).
  - apps/forge/app/architecture/ (artifact detail pattern).

  Report back: routes, components, tests pass.
files_to_touch:
  - apps/forge/app/refactor/page.tsx (new)
  - apps/forge/app/refactor/[plan_id]/page.tsx (new)
  - apps/forge/app/refactor/new/page.tsx (new)
  - apps/forge/components/refactor/MigrationPlanCard.tsx (new)
  - apps/forge/components/refactor/PhaseTimeline.tsx (new)
  - apps/forge/components/refactor/RiskRegister.tsx (new)
  - apps/forge/components/refactor/EffortEstimate.tsx (new)
  - apps/forge/components/refactor/PushToJiraButton.tsx (new)
  - apps/forge/lib/api.ts (add methods)
  - apps/forge/lib/hooks/useMigrationPlans.ts (new)
  - apps/forge/tests/refactor/page.test.tsx (new)
  - apps/forge/tests/refactor/[plan_id]/page.test.tsx (new)
dependencies: [T3.3]
verification:
  - Routes build without TS errors
  - PhaseTimeline renders correctly
  - PushToJiraButton calls F-213 (mocked)
  - Tests pass
```

---

# PHASE 4 — Closure: Resolve OQs + alignment note

**Goal:** Resolve 3 open questions, create the Pillar 1 alignment note (Tier 5), run final coverage verification against Pillar 1 §12 production-ready criteria.

**Acceptance criteria:**
- OQ-016, OQ-017, OQ-018 added to PRD §7.2 (or moved to §7.1 if resolved).
- Pillar 1 alignment note created at docs/architecture/pillar1-alignment.md.
- All 8 Pillar 1 §12 production-ready criteria verified as covered.
- Final build green.

---

## Wave 4.1 — OQs + alignment note (fire all in parallel)

### T4.1 — Resolve OQ-016

```yaml
id: T4.1
subagent_type: oh-my-claudecode:planner
model: opus
run_in_background: false
prompt: |
  Add OQ-016 (V1 scope of 5-stage workflow) to §7.2 of
  docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md.

  Use the EXACT insertion text from pillar1-prd-amendments.md under heading
  "### OQ-016 V1 scope of 5-stage workflow".

  Note: This is currently UNRESOLVED — adding to §7.2 (Remaining Phase-Blockers).
  Resolution owner per Pillar 1 Deep-Dive §14: Engineering Excellence + Pillar 1
  Tech Lead.

  Steps:
  1. Read OQ-016 block from pillar1-prd-amendments.md.
  2. Insert in §7.2 AFTER OQ-011 row.
  3. Verify: grep -nE 'OQ-(011|016|017|018)' prd.md — confirm insertion.

  Report back: line number, recommendation noted in question body.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: [Phase 1 complete]
verification:
  - OQ-016 in §7.2
  - Owner column populated
  - Resolution path references Pillar 1 Deep-Dive §2/§7
```

### T4.2 — Resolve OQ-017

```yaml
id: T4.2
subagent_type: oh-my-claudecode:planner
model: opus
run_in_background: false
prompt: |
  Add OQ-017 (Refactor Agent first-target language and source) to §7.2 of
  docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md AFTER OQ-016.

  Use the EXACT insertion text from pillar1-prd-amendments.md under heading
  "### OQ-017 Refactor Agent first-target language and source".

  Steps:
  1. Read OQ-017 block from pillar1-prd-amendments.md.
  2. Insert after OQ-016.
  3. Verify ordering: OQ-016 → OQ-017.

  Report back: line number.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: [Phase 3 complete]
verification:
  - OQ-017 in §7.2 after OQ-016
```

### T4.3 — Resolve OQ-018

```yaml
id: T4.3
subagent_type: oh-my-claudecode:planner
model: sonnet
run_in_background: false
prompt: |
  Add OQ-018 (ClickUp / Adobe XD / Kiro MCP priority) to §7.2 of
  docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md AFTER OQ-017.

  Use the EXACT insertion text from pillar1-prd-amendments.md under heading
  "### OQ-018 ClickUp / Adobe XD / Kiro MCP priority".

  Note: Phase 2 (T2.4, T2.5) has already scaffolded Adobe XD and Kiro MCPs —
  this OQ reflects the gap that existed at gap-analysis time and acknowledges
  the resolution path is now in motion.

  Steps:
  1. Read OQ-018 block from pillar1-prd-amendments.md.
  2. Insert after OQ-017.
  3. Verify ordering: OQ-016 → OQ-017 → OQ-018.

  Report back: line number.
files_to_touch:
  - docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md
dependencies: [Phase 2 complete]
verification:
  - OQ-018 in §7.2 after OQ-017
  - Resolution path references Phase 2 work
```

### T4.4 — Create Pillar 1 alignment note (Tier 5)

```yaml
id: T4.4
subagent_type: oh-my-claudecode:writer
model: sonnet
run_in_background: false
prompt: |
  Create docs/architecture/pillar1-alignment.md with the EXACT content from
  pillar1-prd-amendments.md under heading "## Tier 5 — Pillar 1 Alignment Note
  (no PRD change)" → "### New file: docs/architecture/pillar1-alignment.md" →
  "Insertion text (entire new file):".

  Steps:
  1. Read the alignment note block from pillar1-prd-amendments.md.
  2. Write the new file with that exact content.
  3. Verify file created with correct content.

  Report back: file path, byte size, content matches draft.
files_to_touch:
  - docs/architecture/pillar1-alignment.md (new)
dependencies: []
verification:
  - File exists
  - Content matches draft
  - Cross-references to gap-analysis and amendments files preserved
```

---

## Wave 4.2 — Final verification

### T4.5 — Pillar 1 §12 production-ready verifier

```yaml
id: T4.5
subagent_type: oh-my-claudecode:verifier
model: opus
run_in_background: false
prompt: |
  Run final coverage verification against Pillar 1 §12 (Production-Ready Criteria).

  For each of the 8 Pillar 1 §12 bullets, verify coverage:

  1. 5-stage workflow runs end-to-end for at least one customer engagement scope
     → Coverage: partial (V1 covers 3-of-5). OQ-016 documents the gap.

  2. Forge Ideation Agent produces sprint-ready output validated against real
     customer backlog
     → Coverage: F-201..F-213 + F-209.

  3. Code Validator Agent is independent of development agent
     → Coverage: F-501 (PRD) + backend/app/agents/code_validator.py (code).

  4. MCP orchestration covers priority integration set (Pillar 1 §8)
     → Coverage: F-007 (existing) + F-508/F-509/F-510 (added).

  5. Steering rules are Markdown-file-based, customer-portable
     → Coverage: F-504 (PRD) + backend/app/services/steering_rules.py (code).

  6. Audit trail captures every stage transition
     → Coverage: NFR-020 + F-005 + F-407 + ADR-008.

  7. Fixed-budget LLM operation enforced end-to-end
     → Coverage: NFR-044 (PRD) + backend/app/services/workflow_budget.py (code).

  8. Day-one bootstrap with reference standards
     → Coverage: NFR-045 + F-507 (PRD) + backend/app/services/day_one_bootstrap.py (code).

  Steps:
  1. For each bullet, run grep to verify PRD and code coverage.
  2. Produce a verdict: COVERED / PARTIAL / GAP.
  3. List any remaining gaps.

  Report back: 8 verdicts, gap list (if any), overall PASS/FAIL.
files_to_touch: []
dependencies: [T4.1, T4.2, T4.3, T4.4, all prior phases]
verification:
  - 8 verdicts produced
  - At least 6 of 8 COVERED
  - Remaining gaps documented
```

### T4.6 — Final build + typecheck

```yaml
id: T4.6
subagent_type: oh-my-claudecode:executor
model: haiku
run_in_background: true
prompt: |
  Run the full build and typecheck for the entire monorepo:

  Backend:
  - cd backend && python -m pytest tests/ -v
  - cd backend && python -m mypy app/

  Frontend:
  - cd apps/forge && pnpm install
  - cd apps/forge && pnpm typecheck
  - cd apps/forge && pnpm test

  MCP servers:
  - for mcp in adobe-xd kiro; do
      (cd mcp-servers/$mcp && pnpm install && pnpm test)
    done

  Aggregate results. Report exact errors if any fail.

  DO NOT modify any code.
files_to_touch: []
dependencies: [all prior phases]
verification:
  - All pytest suites pass
  - mypy returns 0 errors
  - pnpm typecheck passes
  - pnpm test passes
  - All new MCP server tests pass
```

---

## Routing Summary

| Wave | Tasks | Models | Parallel? |
|---|---|---|---|
| 1.1 | T1.1, T1.2, T1.3, T1.4 | sonnet × 4 | ✅ All parallel |
| 1.2 | T1.5, T1.6, T1.7 | opus × 1, sonnet × 2 | ✅ All parallel |
| 1.3 | T1.8, T1.9 | opus × 1, sonnet × 1 | ✅ All parallel |
| 1.4 | T1.10, T1.11 | opus, haiku | ✅ Parallel |
| 2.1 | T2.1, T2.2, T2.3 | sonnet × 3 | ✅ All parallel |
| 2.2 | T2.4, T2.5, T2.6, T2.7 | sonnet × 3, opus × 1 | ✅ All parallel |
| 3.1 | T3.1, T3.2 | sonnet × 2 | ✅ Parallel |
| 3.2 | T3.3, T3.4, T3.5 | opus × 1, sonnet × 2 | ✅ All parallel |
| 3.3 | T3.6 | sonnet | Single |
| 4.1 | T4.1, T4.2, T4.3, T4.4 | opus × 2, sonnet × 2 | ✅ All parallel |
| 4.2 | T4.5, T4.6 | opus, haiku | ✅ Parallel |

**Max parallel agents in any wave: 5** (Wave 1.1 has 4 + Wave 2.1 has 3 + Wave 2.2 has 4 — but Wave 2.2 depends on Wave 2.1, so max simultaneous = 4 from Wave 2.2 once Wave 2.1 finishes).

---

## Total Workload

| Phase | Tasks | Backend files | Frontend files | MCP servers | Tests |
|---|---|---|---|---|---|
| 1 | 11 | 14 new | 11 new | — | 22 new |
| 2 | 7 | 3 new | 5 modified | 2 new (adobe-xd, kiro) | 12 new |
| 3 | 6 | 9 new | 12 new | — | 17 new |
| 4 | 6 | — | — | — | — |
| **Total** | **30 tasks** | **26 new** | **28 new** | **2 new** | **51 new tests** |

---

## Verification Gates

| Gate | Trigger | Check |
|---|---|---|
| Per-task | Each agent finishes | Self-reported verification + file existence |
| Per-wave | All tasks in wave complete | Wave-specific check (e.g., grep for IDs) |
| Per-phase | All waves in phase complete | Build + tests + R1–R8 (Phase 1) |
| Final | All phases complete | Pillar 1 §12 production-ready + full build green |

---

## How to Run

**Option A — Paste into Claude Code multi-agent (recommended):**

```
Run the multi-agent execution plan at /home/arunachalam.v@knackforge.com/forge-ai/docs/architecture/pillar1-execution-plan.md.

Use ultrawork mode. Fire each wave's tasks in parallel as specified.
Run models: sonnet for standard, opus for architecture-heavy (T1.5, T1.8, T2.6, T3.3, T4.1, T4.2, T4.5), haiku for build verification (T1.11, T4.6).
After each wave, run the wave's verification grep before starting the next wave.
After Phase 1, run T1.10 (constitutional verifier) before starting Phase 3.
After Phase 4, run T4.5 (final §12 check) and T4.6 (full build) before declaring complete.
```

**Option B — Sequential agent dispatch (safer for first run):**

Run tasks one at a time in the order listed (T1.1 → T1.2 → ... → T4.6). Useful when the orchestrator does not have ultrawork enabled or when the user wants to inspect each step.

**Option C — Phase-by-phase (medium):**

Run each phase to completion before starting the next. Phases 1 and 2 can be issued as parallel team-mode sessions.

---

## Risk Flags

- **T1.5 (Code Validator)** is the highest-complexity single task. Opus model recommended. If blocked, fallback to splitting into separate scan_secrets + scan_iac tasks.
- **T1.8 (Merge Gate)** integration with GitHub webhook requires GitHub App credentials. If unavailable, scaffold with mock webhook handler and document the credential requirement.
- **T3.3 (Refactor Agent)** AWS Transform requires AWS credentials. Mock the boto3 client; document the credential requirement for production.
- **T2.4, T2.5 (MCP servers)** — Adobe XD and Kiro MCPs may have evolving API specs. Scaffold with current assumptions; flag for review when official specs land.
- **T1.11, T4.6 (Builds)** — use `run_in_background: true` since these can take >30 seconds.

---

## File Map (after all phases complete)

```
docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md          # 18 new rows
docs/architecture/pillar1-gap-analysis.md                            # existing (read-only)
docs/architecture/pillar1-prd-amendments.md                         # existing (read-only)
docs/architecture/pillar1-alignment.md                              # NEW (Tier 5)
docs/architecture/pillar1-execution-plan.md                         # this file

backend/app/agents/code_validator.py                                # NEW
backend/app/agents/code_validator_state.py                          # NEW
backend/app/agents/code_validator_nodes/*.py                        # NEW (5 files)
backend/app/agents/prompts/code_validator.j2                        # NEW
backend/app/agents/refactor_agent.py                                # NEW
backend/app/agents/refactor_agent_state.py                          # NEW
backend/app/agents/prompts/refactor_agent.j2                        # NEW
backend/app/services/steering_rules.py                              # NEW
backend/app/services/merge_gate.py                                  # NEW
backend/app/services/tool_bundles.py                                 # NEW
backend/app/services/workflow_budget.py                             # NEW
backend/app/services/day_one_bootstrap.py                           # NEW
backend/app/services/aws_transform_client.py                        # NEW
backend/app/services/remediation_router.py                          # NEW
backend/app/services/agent_runtime.py                               # MODIFIED (bundle hook)
backend/app/services/litellm_client.py                              # MODIFIED (budget check)
backend/app/services/project_onboarding/wizard.py                   # MODIFIED (bootstrap call)
backend/app/agents/approval_gate.py                                 # MODIFIED (budget metadata)
backend/app/schemas/validation_report.py                            # NEW
backend/app/schemas/migration_plan.py                               # NEW
backend/app/api/v1/validation_reports.py                            # NEW
backend/app/api/v1/steering_rules.py                                # NEW
backend/app/api/v1/tool_bundles.py                                  # NEW
backend/app/api/v1/workflows.py                                     # MODIFIED (budget endpoints)
backend/app/api/v1/projects.py                                      # MODIFIED (bootstrap endpoints)
backend/app/api/v1/webhooks.py                                      # MODIFIED (pre-commit endpoint)
backend/app/api/v1/main.py                                          # MODIFIED (register routers)
backend/app/db/models/steering_rule.py                              # NEW
backend/app/db/migrations/versions/XXXX_add_steering_rules.py       # NEW

apps/forge/app/validator/page.tsx                                   # NEW
apps/forge/app/validator/[report_id]/page.tsx                       # NEW
apps/forge/app/validator/live/page.tsx                              # NEW
apps/forge/app/refactor/page.tsx                                    # NEW
apps/forge/app/refactor/[plan_id]/page.tsx                          # NEW
apps/forge/app/refactor/new/page.tsx                                # NEW
apps/forge/components/validator/*.tsx                              # NEW (4 files)
apps/forge/components/refactor/*.tsx                               # NEW (5 files)
apps/forge/lib/api.ts                                               # MODIFIED (new methods)
apps/forge/lib/hooks/useValidationReports.ts                        # NEW
apps/forge/lib/hooks/useMigrationPlans.ts                           # NEW
apps/forge/lib/mcp-registry.ts                                      # MODIFIED (3 new MCPs)
apps/forge/lib/connectors/audit-feed-types.ts                       # MODIFIED (new event types)
apps/forge/tests/validator/*.test.tsx                               # NEW (2 files)
apps/forge/tests/refactor/*.test.tsx                                # NEW (2 files)

mcp-servers/adobe-xd/                                               # NEW (full scaffold)
mcp-servers/kiro/                                                   # NEW (full scaffold)
```

Total: ~50 new files, ~10 modified files, ~70 new test cases across 30 orchestrated tasks in 4 phases.

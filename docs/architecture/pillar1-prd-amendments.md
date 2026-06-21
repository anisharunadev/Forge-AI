# Pillar 1 — Draft PRD Amendments (Review-Ready Insertion Text)

**Companion to:** `pillar1-gap-analysis.md` (this directory).
**Comparator:** `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md`.
**Status:** Draft. Do not apply to PRD until Tier 1 ratification per gap-analysis §6.

---

## How to Use This File

Each entry provides:
- **Insertion point** — PRD section and after-which-existing-row.
- **Insertion text** — exact row text matching existing PRD table-row format.
- **Edit on apply** — for DL-031 and §5.6 line 410 (Phase 6 out-of-V1 bullet), the existing text must be removed or amended in addition to inserting the new row.

All FRs use the table-row format from §5.1a (lines 246–247). All NFRs use the format from §6.1 (lines 421–422). All DLs use the format from §2 (lines 114–115). All OQs use the format from §7.2 (lines 584–585).

---

## Tier 1 — Must Have for Pillar 1 Phase 1 Alignment

### F-501 Code Validator Agent + F-502 Validation Report + F-503 Deterministic Security Gate

**Insertion point:** New section §5.4a inserted between §5.4 (line 353) and §5.5 (line 357). Title: "Phase 1.5 — Pillar 1 Validators (F-501..F-503)".

**Edit on apply:** None.

**Insertion text (entire new section):**

```markdown
### 5.4a Phase 1.5 — Pillar 1 Validators (F-501..F-503)

Independence of validators from the development agent is the design choice for security and quality gates. The Code Validator runs as a separate LangGraph sub-graph with its own state, prompt template, and reasoning trace. The merge decision downstream is deterministic (NFR-042), not LLM-judged.

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-501** | Code Validator Agent | Independent sub-agent that scans for vulnerabilities, exposed secrets, IaC misconfigurations, and standards violations. Runs as a separate LangGraph sub-graph with its own prompt, context, and reasoning state — no shared reasoning trace with the development agent. Output is a typed Validation Report artifact (per F-010 schema). Validator may run a different model instance from the development agent (NFR-043). | Steward, Architect, Tech Lead | F-005, F-014, F-016 |
| **F-502** | Validation Report Artifact | Typed artifact (per F-010 schema) carrying the validator's findings: finding_id, severity, file_path, line, rule_id, evidence, recommended_fix, standards_ref. Consumed by F-503 (Deterministic Security Gate) and surfaced in the Audit Trail (F-005). | Steward, Architect | F-501, F-010 |
| **F-503** | Deterministic Security Gate | Rules-based gate that blocks commit until F-501 returns PASS. LLM does not negotiate the merge decision — output is consumed as PASS/FAIL signal only (NFR-042). Failures auto-route to a remediation queue with F-502 attached. Gate state persisted to F-005 audit log with: commit_sha, gate_decision, validator_run_id, failure_reasons[]. | Tech Lead, Developer, Steward | F-501, F-502, F-005, F-006 |
```

---

### F-504 Steering Rules Engine

**Insertion point:** §5.1a (lines 244–258), insert as a new row after F-010 (line 257).

**Edit on apply:** None.

**Insertion text:**

```markdown
| **F-504** | Steering Rules Engine | Workspace Markdown files auto-injected into agent context at relevant workflow stages. Customer-specific conventions live as plain Markdown in the workspace (customer-portable; not vendor-trapped). Auto-discovery at session start; re-injected on file change. Rules typed per F-010 schema (steering-rule catalog). Same files-as-first-class-memory pattern as F-001 (Standards Library). *(NFR-031)* | Steward, Tech Lead, Architect | F-001, F-010 |
```

---

### NFR-042 Deterministic merge gate

**Insertion point:** §6.6 (line 475), insert as a new row after NFR-020.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **NFR-042** | Deterministic merge gate | The merge decision is rules-based. LLM output (from F-501 Code Validator Agent) is consumed as a PASS/FAIL signal only — not as a negotiated judgment. Rules either pass or they don't. No silent override. Auto-routes to remediation queue on FAIL. *(F-503)* |
```

---

### NFR-043 Independent validator reasoning

**Insertion point:** §6.8 (line 493), insert as a new row after NFR-030.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **NFR-043** | Independent validator reasoning | The Code Validator Agent (F-501) must run with separate prompt, separate context, and (where cost-justified per pilot measurement) separate model instance from the development agent. No shared reasoning state, no shared temperature/top-p, no shared tool-bundle. Independence is the design choice — same-model-but-different-context is acceptable floor; different-model is the ceiling. *(F-501)* |
```

---

### DL-031 IDE-integration-via-MCP-only

**Insertion point:** §2 (line 142), insert as a new row after DL-027.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **DL-031** | *(v2.0)* **Forge integrates with customer IDEs (Kiro, Cursor, Claude Code, Copilot) via MCP only.** No IDE fork, no IDE replacement, no IDE plugin shipped by Forge. Per-customer IDE choice drives the MCP adapter, not platform code. *(F-510, R8)* | Pillar 1 Deep-Dive §11 |
```

---

## Tier 2 — Should Have for Full Phase 1 + Phase 2 Alignment

### F-508 ClickUp MCP Adapter

**Insertion point:** §5.1a (line 254), insert as a new row after F-007.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **F-508** | ClickUp MCP Adapter | ClickUp as alt to Jira for per-customer ticketing. Same ticket / epic / story contract. Same webhook + polling fallback (NFR-017). Per-engagement choice. *(NFR-016)* | Tech Lead, Steward | F-007, F-015 |
```

---

### F-509 Adobe XD MCP Adapter

**Insertion point:** §5.1a, insert as a new row after F-508.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **F-509** | Adobe XD MCP Adapter | Adobe XD as alt to Figma for design assets and component specs on Adobe-stack engagements. Per-engagement choice. *(NFR-016)* | Architect, Tech Lead | F-007, F-015 |
```

---

### F-510 Kiro MCP Adapter

**Insertion point:** §5.1b (line 263), insert as a new row after F-011.

**Edit on apply:** None (Kiro already exists in F-011 description as a registered agent; F-510 adds the MCP-integration-target dimension).

**Insertion text:**

```markdown
| **F-510** | Kiro MCP Adapter | Kiro serves dual role: (a) registered agent in F-011 (agent-execution surface), and (b) MCP integration target for real-time IDE state and agent task execution (Pillar 1 §8). Adapter exposes: open files, current selection, active task queue, agent run history. Per-engagement choice. *(NFR-016, DL-031)* | Tech Lead, Developer | F-007, F-011, F-401 |
```

---

### NFR-046 Per-stage tool isolation

**Insertion point:** §6.8, insert as a new row after NFR-043.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **NFR-046** | Per-stage tool isolation | An agent at workflow stage X can invoke only the curated tool bundle for stage X (least-tool-per-task). Bundles defined in F-003 (Governance Policy Engine). Cross-stage tool reach is denied at the agent runtime layer. *(F-505)* |
```

---

### F-505 Per-Stage Tool Bundle Guardrails

**Insertion point:** §5.4a (new section, after F-503), insert as a new row at the end of the F-501..F-503 table.

**Edit on apply:** Update the section header from "F-501..F-503" to "F-501..F-505".

**Insertion text:**

```markdown
| **F-505** | Per-Stage Tool Bundle Guardrails | Declarative tool bundles per workflow stage, enforced at agent runtime. Each bundle is a typed artifact (per F-010 schema) listing permitted_tools[] and denied_tools[]. Curated by Steward, assigned per project by Tech Lead. Cross-bundle invocation denied at the runtime layer (NFR-046). Same Custom-Guardrails principle as the GSD White-Label surface (F-019). | Steward, Tech Lead | F-003, F-016, NFR-046 |
```

---

### DL-029 Refactor Agent leverages cloud-provider tooling

**Insertion point:** §2 (line 142), insert as a new row after DL-027 (before DL-031).

**Edit on apply:** None.

**Insertion text:**

```markdown
| **DL-029** | *(v2.0)* **Refactor Agent orchestrates cloud-provider modernization tooling** (AWS Transform-class on AWS; Azure equivalents on Azure). Forge does not reimplement source-to-target translation. Phased migration plans produced by the Refactor Agent land in Jira as backlog and are executed through the standard 5-stage workflow (DL-021). *(F-601, R8)* | Pillar 1 Deep-Dive §6 |
```

---

## Tier 3 — Phase 2 Specific

### F-601 Refactor Agent (Modernization Path)

**Insertion point:** New section §5.7 inserted after §5.5 (line 402) and before §5.6 (line 406).

**Edit on apply:**
1. Remove "**Phase 6 — Modernization / Refactor Accelerator:** Legacy migration plans, target architecture." from §5.6 (line 410).
2. Renumber remaining §5.6 bullet "Phase 7 — Delivery Orchestration Accelerator" → no change needed (it's Phase 7, not Phase 6).
3. Update the §5.6 closing line (line 413) from "Foundation + Phase 0 + Phase 1 + Phase 2 + Phase 3 constitute a fundable, demoable, pilotable V1." to also reference Phase 4: "Foundation + Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 (Modernization) constitute a fundable, demoable, pilotable V1." (Optional — only if Phase 4 is promoted from out-of-V1.)

**Insertion text (entire new section):**

```markdown
### 5.7 Phase 4 — Modernization / Refactor Accelerator (F-601)

The Refactor Agent operates on existing customer codebases rather than greenfield ideation-to-deploy. Orchestrates cloud-provider modernization tooling (AWS Transform for Java/.NET workloads on AWS engagements) and produces phased, cloud-native migration plans. Phased plans land in Jira as backlog (per F-213); the standard 5-stage workflow (DL-021) executes against the migration backlog.

**Artifact state machine:** Same as §5.3. Migration plan: `draft → under_review → approved → pushed-to-delivery`. Approved migration plan supersedes prior plan with explicit rationale.

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-601** | Refactor Agent (Modernization Path) | Orchestrates AWS Transform-class tooling on customer codebases. Produces phased, cloud-native migration plans as typed artifacts (per F-010 schema: source_inventory, target_architecture, phased_plan, risk_register, effort_estimate, dependencies). Plans land in Jira as backlog (per F-213); the standard 5-stage workflow (DL-021) executes against the migration backlog. Per-engagement target language and source (Java-on-mainframe, .NET-on-Windows-Server) driven by pilot customer priorities. *(OQ-017, DL-029)* | Architect, Tech Lead | F-101..F-115, F-213, F-301..F-310 |
```

---

### NFR-044 Fixed-budget workflow execution

**Insertion point:** §6.8 (line 493), insert as a new row after NFR-030.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **NFR-044** | Fixed-budget workflow execution | Each workflow instance declares a cost ceiling at intake (per F-201/F-601). No stage may silently overrun. Cost telemetry surfaces at every approval gate (NFR-032). Pre-call admission control via LiteLLM virtual keys (NFR-030). Ceiling breach triggers alert + remediation path, not silent pass-through. *(NFR-030, F-503)* |
```

---

### NFR-045 Day-one reference standards

**Insertion point:** §6.7 (line 486), insert as a new row after NFR-026.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **NFR-045** | Day-one reference standards | New engagement starts with KnackForge reference standards (engineering, security, architecture patterns) pre-loaded from F-001. Customer-specific layer is overlaid; customer never starts from a blank slate. Bootstrap completes during F-021 (Project Onboarding Wizard). Bootstrap is reproducible across engagements — same baseline, customer-specific overlay only. *(F-507, F-021)* |
```

---

### F-507 Day-One Bootstrap with Reference Standards

**Insertion point:** §5.1c (line 278), insert as a new row after F-021.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **F-507** | Day-One Bootstrap with Reference Standards | Project Onboarding Wizard (F-021) seeds the engagement with KnackForge reference standards (engineering, security, architecture patterns) from F-001 baseline. Customer-specific overlay applied on top. Bootstrap is idempotent — re-running it does not duplicate references. Bootstrap state captured in F-005 audit log. *(NFR-045)* | Steward, Tech Lead | F-001, F-021 |
```

---

## Tier 4 — Open Questions to Escalate

### OQ-016 V1 scope of 5-stage workflow

**Insertion point:** §7.2 (line 592), insert as a new row after OQ-011.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **OQ-016** | V1 scope of 5-stage workflow | Engineering Excellence + Pillar 1 Tech Lead | Should V1 expand to cover Development + Test + Deployment stages, or stay scoped to current 3-of-5 (Ideation + Architecture + Terminal Center, per §5.6 Phase 4–7 deferral)? Recommendation: stay scoped for V1; mark Development conductor as covered by F-401..F-415 (Terminal Center); defer Test/Deployment as Phase 4 unless pilot explicitly requires. Pillar 1 Deep-Dive §2 / §7 in-scope reference. |
```

---

### OQ-017 Refactor Agent first-target language and source

**Insertion point:** §7.2, insert as a new row after OQ-016.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **OQ-017** | Refactor Agent first-target language and source | Pillar 1 Tech Lead + Architect | Java-on-mainframe? .NET-on-Windows-Server? Driven by pilot customer engagement priorities. Resolution before F-601 implementation starts. Pillar 1 Deep-Dive §6 / §14. |
```

---

### OQ-018 ClickUp / Adobe XD / Kiro MCP priority

**Insertion point:** §7.2, insert as a new row after OQ-017.

**Edit on apply:** None.

**Insertion text:**

```markdown
| **OQ-018** | ClickUp / Adobe XD / Kiro MCP priority | Engineering Excellence | ClickUp MCP exists in code (mcp-servers/clickup/) but is not in PRD F-007. Adobe XD and Kiro-as-MCP are absent from PRD entirely. Resolve before Architecture Phase: V1 scope (amend F-508/F-509/F-510) or deferred to V2? Pillar 1 Deep-Dive §8. |
```

---

## Tier 5 — Pillar 1 Alignment Note (no PRD change)

This is **not** a PRD amendment. It is a documentation artifact that captures the semantic mapping between Pillar 1 deep-dive language and existing Forge AI decomposition. Honors DL-015 ("Forge is NOT an SDLC agent") without amendment.

**New file:** `docs/architecture/pillar1-alignment.md`

**Insertion text (entire new file):**

```markdown
# Pillar 1 — Alignment Note (Semantic Mapping)

**Date:** 2026-06-22
**Purpose:** Document the semantic mapping between Pillar 1 Deep-Dive (v1.0, May 4, 2026) terminology and the existing Forge AI decomposition. Resolves the "SDLC Agent" naming tension without amending DL-015.

## Background

The Pillar 1 Deep-Dive names an "SDLC Agent" as the user-facing entity that orchestrates the 5-stage build workflow. Forge AI's PRD v2.0 (DL-015) explicitly states: "Forge is an Agent Operating System, not an SDLC agent." This note documents how the two framings coexist.

## Mapping

| Pillar 1 Term | Forge AI Decomposition | Notes |
|---|---|---|
| SDLC Agent | Composition of (a) LangGraph supervisor at `backend/app/agents/sdlc_agent.py`, (b) 9 phase nodes under `backend/app/agents/nodes/`, (c) ideation services at `backend/app/services/ideation/`, (d) architecture services at `backend/app/services/architecture/`, (e) Terminal Center at F-401..F-415 + `backend/app/services/terminal/` | The composition is the SDLC Agent. Forge orchestrates the composition; the SDLC Agent is the user-facing label for the workflow, not a single platform entity. |
| Forge Ideation Agent | F-201..F-213 + `backend/app/services/ideation/*.py` | Named directly in PRD §5.3. |
| Code Validator Agent | F-501 (Tier 1 amendment, pending ratification) | New entity; no existing analog in PRD or code. |
| Refactor Agent | F-601 (Tier 3 amendment, pending ratification) | Promotes Phase 6 from out-of-V1 to in-scope. |
| IDE (Kiro, Cursor, Claude Code) | F-011 Agent Registry (agent execution) + F-510 Kiro MCP Adapter (Tier 2, pending) + DL-031 IDE-via-MCP-only (Tier 1, pending) | Customers pick their IDE; Forge integrates via MCP. |
| 5-stage Build Workflow | DL-021 enumerates the same stages: PI → Ideation → Architecture → Dev → Testing → Security → Deployment. V1 covers 3-of-5 (Ideation + Architecture + Terminal Center). | See OQ-016 for scope decision. |

## Constitutional Posture

- **DL-015 is preserved.** Forge remains the Agent Operating System.
- **Pillar 1 framing is honored.** The "SDLC Agent" is a named composition, not a platform entity.
- **No amendment to DL-015 required.** Future Pillar 1 amendments may reference the SDLC Agent as a composition without conflict.

## Cross-References

- PRD: `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md`
- Implementation plan: `implementation_plan.md`
- ADRs: `docs/architecture/decisions/0007-langgraph-sdlc-agent-orchestrator.md`
- Pillar 1 Deep-Dive gap analysis: `pillar1-gap-analysis.md`
- Pillar 1 amendment drafts: `pillar1-prd-amendments.md`
```

---

## Cross-Reference Summary (post-apply)

If all 18 amendments are applied to `prd.md`, the resulting PRD adds:

- **2 new FRs in §5.1a Foundation:** F-504 (Steering Rules Engine), F-507 (Day-One Bootstrap).
- **3 new FRs in §5.1b Agent Center / Connectors:** F-508 (ClickUp), F-509 (Adobe XD), F-510 (Kiro MCP).
- **4 new FRs in new §5.4a Phase 1.5 Validators:** F-501, F-502, F-503, F-505.
- **1 new FR in new §5.7 Phase 4 Modernization:** F-601.
- **5 new NFRs:** NFR-042 (after NFR-020), NFR-043 (after NFR-030), NFR-044 (after NFR-030), NFR-045 (after NFR-026), NFR-046 (after NFR-043).
- **3 new DLs in §2:** DL-029, DL-031 (and Tier 1 sequencing keeps DL numbering clean).
- **3 new OQs in §7.2:** OQ-016, OQ-017, OQ-018.
- **1 edit to §5.6 line 410:** remove "Phase 6 — Modernization / Refactor Accelerator" bullet.
- **1 optional edit to §5.6 line 413:** update closing line to reference Phase 4 if Phase 4 is promoted from out-of-V1.

Total PRD growth: ~17 new rows across 5 existing sections + 2 new sections + 3 OQs + 1 edit = manageable diff for a single PR.

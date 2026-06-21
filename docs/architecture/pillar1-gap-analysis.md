# Pillar 1 Deep-Dive — Gap Analysis vs. Forge AI PRD v2.0

**Date:** 2026-06-22
**Scope:** Pillar 1 Phase 1 (Web App SDLC) + Phase 2 (Refactor Agent). Pillar 1 Phase 3 (Databricks pipelines) and Phase 4 (limited autonomous bug-fix) are out of scope per user direction.
**Comparator artifact:** `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md` (PRD v2.0, 1095 lines).
**Companion artifact:** `pillar1-prd-amendments.md` (this directory) — draft insertion text for every proposed FR/NFR/DL/OQ.
**Resolution framing (per user):** Pillar 1's "SDLC Agent" maps to the existing LangGraph supervisor + ideation/architecture services + Terminal Center composition, rather than forcing a DL-015 amendment.

---

## 1. Executive Verdict

The PRD v2.0 covers the **majority** of Pillar 1's vision but has **structural gaps** in five areas: the Code Validator Agent, deterministic security gates, steering rules as workspace Markdown, fixed-budget per-workflow cost control, and the Refactor Agent (currently placed out-of-V1 in §5.6). MCP integration coverage is partial — three Pillar 1 priority integrations (ClickUp, Adobe XD, Kiro as MCP target) are not named in F-007 / F-015.

| Section | Pillar 1 Concepts | Covered | Partial | Gap | Out-of-V1 |
|---|---|---|---|---|---|
| A. Workflow Shape | 4 | 3 | 1 | — | — |
| B. Named Sub-Agents | 5 | 3 | — | 2 | — |
| C. MCP Integrations | 9 | 6 | — | 3 | — |
| D. Posture Rules | 9 | 3 | 3 | 3 | — |
| E. Phase 2 (Refactor) | 4 | 1 | — | 2 | 1 (deferred) |
| F. Constitutional Alignment | 6 | 1 | — | 5 | — |
| **Total** | **37** | **17** | **4** | **15** | **1** |

**15 gaps require PRD amendments.** Tier 1 (must-have for Pillar 1 alignment) = 6 amendments. Tier 2 (should-have) = 5. Tier 3 (Phase 2 specific) = 3. Tier 4 = 3 OQs to escalate. Tier 5 = 1 alignment note (no PRD change).

---

## 2. Coverage Matrix (Phase 1 + Phase 2)

### Section A — Workflow Shape

| Pillar 1 Concept | PRD Coverage | Verdict | Action |
|---|---|---|---|
| 5-stage build workflow (Ideation → Architecture → Development → Test → Deployment) | DL-021 enumerates the same six stages. F-201..F-213 (Ideation), F-301..F-310 (Architecture), F-401..F-415 (Terminal Center for the Development conductor). PRD §5.6 explicitly places Development Accelerator, Security+QA, Modernization/Refactor, and Delivery Orchestration as Phases 4–7 — **out-of-V1**. | **Partial** | OQ-016 (see §4) — decide whether V1 expands to cover Dev/Test/Deploy or stays scoped to current 3-of-5 |
| Continuous context orchestration across stages | F-115 (Unified Knowledge Graph) + F-007 (Connectors/MCP Registry) + §1.4 Pillar 2 description + ADR-002 (Apache AGE) | **Covered** | None |
| Forge flow ordering | DL-021 | **Covered** | None |
| SDLC Agent (mapped to existing decomposition per user direction) | `backend/app/agents/sdlc_agent.py` (LangGraph supervisor) composes 9 phase nodes; ideation/architecture services + terminal center complete the surface. The single "SDLC Agent" frame is satisfied by the composition. | **Covered (semantic rename)** | Alignment note (Tier 5) — no PRD change |

### Section B — Named Sub-Agents

| Pillar 1 Concept | PRD Coverage | Verdict | Action |
|---|---|---|---|
| Forge Ideation Agent | F-201..F-213 (13 FRs) + `backend/app/services/ideation/*.py` (12 service modules, each 8–24 KB) | **Covered** | None |
| Code Validator Agent | F-308 (Standards Attestation) is a partial analog: "Every generated artifact carries attestation of which standards (F-001) it complies with." No independent validator sub-agent. No grep hit for "Code Validator" in backend or apps. | **Gap** | Tier 1: F-501 + NFR-043 |
| Refactor Agent (Phase 2) | PRD §5.6 Phase 6 — Modernization / Refactor Accelerator — is explicitly **out-of-V1**. No mention of orchestration over cloud modernization tooling (AWS Transform). | **Gap** | Tier 3: F-601 + DL-029 + OQ-017 |
| Architect / Development / Security / Deployment Agent assignments | F-013 maps stages to existing agents (Architecture → Claude Code, Development → Codex, Testing → Gemini, Security → Claude, Deployment → Hermes). | **Covered** | None |
| Agent independence (separate prompt / context / reasoning) | NFR-029 (Agent Runtime Portability) covers portability; **does not require independence-of-reasoning for validators**. | **Gap** | Tier 1: NFR-043 |

### Section C — MCP Integration Set

| MCP | PRD / Code Coverage | Verdict | Action |
|---|---|---|---|
| Jira | F-007 list includes Jira; `mcp-servers/jira/` exists. | **Covered** | None |
| ClickUp | **Not listed** in F-007 or §4.4; `mcp-servers/clickup/` exists in code (gap between PRD and impl). | **Gap** | Tier 2: F-508 |
| Zendesk | F-007 + F-113 (Communication Ingestion); `mcp-servers/zendesk/` exists. | **Covered** | None |
| Confluence | F-007 + F-112; `mcp-servers/confluence/` exists. | **Covered** | None |
| GitHub | F-007 + F-101; `mcp-servers/github/` exists. | **Covered** | None |
| SonarQube | F-007 + F-202 (Idea Analysis pulls tech debt); `mcp-servers/sonarqube/` exists. | **Covered** | None |
| Figma | F-007 + F-114 (Asset Ingestion); `mcp-servers/figma/` exists. | **Covered** | None |
| Adobe XD | **Not listed** in PRD; **no MCP server**. | **Gap** | Tier 2: F-509 + new `mcp-servers/adobe-xd/` scope (implementation task, downstream of PRD change) |
| Kiro (as MCP target) | F-011 (Agent Registry) lists Kiro as an agent; **not listed as MCP integration target**. No MCP server. Pillar 1 wants Kiro for "real-time IDE state, agent task execution." | **Gap** | Tier 2: F-510 — clarify Kiro's dual role (agent in F-011 + MCP integration in F-510) |

### Section D — Posture Rules

| Pillar 1 Concept | PRD Coverage | Verdict | Action |
|---|---|---|---|
| Human-in-the-loop at every stage | NFR-032 (Human Governance Enforcement) + DL-002 + §4.5 governance boundary + R3. Artifact state machine in §5.3 is governance-boundary aware. | **Covered (strong)** | None |
| Independent validators | NFR-029 covers portability; **no requirement for separate reasoning context**. | **Gap** | Tier 1: NFR-043 |
| Deterministic security gates (PASS/FAIL; LLM does not negotiate merge) | NFR-032 + F-006 (Approval Engine) cover human approval. **No "deterministic, rules-based, non-LLM-judged" merge gate**. | **Gap** | Tier 1: F-503 + NFR-042 |
| Continuous context (not snapshot) | F-115 + F-007 + F-111 (Incremental Sync) + NFR-031 (Knowledge Freshness with per-node `freshness_at`). | **Covered** | None |
| Steering rules as workspace Markdown files (auto-injected into agent context) | F-001 (Standards Library, versioned Markdown-encoded) + F-002 (Templates, Markdown-encoded) + NFR-019 (Markdown export). **No "workspace-as-first-class-memory, auto-injected into agent context" pattern.** | **Gap** | Tier 1: F-504 |
| Tool-bundle-per-stage / least-tool-per-task | F-003 (Governance Policy Engine, declarative gates) + F-019 (GSD White-Label Registry, 60+ `forge-*` commands). Per-stage tool isolation is implied by governance but **not explicitly required**. | **Partial** | Tier 1 (NFR-046) + Tier 2 (F-505) |
| Audit trail across stage transitions | NFR-020 (WORM + hash-chain + external anchor) + F-005 (Audit Log) + F-407 (Terminal Audit) + ADR-008. Audit captures: actor, action, target, timestamp, tenant_id, before_value, after_value, rationale. | **Covered (strong)** | None |
| Fixed-budget LLM (no silent overrun) | NFR-030 (Cost Controls per-tenant via LiteLLM) — covers tenant budgets + pre-call admission control. **Does not require per-workflow fixed ceilings that surface at approval gates.** | **Partial** | Tier 3: NFR-044 |
| Day-one bootstrap with KnackForge reference standards | F-001 (Standards Library) + F-019 (GSD White-Label Registry) + F-021 (Project Onboarding Wizard). Generic, **not "engagement starts with KnackForge reference baseline pre-loaded."** | **Partial** | Tier 3: NFR-045 + F-507 |

### Section E — Phase 2 (Refactor Agent)

| Pillar 1 Concept | PRD Coverage | Verdict | Action |
|---|---|---|---|
| Refactor Agent exists | §5.6 Phase 6 explicitly **out-of-V1**. | **Gap** | Tier 3: F-601 |
| Orchestrates AWS Transform (Java, .NET on AWS) | Not addressed. | **Gap (sub)** | Rolled into F-601; first-target language → OQ-017 |
| Phased migration plan → Jira backlog | F-213 (Push to Delivery Systems) is the destination. | **Covered (target)** | None |
| Integration with standard 5-stage workflow | Inherits Section A coverage once Refactor Agent lands. | **Conditional** | None |
| Databricks pipeline modernization | User explicitly out-of-scope. | **Deferred** | None |

### Section F — Constitutional Alignment (PRD R1–R8 vs. Pillar 1 §11 principles)

| Pillar 1 Principle | PRD Position | Verdict |
|---|---|---|
| IDE is sacred — integrate via MCP, do not fork IDE | Not explicitly stated. Kiro / Cursor / Claude Code are listed in F-011 (Agent Registry) as agents, not as MCP integration targets. | **Gap (light)** — add DL-031 (Tier 1) |
| Independent validators | See Section B | See above |
| Continuous context | See Section D | See above |
| Steering rules as Markdown | See Section D | See above |
| Tool-bundle-per-stage | See Section D | See above |
| Deterministic security gates | See Section D | See above |

---

## 3. Constitutional Check — Do Amendments Weaken R1–R8?

Cross-referenced from `.claude/CLAUDE.md` Rule 1–8:

| Rule | Concern | Verdict |
|---|---|---|
| **R1** Model-provider agnosticism | NFR-029 + DL-025 + LiteLLM Proxy already enforce. Code Validator + F-504 inherit the same rule (no provider SDK imports). | ✅ No weakening |
| **R2** Multi-tenancy by default | Every artifact carries `tenant_id` + `project_id` (PRD §6.13 substrate). All new amendments follow the same constraint by composition. | ✅ No weakening |
| **R3** Mandatory human approval gates | NFR-032 + DL-002 lock human gates. New F-503 (deterministic security gate) is additive — automated rules-based gate that runs **before** the human gate, not in place of it. F-504 steering rules are auto-injected context, not autonomous decisions. | ✅ No weakening — additive |
| **R4** Typed artifacts only | F-501 / F-503 / F-504 / F-601 all produce typed artifacts (validation report, PASS/FAIL signal, steering rule catalog, migration plan). | ✅ No weakening |
| **R5** Layer isolation (Org shared, Project isolated) | Not affected by new amendments. | ✅ No weakening |
| **R6** Mandatory auditability | NFR-020 + F-005 + F-407 + ADR-008 capture every stage transition. F-501 (validator) and F-503 (gate) emit audit events by inheritance from F-005. | ✅ No weakening |
| **R7** Mandatory observability | NFR-021/022/023 (structured logs, metrics, OpenTelemetry traces) apply to all new services. | ✅ No weakening |
| **R8** Configurable everything | New MCP adapters (F-508/509/510) and Refactor Agent (F-601) plug in via the connector pattern, not hard-coded. | ✅ No weakening |

**All 8 constitutional rules are preserved.**

---

## 4. Proposed PRD Amendments (Prioritized)

### Tier 1 — Must Have for Pillar 1 Phase 1 Alignment (6 amendments)

1. **F-501 Code Validator Agent** — new FR in a new "Phase 1.5 Pillar 1 Validators" sub-section. Independent sub-agent, owns security / secrets / IaC validation, runs as a separate LangGraph sub-graph with its own state and prompt template, no shared reasoning state with the development agent.
2. **F-503 Deterministic Security Gate** — new FR. Pattern after F-006. PASS/FAIL gate that blocks commit until validator returns PASS; LLM does not negotiate the merge decision; failures auto-route to a remediation queue with rationale.
3. **F-504 Steering Rules Engine** — new FR. Pattern after F-001 + F-002. Workspace Markdown files auto-injected into agent context at relevant workflow stages; customer-portable; files-as-first-class-memory.
4. **NFR-042 Deterministic merge gate** — new NFR. Merge decision is rules-based; LLM output is consumed as a PASS/FAIL signal only, not as a negotiated judgment.
5. **NFR-043 Independent validator reasoning** — new NFR. Validator must run with separate prompt, separate context, and (where cost-justified) separate model instance; no shared reasoning state.
6. **DL-031 IDE-integration-via-MCP-only** — new DL. Forge integrates with customer IDEs (Kiro, Cursor, Claude Code, Copilot) via MCP; no IDE fork; per-customer IDE choice drives adapter, not platform code.

### Tier 2 — Should Have for Full Phase 1 + Phase 2 Alignment (5 amendments)

7. **F-508 ClickUp MCP Adapter** — new FR. Alt to Jira; same ticket / epic / story contract; per-customer choice.
8. **F-509 Adobe XD MCP Adapter** — new FR. Alt to Figma for Adobe-stack customers; design assets and component specs.
9. **F-510 Kiro MCP Adapter** — new FR. Clarifies Kiro's dual role: agent (F-011) AND MCP integration target (real-time IDE state, agent task execution).
10. **NFR-046 Per-stage tool isolation** — new NFR. Agent at stage X cannot invoke tools outside the curated bundle for stage X (least-tool-per-task).
11. **DL-029 Refactor Agent leverages cloud-provider tooling** — new DL. Refactor Agent orchestrates AWS Transform-class tooling; does not reimplement source-to-target translation; phased migration plans land in Jira as backlog for SDLC-Agent-driven execution.

### Tier 3 — Phase 2 Specific (3 amendments)

12. **F-601 Refactor Agent (Modernization Path)** — new FR in new "Phase 6 Modernization Accelerator (Pillar 1 Phase 2)" section. Pattern after F-301..F-310. Orchestrates AWS Transform for Java/.NET workloads on AWS engagements; produces phased migration plans; integrates via F-213.
13. **NFR-044 Fixed-budget workflow execution** — new NFR. Each workflow instance declares a cost ceiling; no stage silently overruns; cost telemetry surfaces at approval gates.
14. **NFR-045 Day-one reference standards** — new NFR. New engagement starts with KnackForge reference standards (engineering, security, architecture patterns) pre-loaded; customer-specific layer overlaid; customer never starts from blank slate.

### Tier 4 — Open Questions to Escalate (3 OQs)

15. **OQ-016 V1 scope of 5-stage workflow** — Should V1 expand to cover Development + Test + Deployment, or stay scoped to Ideation + Architecture + Terminal Center per current §5.6?
16. **OQ-017 Refactor Agent first-target language and source** — Java-on-mainframe? .NET-on-Windows-Server? Driven by pilot customer engagement priorities.
17. **OQ-018 ClickUp / Adobe XD / Kiro MCP priority** — V1 or deferred to V2? PRD currently inconsistent (ClickUp exists in code, not in PRD; Adobe XD/Kiro absent entirely).

### Tier 5 — Coverage Statement (no PRD change)

18. **Pillar 1 alignment note** — Documented in `pillar1-prd-amendments.md` companion file. Maps Pillar 1 "SDLC Agent" → existing LangGraph supervisor + ideation/architecture services + Terminal Center composition. Resolves DL-015 tension without amending it.

---

## 5. Verification Against Pillar 1 §12 (Production-Ready Criteria)

Pillar 1 §12 lists 8 production-ready bullets. Mapping to existing FR/NFR or proposed amendments:

| Pillar 1 §12 Bullet | Coverage | Amendment (if any) |
|---|---|---|
| 5-stage workflow runs end-to-end for at least one customer engagement | V1 covers 3 of 5 stages (Ideation + Architecture + Terminal conductor) | OQ-016 |
| Forge Ideation Agent produces sprint-ready output validated against real customer backlog | F-201..F-213 + F-209 (Ideation Agent Selection) | None |
| Code Validator Agent is independent of development agent | Not named | F-501 + NFR-043 |
| MCP orchestration covers priority set (Section 8) | 6 of 9 covered; ClickUp / Adobe XD / Kiro as MCP missing | F-508 + F-509 + F-510 |
| Steering rules are Markdown-file-based, customer-portable | Not named | F-504 |
| Audit trail captures every stage transition | NFR-020 + F-005 + F-407 + ADR-008 | None |
| Fixed-budget LLM operation enforced end-to-end | NFR-030 covers tenant budgets, not per-workflow | NFR-044 |
| Day-one bootstrap with reference standards | F-001 + F-019 cover generically | NFR-045 + F-507 |

**Result:** 5 of 8 Pillar 1 §12 bullets have explicit gap amendments; 3 are covered as-is.

---

## 6. Recommended Decision Path

For the user / leadership to ratify before amendments are applied to `prd.md`:

1. **Approve Tier 1 (6 amendments).** Without these, the PRD does not lock the Code Validator Agent, deterministic merge gate, or steering-rules pattern that Pillar 1 §11 demands.
2. **Decide on Tier 4 OQ-016.** This is the largest scope question — whether V1 expands to cover Dev/Test/Deploy or stays at 3-of-5 stages. Recommendation: stay at 3-of-5 for V1; mark Dev/Test/Deploy as Phase 4 (already §5.6) and add explicit "Development conductor already covered by F-401..F-415" cross-reference.
3. **Approve Tier 2 + Tier 3 (8 amendments) for Phase 2 alignment.** These are mostly additive and don't restructure existing scope.
4. **Apply amendments.** Insertion points specified in the companion `pillar1-prd-amendments.md` file. Each entry includes exact text and section placement.
5. **Update implementation_plan.md** to map new milestones (suggest M12: Validators + Gates; M13: Refactor Agent).
6. **Draft new ADRs if architecture-impacting:**
   - ADR-009 (sub-agent independence for validators) — depends on F-501 / NFR-043 implementation choice.
   - ADR-010 (modernization tooling orchestration) — depends on F-601 implementation choice.

---

## 7. Number-Collision Verification

`grep -nE 'F-(501|503|504|505|506|507|508|509|510|601)|NFR-(042|043|044|045|046)|DL-(028|029|030|031)|OQ-(016|017|018)' docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/{prd.md,addendum.md} implementation_plan.md` returned **zero matches**. All proposed IDs are available for insertion.

---

## 8. What This Analysis Does Not Cover

- **Editing the PRD itself.** Amendments are drafted in the companion file, not applied.
- **Pillar 1 Phase 3 (Databricks pipelines)** — out of scope per user direction.
- **Pillar 1 Phase 4 (limited autonomous bug-fix)** — out of scope per user direction.
- **Renaming DL-015** ("Forge is NOT an SDLC agent") — handled by alignment note, not PRD amendment.
- **Implementation of new MCP servers** (`mcp-servers/adobe-xd/`, `mcp-servers/kiro/`) — downstream of any PRD amendment that names them.
- **Replacement of `packages/gsd-{core,pi}-stub/`** with real `@opengsd/*` — known stub-status issue, orthogonal to Pillar 1 coverage.

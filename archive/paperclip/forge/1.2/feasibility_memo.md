# Feasibility Memo — Forge Ideation Agent (Sub-goal 1.1) · Market & Tech-Debt Analysis

**Sub-goal:** [Forge AI-60](/Forge AI/issues/Forge AI-60) — Sub-goal 1.2 of [Forge AI-17](/Forge AI/issues/Forge AI-17) (Epic 1)
**Subject of analysis:** Forge Ideation Agent · Requirement Ingestion (Sub-goal 1.1)
**Inputs:** [Draft PRD](/Forge AI/issues/Forge AI-59) (Forge AI-59), [requirement_brief.json](/Forge AI/issues/Forge AI-59) (Forge AI-59), `workspace/memory/*.md`, `workspace/project/*.md`, `workspace/customer/*.md`, Forge AI monorepo (`apps/`, `packages/`, `mcp-servers/`, `docs/architecture/`, `.github/workflows/`)
**Recommendation:** **GO** — ship Sub-goal 1.1 on the v1 timeline, conditional on Q1, Q2, Q5 resolution before architecture handoff. Pivot signal: escalate if Atlassian ships a comparable idea → PRD flow with audit inside Jira Product Discovery before Forge AI's first design partner is signed.
**Authored by:** BA (`99b34c5d-87d4-42a0-a66a-c65a916aeeec`) — 2026-06-17
**Companion:** [`tech_debt_score.json`](./tech_debt_score.json)

---

## 1. Vision (the question this memo answers)

Does the Forge Ideation Agent — Sub-goal 1.1, Requirement Ingestion — have a defensible market position AND a buildable technical foundation to ship on the Q3 2026 milestone, given the current Forge AI platform state? This memo says **yes**, with two sequencing conditions and one watch-list item.

---

## 2. Problem framing (what we are evaluating)

- **Market:** Is there a customer wedge that survives Atlassian, ChatPRD, Productboard, Aha!, Zeda.io, and GitHub Copilot Workspace?
- **Tech debt:** Can the existing Forge AI monorepo host a customer-facing AI agent without dragging v1 into a refactor of the orchestrator, MCPs, or audit surface?
- **Risk:** What blocks v1, and what is a v1.1 / v2 problem?

---

## 3. Target customer (per [Forge AI-59 §3](/Forge AI/issues/Forge AI-59))

- Series-B-to-Series-D SaaS, 50–500 engineers.
- ICP trigger: PM drops a one-line idea; expects a structured Draft PRD back in ≤ 10 minutes.
- Board / CISO gate: every agent action must be auditable and tenant-isolated.
- Out of scope v1: pre-Series-A, Fortune 500 with bespoke compliance (FedRAMP / HIPAA / PCI-DSS), non-software orgs.

---

## 4. Market scan — 5 comparable products

| # | Product | Closest overlap | Strengths | Weakness vs Forge AI's wedge |
|---|---------|------------------|-----------|---------------------------|
| 1 | **Atlassian Jira Product Discovery + Atlassian Intelligence** ([atlassian.com](https://www.atlassian.com/software/jira/product-discovery)) | "Idea → Jira Issue" inside the Jira wedge | Massive install base; native to Jira; strategy-grade reporting | No end-to-end Dev → QA → Security → DevOps pipeline; audit is Jira-native, not tenant-isolated Forge AI-grade; no Knowledge Layer grounding |
| 2 | **ChatPRD by ClickUp** ([chatprd.ai](https://www.chatprd.ai/)) | "One-line idea → structured PRD" | PM-loved UI; built-in templates; good first-draft UX | Stops at the PRD; no Jira sync; no audit trail; no MCP integration; no customer-Knowledge-Layer grounding |
| 3 | **Zeda.io** ([zeda.io](https://zeda.io/)) | "Customer signal → PRD" with AI assist | Strong product-discovery flow; ties PRDs to customer voice | Lives outside Jira; one-way Jira push (no MCP pull); no Architect/Dev handoff |
| 4 | **Productboard AI** ([productboard.com](https://www.productboard.com/)) | AI-assisted PRD + roadmap prioritisation | Deep product-management data model; AI surfaces patterns | Silo: PM-side tool; engineering hand-off is a CSV export; no audit trail per agent step |
| 5 | **Aha! AI** ([aha.io](https://www.aha.io/)) | Strategy + ideas + PRD with AI assist | Top-down roadmap intelligence; deep customisation | Strategy-first; weak on the engineering-side handoff; not Jira-native |

**Adjacent (not direct):**

- **GitHub Copilot Workspace** — sits at the Dev stage (Issue → PR), not the Ideation stage. They are a Forge AI *downstream* candidate, not a competitor.
- **Linear AI Asks** — Linear-only; small install base relative to Jira.
- **Notion AI / Confluence AI** — drafting tools; no PRD contract; no Jira-side structure.

### 4.1 Differentiation matrix

Forge AI's Forge Ideation Agent wins on **three** dimensions and loses on **one**. (Per the 2–3 differentiators bar — we surface four and pick the strongest three for the executive read.)

| Differentiator | Forge AI wins on | Why competitors don't match |
|----------------|---------------|------------------------------|
| **End-to-end SDLC closure** — Forge is the front of a 7-stage pipeline (Ideation → Architect → Dev → QA → Security → DevOps → Docs) | Yes | No competitor closes the loop past the PRD. ChatPRD/Productboard/Zeda stop at the artifact; Atlassian has no automated Architect/Dev/QA hand-off. |
| **Auditable AI actions + tenant isolation** — every Knowledge Layer read, MCP call, prompt/response (when `Forge AI_LOG_LLM=1`) is logged under `run_id`, queryable by `tenant_id` | Yes | The CISO wedge. None of the competitors carry a SOC 2-grade agent audit log per design-partner tenant. |
| **Knowledge Layer grounding** — the Draft PRD is grounded in the customer's `workspace/memory/`, `workspace/customer/`, `workspace/project/`, not in an LLM's priors | Yes | ChatPRD and Atlassian Intelligence generate from generic templates. Forge AI reads the customer's actual standards, conventions, glossary, and ADRs. |

**Where Forge AI loses:** brand recognition and install-base density vs Atlassian. Atlassian has 300k+ Jira customers; Forge AI has zero design-partner contracts at this writing. This is a **go-to-market** risk, not a product risk.

### 4.2 Risks

1. **Atlassian bundling** — if Atlassian ships "Idea → PRD with audit" inside Jira Product Discovery + Atlassian Intelligence before Forge AI's first design partner is signed, the Jira wedge narrows. **Mitigation:** Knowledge Layer grounding + end-to-end SDLC closure is hard to replicate inside Atlassian; the DevOps stage in particular (container build → deploy → runbook) is not a Jira-shaped problem. **Owner:** CEO + CTO. **Watch:** Atlassian Summit announcements, Jira Product Discovery release notes.
2. **LLM cost / latency creep** — p95 cost target $3.00 / hard ceiling $5.00 per the Draft PRD §8. If model pricing rises or tokens-per-PRD balloons, the margin disappears. **Mitigation:** hard budget enforced at the orchestrator layer; prompt cache on (per `tech-stack.md` §8); per-tenant token budgets. **Owner:** CTO. **Watch:** Anthropic pricing announcements; first 10 design-partner runs.

---

## 5. Product surface — what changes in Forge AI if 1.1 ships

(Per Forge AI-59 §5; this memo does not re-litigate the PRD.)

- New: `requirement_brief.json` (intermediate, versioned).
- New: `draft_prd.md` aligned to `workspace/project/PRD.md` template.
- New: `ask_user_questions` interaction on the issue when ambiguity is blocking.
- New: audit-log entries under `stage=ideation` for every Knowledge Layer read and MCP call.
- Unchanged: orchestrator, MCP servers, Knowledge Layer, audit surface.

---

## 6. Key user journeys — single owner per journey

(Per Forge AI-59 §6; ownership is unchanged.)

| Journey | Owner | Sub-goal slice |
|---------|-------|----------------|
| Feature from a Slack message | `ba-agent` (Ideation) | 1.1 |
| Audit | Security | spans all stages |
| Ambiguity surfacing | `ba-agent` (Ideation) | 1.1 |

---

## 7. Non-goals (v1, 1.1)

(Per Forge AI-59 §7; reinforced here.)

- Writing to the Knowledge Layer — humans write in v1.
- Calling tools outside the v1 MCP allow-list (Jira only for Q3 2026; Slack/Zendesk/Confluence stubbed `not_wired`).
- Generating the Jira Epic — that is 1.3.
- Pushing anything to Jira — that is 1.4.

---

## 8. Success metrics — inherited from Forge AI-59 §8

North star: **% of Draft PRDs that pass structural lint on the first try and are advanced to the Architect stage without rework.** Baseline 0 % (no runs), target ≥ 80 % by end of Q3 2026.

Guardrails (numbers retained from Forge AI-59 §8): time-to-Draft-PRD p50 ≤ 5 min, p95 ≤ 10 min; cost p50 ≤ $0.50, p95 ≤ $3.00, hard ceiling $5.00; ambiguity-surfacing rate ≥ 95 %; Knowledge Layer read-set compliance 100 %; tenant isolation 100 %; audit-log completeness 100 %; open-question close rate ≥ 90 % within 7 days.

This memo adds **no new success metrics**; it inherits and reinforces.

---

## 9. Tech-debt assessment — composite score

**Composite risk: 43 / 100 (moderate).** See [`tech_debt_score.json`](./tech_debt_score.json) for the full breakdown.

| Sub-score | Value | Verdict |
|-----------|-------|---------|
| `architecture_risk` | 35 / 100 | Moderate; alignment is strong but with two gaps |
| `security_risk` | 55 / 100 | Moderate-high; good guards in place, partial coverage |
| `maintainability_risk` | 40 / 100 | Moderate; good docs and tests, uneven build-out |
| `composite` (avg) | **43 / 100** | Below the 70 escalation threshold — ship-able |

**Methodology note:** SonarQube + GitHub MCP are not wired (per `requirement_brief.json` Q2 — MCP read-set for 1.1 is Jira only). The score is a **static structural review** against the standards in `workspace/memory/{architecture,security,coding,devops}.md`, plus a direct read of representative module source (`apps/orchestrator/`, `packages/tenancy-lint/`, `mcp-servers/jira/`). The methodology and gap are recorded in the JSON under `method` so the Audit agent can reconstruct the trail.

### 9.1 Architecture (35 / 100) — where the platform helps vs hurts

**Helps:**

- 9 ADRs in `docs/architecture/` covering agent-of-agents, gRPC orchestrator↔runtime, NATS JetStream event bus, auth/tenancy, paperclip approvals, soft-delete for runs/events.
- Orchestrator (`apps/orchestrator/`) is real: 14 source files, 5 test files (incl. a 30 K-line `lifecycle.test.ts`), vitest wired, structured around session lifecycle + state machine + idempotency + board approval. Matches the staged workflow in `workspace/memory/architecture.md` §3.
- `packages/event-bus/` ships envelope + producer + consumer + replay + state-changes — the audit-replay backbone described in `architecture.md` §9.
- `mcp-servers/jira/` follows a documented template with project-pin safety posture — matches `tech-stack.md` §10 priority-1 MCP pattern.

**Hurts (gaps):**

- **`apps/agent-runtime/` is TS-only despite `tech-stack.md` §2 saying Python 3.12** — a documented vs. actual divergence. `package.json` declares TS toolchain; `dist/` ships compiled `.js`; tests run on vitest. The Python-runtime revival is either a v1.1 task or the doc needs updating. For 1.1 specifically, the agent-runtime is the *consumer* of the Ideation contract, not the LLM caller — so a TS runtime is acceptable as long as the LLM SDK choice lands. **Action:** add a one-line ADR candidate ("agent-runtime TS in v1; Python-only tooling later") so the divergence is owned.
- `docs/adr/` (one file) vs. `docs/architecture/` (nine files) — naming inconsistency. Not blocking, but a future agent cold-started on `docs/adr/` will miss the architectural record.
- MCP servers have variable depth — `mcp-servers/jira/` is solid; `mcp-servers/confluence/`, `mcp-servers/aws/`, `mcp-servers/github/` look under-built. **For 1.1, only the Jira MCP is on the hot path** (Q2 resolved: Jira only), so this is a 1.4 / Epic 2 risk, not a 1.1 risk.

### 9.2 Security (55 / 100) — strong guards, partial coverage

**Helps:**

- `packages/tenancy-lint/` exists with **four lint rules** (no-`CREATE TABLE`-outside-migrations; no-`BYPASSRLS`-outside-migrations-and-audit; multi-tenant table needs RLS; multi-tenant table needs tenant-isolation policy). Wired into CI Tier 1 per `.github/workflows/ci.yml`. This is the *runtime-enforced* guardrail for the per-tenant isolation rule in `security.md` §4.
- `docs/runbooks/object-store-tenant-isolation.md` exists with a LocalStack test that proves per-tenant IAM at the S3 layer. Not mock-based — real AWS API.
- ADR-0003 (`auth-tenancy`, 310 lines) is substantial.
- `gitleaks` + `ruff` + `mypy --strict` + `tsc --noEmit` all wired into CI.
- MCP server pattern enforces project-pin (jira README §1).

**Hurts (gaps):**

- **No secrets client module** — `security.md` §3 says secrets come from AWS Secrets Manager (prod) + Doppler (dev/staging) via a secrets client. No `packages/secrets-client/` or equivalent exists. **Impact on 1.1:** the Ideation agent must not read Jira credentials from `process.env`; it must go through the secrets client. **Action:** file a follow-up issue against Epic 5 (Security) before 1.1 ships; OR confirm in the Architecture ADR that the MCP router is the only consumer of the secret and the agent runtime never sees it.
- **No prompt-injection test set** — `security.md` §5 requires a regression test for the "ignore prior instructions" payload. Not visible in `packages/evals/cases/safety/`. **Impact on 1.1:** the Ideation agent reads untrusted external content (Jira ticket bodies, Slack messages). Without a safety eval set, the 1.1 eval guardrail (≤ 5 % drift, per Forge AI-59 §8) is unmeasurable. **Action:** seed at minimum 5 prompt-injection + 5 role-violation eval cases before the first design-partner run.
- **Only 1 runbook** — `security.md` §8 expects an IR runbook, a secret-leak runbook, and per-disaster runbooks. Object-store tenant isolation is the only one on disk. **Impact on 1.1:** low — the Ideation agent does not yet write to prod — but a runbook for "agent-loop run hangs" is needed before the first design-partner run.
- **`apps/agent-runtime/` security boundary is not visible** — no source code in `src/`; only `dist/` and `test/`. The allow-list gateway and JWT-rotation behaviour described in `security.md` §4 cannot be verified from source. **Action:** treat the runtime as black-box until src/ ships; pin a smoke test in the Ideation acceptance criteria.

### 9.3 Maintainability (40 / 100) — good docs, uneven build-out

**Helps:**

- 15 READMEs across 20 modules = 75 % README coverage.
- 224 TS files; 43 test files = ~19 % test-file ratio (sample-size warning — file count ≠ coverage; but the *presence* of test files is healthy).
- `.github/workflows/ci.yml` defines **four tiers** (Static → Unit → Integration → E2E/Evals) with concurrency controls. Substantially matches `devops.md` §2.
- Vitest wired into 6 modules (orchestrator, db-pool, cache-broker, db-migrator, oidc-clients, tenancy-lint). Integration configs separate (`vitest.integration.config.ts`).
- Conventional Commits via commitlint (per `coding.md` §2 pre-commit hook) — not directly verifiable but the runbook and CI shape imply it.

**Hurts (gaps):**

- Some MCP servers (`aws`, `confluence`, `figma`, `github`, `slack`) have only `package.json` + `tsconfig.json` and no visible `src/` content. **Impact on 1.1:** low (Jira only).
- No coverage gate visible in CI (`.github/workflows/ci.yml` snippet above shows no `coverage` step).
- `apps/agent-runtime/` lacks a top-level README — the README is referenced in `package.json` `files` but not visible. **Impact on 1.1:** medium; a future cold-start agent will struggle. **Action:** file a follow-up to add a README + the missing `src/` files.

---

## 10. Risks and mitigations (consolidated)

| Risk | Likelihood | Impact | Mitigation | Owner | Source |
|------|-----------|--------|-----------|-------|--------|
| Atlassian ships idea → PRD + audit inside Jira Product Discovery | Medium | High | Knowledge Layer + end-to-end SDLC closure; CISO wedge | CEO + CTO | §4.2 |
| LLM cost / latency creeps above $3 p95 | Medium | Medium | Orchestrator-enforced per-run budget; prompt cache; per-tenant token cap | CTO | §4.2, Forge AI-59 §8 |
| Cross-tenant data leak via shared MCP namespace | Low | Critical | tenancy-lint + LocalStack runbook + daily audit sample | Security (Epic 5) | §9.2, `security.md` §4 |
| Prompt-injection drives tool misuse | Medium | High | Plan-then-act, allow-list, egress proxy, safety evals | Security (Epic 5) | `security.md` §5 |
| `requirement_brief.json` schema drifts | Low | Medium | Schema-versioned; ADR-gated breaking changes | CTO | Forge AI-59 §9 |
| Board never responds to `ask_user_questions` | Medium | Medium | 7-day auto-park + CTO page | CTO | Forge AI-59 §9 |
| No secrets client yet; agent must not read secrets from env | Medium | High | File follow-up issue; OR architect the MCP router as the only secret consumer | CTO + Security | §9.2 |
| Agent-runtime is TS-only vs tech-stack.md's Python claim | Low | Low | Add ADR candidate ("TS-only in v1; Python tooling later") | CTO | §9.1 |

---

## 11. Open questions (must answer before Architecture handoff)

These are inherited from [Forge AI-59](/Forge AI/issues/Forge AI-59) §10 and the CTO resolution captured in [Forge AI-17 comment `74a3de28`](/Forge AI/issues/Forge AI-17#comment-74a3de28).

| ID | Question | Owner | Blocks | Due |
|----|----------|-------|--------|-----|
| **Q1** | Trigger semantics — real customer one-line vs Forge AI-self-dogfood? | CEO | Forge AI-60, Forge AI-61, Forge AI-62 | 2026-06-20 |
| **Q2** | MCP read-set for 1.1 — Jira only (stubbed others) vs wait for priority-1 set? | CTO | Forge AI-60 | 2026-06-18 — **CTO-resolved**: Jira + Confluence for v1; Zendesk + Slack stubbed `not_wired` until Epic 9 ships them. No brief rewrite. |
| Q3 | Worked example inclusion in the Draft PRD? | `ba-agent` / CTO | none (cosmetic) | 2026-06-25 |
| Q4 | Cost measurement basis (tokens only vs + MCP cost envelope)? | CTO | none (measurement) | 2026-06-18 |
| **Q5** | Owner reassignment for 1.2-1.4 — one-shot CEO action vs staged? | CEO | none (process) | 2026-06-20 |

**New open questions raised by this memo:**

| ID | Question | Owner | Blocks | Due |
|----|----------|-------|--------|-----|
| **Q6** | Confirm the secrets-ownership path: does the Ideation agent ever touch raw credentials, or only the MCP router? If the former, file a secrets-client ticket before 1.1 ships. | CTO + Security (Epic 5) | Architecture ADR | 2026-06-25 |
| **Q7** | Seed the safety eval set (5 prompt-injection + 5 role-violation cases) before the first design-partner run. | `ba-agent` (Ideation) + future `security-agent` | First design-partner run | 2026-07-15 |
| **Q8** | Add an ADR candidate resolving the `apps/agent-runtime/` TS-vs-Python divergence. | CTO | Knowledge Layer v1.0 sign-off | 2026-07-01 |

---

## 12. Recommendation — **GO** with three conditions

1. **Q1 + Q5 must close before 1.2 → 1.3 hand-off** — the trigger-semantics answer shapes whether the Epic in 1.3 targets the Forge AI-self-dogfood scenario or the customer scenario, and the reassignment question shapes whether 1.3 auto-resumes. Both are CEO-owned and due 2026-06-20.
2. **Q6 (secrets ownership) must close before Architecture handoff** — without this, the 1.1 acceptance criteria in `security.md` §5 cannot be tested.
3. **The composite tech-debt score is 43 / 100**, below the 70 escalation threshold. **No Security agent escalation is required** for Forge AI-60. The Security hand-off items (Q6, Q7, the secrets-client gap, the prompt-injection eval set) are tracked above and will be re-scored when Epic 5 (Security) is unblocked.

**Pivot signal:** if Atlassian announces an "Idea → PRD + audit" feature inside Jira Product Discovery with a 2026 ship date, re-run this memo and assess the CISO wedge vs the install-base density. Until then, the wedge is uncontested and the window is open.

**Next sub-goal on success:** [Forge AI-61](/Forge AI/issues/Forge AI-61) (Sub-goal 1.3 — Epic generator) is currently `blocked` on Forge AI-60. On this memo's sign-off, Forge AI-61 auto-resumes (per the `blockedBy` linkage).

---

## 13. Related

- Draft PRD — [Forge AI-59](/Forge AI/issues/Forge AI-59) (Sub-goal 1.1)
- Parent epic — [Forge AI-17](/Forge AI/issues/Forge AI-17) (Epic 1 — Forge Ideation Agent)
- BMad workflow — [Forge AI-15](/Forge AI/issues/Forge AI-15) (done)
- Plan of record — [Forge AI-15 plan](/Forge AI/issues/Forge AI-15#document-plan)
- Next sub-goal — [Forge AI-61](/Forge AI/issues/Forge AI-61) (Sub-goal 1.3)
- Companion score — [`tech_debt_score.json`](./tech_debt_score.json)
- Workspace memory — [`architecture.md`](../../../workspace/memory/architecture.md), [`security.md`](../../../workspace/memory/security.md), [`coding.md`](../../../workspace/memory/coding.md), [`devops.md`](../../../workspace/memory/devops.md)
- Workspace PRD template — [`workspace/project/PRD.md`](../../../workspace/project/PRD.md)
- Workspace tech-stack — [`workspace/project/tech-stack.md`](../../../workspace/project/tech-stack.md)

---

**Change log**

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v1.0 | 2026-06-17 | BA (`99b34c5d-87d4-42a0-a66a-c65a916aeeec`) | Initial feasibility memo + tech-debt assessment. GO recommendation with three conditions. |
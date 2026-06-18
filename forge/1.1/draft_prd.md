# Draft PRD — Forge Ideation Agent · Requirement Ingestion (Sub-goal 1.1)

**Status:** v0.2 draft (2026-06-17)
**Stage:** Ideation (sub-goal 1.1 of [FORA-17](/FORA/issues/FORA-17))
**Owner:** `ba-agent` (Hire #3, BMAD PM + BA, reports to CTO)
**Source one-line prompt:** "Turn a one-line product idea into a board-approved PRD + Jira Epic." (parent Epic [FORA-17](/FORA/issues/FORA-17) description)
**Related:**

- Platform PRD template — [workspace/project/PRD.md](../../../workspace/project/PRD.md)
- Parent Epic — [FORA-17](/FORA/issues/FORA-17) "Forge Ideation Agent"
- Sibling sub-goals — [FORA-60](/FORA/issues/FORA-60) (1.2), [FORA-61](/FORA/issues/FORA-61) (1.3), [FORA-62](/FORA/issues/FORA-62) (1.4)
- Intermediate artifact — [requirement_brief.json](./requirement_brief.json)
- CEO scope delegation — [comment `3426cc84`](/FORA/issues/FORA-17#comment-3426cc84-2599-4f7c-adc3-78a85998e03f) on [FORA-17](/FORA/issues/FORA-17)
- Handoff to ba-agent — [comment `74bade6e`](/FORA/issues/FORA-59#comment-74bade6e-8e21-4a9b-8ea2-e3e577e1da45) on [FORA-59](/FORA/issues/FORA-59)

> **This is a Draft PRD.** It is the output of sub-goal 1.1 (Requirement Ingestion). It will not advance to sub-goal 1.2 (Market & tech-debt analysis) until the blocking ambiguity questions in §10 are resolved by the board. The stage gate is enforced by the Master Orchestrator, not by a human remembering to check.

---

## 1. Vision

The Forge Ideation Agent's **Requirement Ingestion** sub-capability is the front door of FORA. A user supplies a one-line product idea; the agent returns a structured `requirement_brief.json` and a Draft PRD aligned to the FORA PRD template, grounded in the customer's Knowledge Layer and the MCP-fed context the customer's tenant allows. The Draft PRD is honest about what it knows, what it inferred, and what it is still missing.

This sub-capability is the first trust-building interaction the customer has with FORA. If the Draft PRD is vague, the customer assumes the rest of the platform is vague. If the Draft PRD is precise, structured, and clearly scoped, the customer trusts the downstream stages (Architect, Dev, QA, Security, DevOps, Docs) to do their job.

## 2. Problem

The path from "one-line idea" to "board-approved PRD" is the single most expensive hand-off in any engineering org. It is also the hand-off that loses the most context.

- **Today, without FORA** — the idea lives in a Slack message, a Notion page, a half-finished Google Doc, or a Jira ticket that was created before anyone knew what the ticket was for.
- **The PM writes the PRD from scratch** with no grounding in the customer's conventions, existing epics, prior ADRs, or the standards they have already committed to.
- **The PRD drifts from the conversation.** The conversation drifts from the PRD. The eventual Jira epic references neither.
- **No audit trail records which inputs shaped which conclusions.** When the CTO asks "why did we ship this," the answer is "because the PM said so."
- **Existing AI tools do not close this gap.** Code-review bots do not see the PRD. AI pair programmers do not see the ADR. Project-management AI does not see the PR. None of them carries the audit trail a CISO will demand.

**What Requirement Ingestion specifically fixes:**

- A machine-readable intermediate (`requirement_brief.json`) that survives every subsequent stage and is the contract between them.
- A Draft PRD that is grounded in the customer's Knowledge Layer, not in the LLM's priors.
- A structured ambiguity list, surfaced to the board, before any downstream work burns budget on a guess.

## 3. Target customer

### Primary ICP (initial design partners)

- Series-B-to-Series-D SaaS companies with 50–500 engineers.
- An engineering org that has outgrown Slack-and-spreadsheets but is not yet ready for a Platform Engineering team.
- A CISO who has mandated "every change must be auditable" but does not have the headcount to enforce it.
- A CTO who has bought one AI coding tool and is already tired of the "where is the audit" question.

### Primary persona — the Product Manager (the one who triggers the run)

- At a Series-B–Series-D SaaS company, 50–500 engineers.
- Drops a one-paragraph feature idea in a Slack channel or in the Forge console's "New idea" form.
- Expects a Draft PRD back in under 10 minutes, with the structure already filled in.
- Will refine ambiguity but will not author structure. Time-to-first-draft is the value.

### Secondary personas (consumers of the Draft PRD)

- **Engineering Lead** — needs the Draft PRD to be the right shape for the Architect stage to pick up without rework. Cares about the success metrics, the non-goals, and the open questions.
- **CTO / VP Eng** — needs the Draft PRD to surface ambiguity explicitly, so they can resolve it before Architect work burns budget. This is the persona that signs off on the stage gate.
- **Customer CISO** — needs every step the agent took to be auditable, including which Knowledge Layer files it read and which MCP calls it made. Reads the audit log, not the PRD.

### Out of scope (v1, FORA-wide)

- **Pre-Series-A startups** — they do not have the SDLC pain yet.
- **Fortune 500 with bespoke compliance regimes** (FedRAMP, HIPAA, PCI-DSS) — they are roadmap, not v1.
- **Non-software engineering orgs** — civil engineering, biotech lab work, marketing campaigns, hiring plans, M&A diligence. The model is wrong.
- **End customers of the customer's product** — Requirement Ingestion is internal to the customer's engineering org; it is not a customer-facing surface.

## 4. Core value propositions

| Value prop | What it replaces | How Requirement Ingestion delivers |
| --- | --- | --- |
| **Time-to-Draft-PRD under 10 minutes** | A two-day blank-page exercise | Knowledge-Layer-grounded template, LLM-assisted drafting, no human in the loop before the artifact lands |
| **One source of truth per fact** | Spreadsheet of spreadsheets | `requirement_brief.json` is the versioned contract every downstream stage reads from |
| **Auditable AI actions** | "What did the bot do?" | Every Knowledge Layer file read, every MCP call, every prompt/response pair is captured in the audit log under the run's `run_id` |
| **Staged workflow with real gates** | Jira status fields nobody updates | Master Orchestrator enforces the gate; the Draft PRD cannot pass to 1.2 until the board clears `ask_user_questions` |
| **Cost transparency per run** | A surprise LLM bill | Token + cost ceiling per sub-goal ($0.50 median / $5.00 hard ceiling for 1.1), recorded in the run comment |
| **MCP-native integration (extensible)** | Custom one-off integrations | First-class MCP server per tool, per tenant; sub-goal 1.1 ships Jira-only for Q3 2026 and stubs the rest |

## 5. Product surface (what changes in FORA as a result of 1.1)

### 5.1 The Ideation trigger

- A user-supplied one-line prompt. Source: Slack message, Forge console form, or direct API call. Receives `received_at` and `verbatim` provenance.
- A `trigger_token` is generated; every downstream artefact (the brief, the Draft PRD, the audit log) is keyed to it.

### 5.2 The Knowledge Layer read surface (v1 allow-list)

- `workspace/project/PRD.md` (the platform PRD template)
- `workspace/project/roadmap.md`
- `workspace/project/tech-stack.md`
- `workspace/customer/standards.md`
- `workspace/customer/conventions.md`
- `workspace/customer/glossary.md`
- `workspace/memory/ideation.md` (the stage playbook, when it exists)
- The allow-list is enforced at the **runtime layer**, not at the agent prompt. A prompt-injection cannot widen the read-set.

### 5.3 The MCP read surface (priority-1 only for 1.1)

- **Jira** — existing epics, stories, dependencies, status. Read scope only. The MCP server is the template every other priority-1 MCP follows.
- **Zendesk / Slack / Confluence** — stubbed with a `not_wired` JSON-Lines response and a fallback note. The schema does not break when they come online in Q4 2026.
- **SonarQube / Figma / AWS** — out of scope for 1.1.

### 5.4 The two artefacts the sub-goal produces

- `requirement_brief.json` — the intermediate, machine-readable contract. Schema-versioned (`schema_version: "1.0"`). Attached to the issue. Consumed by sub-goals 1.2, 1.3, 1.4.
- `draft_prd.md` — the Draft PRD, aligned to the FORA PRD template. Attached to the issue. Reviewed by the board, then by the PM, then by the Architect.
- An `epic_stub` placeholder — the Jira Epic shape that sub-goal 1.3 fills. Not pushed to Jira in 1.1.

## 6. Key user journeys

### 6.1 The "feature from a Slack message" journey (this sub-goal's slice)

1. PM drops a one-paragraph feature idea in a Slack channel.
2. The Master Orchestrator wakes the Ideation sub-agent. **Sub-goal 1.1 runs here.**
3. The agent normalizes the prompt, reads the Knowledge Layer allow-list, calls Jira MCP for context, drafts the brief + PRD, surfaces ambiguity.
4. The CTO / PM resolves the `ask_user_questions` interaction on the issue. The gate clears.
5. Sub-goal 1.2 (market + tech-debt) starts; then 1.3 (epic + stories); then 1.4 (Jira sync).
6. The journey continues in 1.3 — Epic in Jira — and is owned by sub-goal 1.3, not 1.1.

### 6.2 The "audit" journey (this sub-goal's slice)

1. The customer CISO opens the audit view in the Forge console.
2. Filters by `tenant_id = their-org`, `run_id = <the 1.1 run>`, `stage = ideation`.
3. Sees every Knowledge Layer file read (with `content_hash`), every Jira MCP call, every prompt/response pair (when `FORA_LOG_LLM=1`).
4. Exports the filtered view as a SOC 2-friendly artefact.

### 6.3 The "ambiguity" journey (this sub-goal's slice)

1. The agent drafts the PRD. Every section it could not fill is marked `partial` and paired with an `open_question_id`.
2. The agent posts an `ask_user_questions` interaction on the issue with the **blocking** ambiguity questions.
3. The Master Orchestrator parks the run in `in_review`; the issue status is `in_review`.
4. The board / PM answers the questions. The interaction resolves; the run resumes.
5. On a 7-day timeout, the issue auto-returns to `in_progress` with a "no board response" comment, and the CTO is paged.

## 7. Non-goals (sub-goal 1.1)

- **Writing to the Knowledge Layer.** Per the platform PRD §5.3, v1 is "humans write, agents read." Requirement Ingestion reads; it does not write. A future ticket (out of scope for v1) flips this.
- **Calling tools outside the v1 MCP allow-list.** Slack, Zendesk, Confluence, SonarQube, Figma MCPs are not in the Q3 2026 MCP scope (see [roadmap.md §3.1](../../../workspace/project/roadmap.md) and [tech-stack.md §10](../../../workspace/project/tech-stack.md)). For sub-goal 1.1, MCP-fed context is Jira only. The other tools land in Q4 2026.
- **Generating the Jira Epic or stories.** That is sub-goal 1.3 ([FORA-61](/FORA/issues/FORA-61)). The output of 1.1 is an `epic_stub` placeholder, not a real Epic.
- **Pushing anything to Jira.** That is sub-goal 1.4 ([FORA-62](/FORA/issues/FORA-62)). Requirement Ingestion reads from Jira for context; it does not write.
- **Auto-resolving ambiguity.** If the agent could guess correctly, it would not be ambiguous. The agent's job is to surface, not to paper over. The board's job is to resolve.
- **Replacing the PM.** Requirement Ingestion turns a one-line idea into a structured draft. The PM still owns the judgment calls, the customer interviews, and the final wording.
- **Cross-tenant reads.** A Forge Ideation run for tenant A must never read tenant B's Knowledge Layer or MCP data. Enforced by the Master Orchestrator's per-tenant allow-list; daily audit sample.

## 8. Success metrics (north-star and guardrails, with number + baseline + target)

### North star

**% of Draft PRDs that pass structural lint on the first try and are advanced to the Architect stage without rework.**

- **Baseline:** 0 % (no runs yet — first design partner scenario in Q3 2026).
- **Target:** ≥ 80 % by end of Q3 2026; ≥ 90 % by end of Q4 2026. A "lint pass" means every required section is present and non-empty, every section has a `data_source` annotation, and every `partial` section is paired with an `open_question_id`.

### Guardrails

| Guardrail | Baseline | Target | Hard ceiling | Source / measurement |
| --- | --- | --- | --- | --- |
| **Time-to-Draft-PRD (p50)** | n/a (first runs) | ≤ 5 min | ≤ 10 min | Wall-clock from prompt `received_at` to artefact attached. Anything slower is a token-budget or read-set bloat bug. |
| **Time-to-Draft-PRD (p95)** | n/a (first runs) | ≤ 10 min | ≤ 20 min | Same. |
| **Cost per run (p50)** | n/a (first runs) | ≤ $0.50 | n/a | Token + dollar estimate recorded in the run comment. |
| **Cost per run (p95)** | n/a (first runs) | ≤ $3.00 | n/a | Same. |
| **Cost per run (hard ceiling)** | n/a (first runs) | n/a | **$5.00** | Above the ceiling, the run halts and the CTO is paged. Well below the platform-wide $50 cap. |
| **Ambiguity surfacing rate** | 0 % (no runs) | ≥ 95 % of inferred sections paired with an `open_question_id` | 100 % | Lint step: every `partial` section must have an `open_question_id` that also appears in the `ask_user_questions` interaction. |
| **Knowledge Layer read-set compliance** | 100 % (allow-list enforced at runtime) | 100 % | < 100 % is a P0 | A read outside the allow-list is a P0 audit finding. |
| **Tenant isolation** | 100 % (per-tenant namespace enforced) | 100 % | < 100 % is a P0 | Every read and MCP call carries the correct `tenant_id`. |
| **Audit-log completeness** | 100 % (per the platform PRD §8) | 100 % | < 100 % is a P0 | Every Knowledge Layer file read, every MCP call, every prompt/response pair (when `FORA_LOG_LLM=1`) is captured. Daily sample audit. |
| **Open-question close rate within 7 days** | n/a (first runs) | ≥ 90 % | < 70 % is a P3 | If the board does not respond in 7 days, the run auto-park + CTO page. |

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Agent reads outside the Knowledge Layer allow-list due to prompt injection | Medium | High | Allow-list enforced at the runtime layer; prompt-injection cannot widen it. Per [workspace/memory/security.md §5](../../../workspace/memory/security.md). |
| Agent hallucinates a section rather than marking it `partial` | Medium | High | Lint step: every section must have a `data_source`. Sections without a source are hard errors. Eval set covers the "guess vs. surface" failure mode. |
| Cross-tenant read via shared Jira MCP namespace | Low | Critical | Per-tenant MCP namespace enforced by the MCP server framework; daily audit sample. Per [tech-stack.md §10](../../../workspace/project/tech-stack.md). |
| LLM cost explosion on a long prompt | Low | Medium | Per-run budget enforced by the Master Orchestrator; $5.00 hard ceiling for this sub-goal. |
| Board never responds to `ask_user_questions`; the run parks forever | Medium | Medium | A 7-day timeout on the `ask_user_questions` interaction. On timeout, the issue is auto-returned to `in_progress` with a "no board response" comment, and the CTO is paged. |
| Jira MCP outage blocks the run | Medium | Low | Degraded-mode plan: the run proceeds with Knowledge Layer only, and the absence of Jira context is logged as a degraded-mode marker on the run. |
| The `requirement_brief.json` schema drifts between iterations | Low | Medium | Schema versioned (`schema_version: "1.0"`); every change requires an ADR; downstream stages pin to a specific version. |
| The "first design partner" scenario is too narrow to validate the agent | Medium | Medium | Q3 2026 milestone #7: "First design partner runs a real feature end-to-end." The schema is designed for that scenario, not for FORA-internal dogfooding. |

## 10. Open questions (must answer before sub-goal 1.1 can be `done`)

These are surfaced in the `ask_user_questions` interaction on [FORA-59](/FORA/issues/FORA-59). The Master Orchestrator will not advance to sub-goal 1.2 ([FORA-60](/FORA/issues/FORA-60)) until the **blocking** ones resolve.

1. **Q1 (blocking) — Trigger semantics for the first iteration.** Is the trigger a real customer one-line idea, or a self-bootstrapping dogfood where FORA is the product being specced? The Draft PRD scope flips on the answer. **Owner:** CEO. **Blocks:** [FORA-60](/FORA/issues/FORA-60) (1.2) and all of 1.3, 1.4. **Due by:** 2026-06-20.
2. **Q2 (blocking) — MCP read-set for sub-goal 1.1.** PRD says Jira/Zendesk/Slack/Confluence; tech-stack priority-1 is Jira only for Q3 2026. Does Requirement Ingestion proceed with Jira-only and stub the others, or does it wait for the priority-1 set to be wired? **Owner:** CTO. **Blocks:** [FORA-60](/FORA/issues/FORA-60) (1.2) — the market + tech-debt analysis depends on whether Zendesk support themes are part of the input set. **Due by:** 2026-06-18.
3. **Q3 (non-blocking) — Worked example inclusion.** Should the Draft PRD ship with a "first design partner scenario" worked example, or stay template-clean and push that to a separate example artifact? **Owner:** PM (`ba-agent`) or CTO. **Blocks:** none (cosmetic). **Due by:** 2026-06-25.
4. **Q4 (non-blocking) — Cost measurement basis.** Is the $0.50 median / $5.00 hard ceiling measured in input+output tokens only, or does it also include the MCP tool-call cost envelope? **Owner:** CTO. **Blocks:** none (measurement detail). **Due by:** 2026-06-18.
5. **Q5 (open, raised by `ba-agent` review) — Owner reassignment for sub-goals 1.2-1.4.** The current CTO scope comment says ba-agent will take 1.2-1.4 only after 1.1 is `done`. Should the reassignment be a one-shot CEO action now (assign 1.2-1.4 to `ba-agent` at creation time so the gate auto-resumes them) or staged manually after each 1.x is `done`? **Owner:** CEO. **Blocks:** none (process). **Due by:** 2026-06-20.

## 11. Related

- The platform this serves — [workspace/project/PRD.md](../../../workspace/project/PRD.md)
- The roadmap that sequences this — [workspace/project/roadmap.md](../../../workspace/project/roadmap.md)
- The tech stack this runs on — [workspace/project/tech-stack.md](../../../workspace/project/tech-stack.md)
- The standards this inherits — [workspace/customer/standards.md](../../../workspace/customer/standards.md)
- The conventions this follows — [workspace/customer/conventions.md](../../../workspace/customer/conventions.md)
- The vocabulary this uses — [workspace/customer/glossary.md](../../../workspace/customer/glossary.md)
- The intermediate contract — [requirement_brief.json](./requirement_brief.json)
- The next sub-goal — [FORA-60](/FORA/issues/FORA-60) "Sub-goal 1.2 — Market & tech-debt analysis" (currently `blocked` on this issue)
- The sibling sub-goals — [FORA-61](/FORA/issues/FORA-61) (1.3 Epic + story generator), [FORA-62](/FORA/issues/FORA-62) (1.4 Jira sync)
- The Master Orchestrator's stage-gate logic — [memory/architecture.md §3](../../../workspace/memory/architecture.md)
- The audit-log completeness bar — [memory/security.md §7](../../../workspace/memory/security.md)
- The prompt-injection defence — [memory/security.md §5](../../../workspace/memory/security.md)

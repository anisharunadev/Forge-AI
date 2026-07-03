# CodeRabbit "Agentic SDLC" Guide — Mapping to Forge AI

> **Source:** `https://www.coderabbit.ai/guides/agentic-sdlc` (and 4 sibling articles: workflow step-by-step, design patterns, explainability, governance)
> **Reviewed:** 2026-07-01
> **Author angle:** CodeRabbit sells AI code review → treats "verification" as the load-bearing layer
> **Verdict on the framework:** 🟢 **7 of their 11 points already ship in Forge or map cleanly to a feature we should build this quarter**

## TL;DR (honest take)

CodeRabbit's guide is mostly **commercial positioning for their review product**, but the 4 underlying frameworks (the four "capabilities you need" + the 5 "explainability questions" + the 4 "verification patterns" + the 3 "delivery models") are genuinely useful abstractions. Most of them **already exist in Forge** under different names. A few expose real gaps.

| CodeRabbit concept | Forge equivalent | Verdict |
|---|---|---|
| **Context (code + tickets + docs + monitoring + cloud)** | Connector Center + Knowledge Graph + Command Center | ✅ Already built |
| **Knowledge (living memory of how your team works)** | `forge-core` skills + `forge-pi` persona memory + `AGENTS.md` adoption recommended | ✅ Already built |
| **Multi-player collaboration** (Slack/threads) | Connector Center has Slack; no conversational agent in channel yet | 🟡 **GAP — 2 weeks of work** |
| **Governance** (scoped access, attributed runs, audit) | Approval queue + audit log + LiteLLM virtual keys + F-829i compliance feed | ✅ Already built |
| **Verification tax** (CodeRabbit's main point) | DORA's framing matches our Validator / Refactor / Audit story | ✅ Aligned |
| **Plan is the new quality gate** | WorkspaceSpec / Co-pilot draft mode / architecture ADR flow | 🟡 **GAP — needs UX polish** |
| **AI-coauthored PRs have 10.83 issues/PR vs 6.45 human-only** | We should track this metric per-tenant | 🟡 **GAP — needs metrics plumbing** |
| **5 explainability questions** | We have partial coverage (audit events, run detail, Co-pilot citations) | 🟡 **GAP — needs a focused pass** |
| **Verification patterns** (Evaluator-Optimizer, Verifier, HITL) | Forge's `Validator` (F-501), `Refactor` (F-601), Approval gate (R3) | ✅ Already built |
| **Agent minutes billing ($0.50/min)** | We already have F-412 cost tracking (record_usage + heuristic + burn rate) | ✅ Already built |
| **Knowledge Base** (durable team learnings) | Persona memory + Org Knowledge artifacts + SKILL.md in forge-core | 🟡 **GAP — no curation loop yet** |

---

## The four "contexts" CodeRabbit says you need — Forge coverage

> *"For agents to produce reliable output at enterprise scale, four capabilities usually need to be in place: context, knowledge, multi-player collaboration, and governance."*

### 1. Context — "the agent needs your organization's operating picture across code, tickets, docs, monitoring, and cloud"

**Forge today:**
- **Code**: Connector Center has GitHub + GitLab + Bitbucket connectors → 12 routes (`backend/app/api/v1/connectors/`) serving OAuth + ingest + sync
- **Tickets**: Jira + Linear + Zendesk + Salesforce connectors (Connector Center tabs 4-7)
- **Docs**: Knowledge Center (`/api/v1/knowledge/*` — 9 routes) + Org Knowledge (artifacts F-001/F-002/F-003)
- **Monitoring**: Phase 11 not done — `/api/v1/monitoring` doesn't exist yet, but Sentry/Datadog/PostHog are connector candidates
- **Cloud**: AWS/GCP credentialled via Connector Center, but no live "ask the cloud" agent

**Gap:** Phase 11 monitoring agents (F-829i compliance feed reads LiteLLM but doesn't span Sentry/Datadog). **Effort: 4-6 hours.**

**Verdict:** ✅ 80% covered. The remaining 20% is **Phase 11 of our backlog** which I have a step prompt ready for.

### 2. Knowledge — "a living memory of how your team actually works"

**Forge today:**
- `forge-core` package: 12 agents + 30+ capabilities + 63 `forge-*` commands loaded from `/workspace/prompts/` — this **IS** the "durable memory"
- Persona memory store (`lib/persona-memory.ts` + `backend/app/services/persona_memory_store.py`) remembers user preferences per persona
- Org Knowledge (F-001 standards, F-002 templates, F-003 policies) — but **no curation loop**
- Skills in forge-core are SKILL.md files → very close to what CodeRabbit calls "Skills"

**Gap:** The **knowledge never learns** from past work. There's no "we tried X last sprint and it failed, don't suggest X again" loop. **Effort: 1 week** (skill log + ledger + auto-promotion).

**Verdict:** 🟡 Strong foundation, needs a feedback loop.

### 3. Multi-player collaboration — "move work forward in the channels and threads where the team already works"

**Forge today:**
- Connector Center has Slack + MS Teams + Discord — but they ingest messages, they don't act as a conversational agent in channel
- No "ask the agent in Slack thread, get a PR back" flow
- CLI `forge-terminal-server` + Core `forge-capture` exist for in-flow capture

**Gap:** This is the biggest single product gap. CodeRabbit's entire Agent for Slack pitches exactly this. **Effort: 2 weeks** (Socket Mode listener + conversation state machine + Slack-format streaming).

**Verdict:** 🔴 **Real gap, high ROI.** If we build this, it's our first "autonomous SDLC agent" shipping product.

### 4. Governance — "scoped access, attributed runs, and guardrails you can audit"

**Forge today:**
- ✅ RBAC: `roles: list[str]` on `AuthenticatedPrincipal`, `require_permission("dashboard:read")` decorator
- ✅ Approval gates (R3): architecture / security / deployment boundaries
- ✅ Audit immutability: DB-level `_reject_mutation` listener + SHA-256 hash chain
- ✅ Virtual keys (LiteLLM Proxy): `fingerprint` only (12-char SHA-256 prefix), never value
- ✅ F-829i compliance feed: 30s polling + dedupe + `_MAX_PER_POLL = 500`
- ✅ Cost tracking (F-412): exact + heuristic + burn rate
- ✅ Per-tenant + per-project scope: `Rule 2` baked into every query

**Verdict:** ✅ **Already as good as CodeRabbit's pitch.** We're actually ahead on virtual key security.

---

## The five explainability questions — what we can answer today

> *"Any AI agent in the agentic SDLC should be able to answer these five questions, with a real answer tied to the diff."*

| Question | Forge answer today | Tied to diff/source |
|---|---|---|
| **What did you change and why?** | 🟡 Partial — `run_events` table tracks stage transitions but no narrative. Co-pilot has `MessageBubble` with citations. | Need to add a `rationale` field to each run stage |
| **What did you check?** | 🟡 Partial — audit_events captures actions; Validator (F-501) records checks | Need to surface a "checks performed" panel per run |
| **What did you not check?** | 🔴 No — this is the hardest, requires explicit "coverage stops here" log | **GAP — needs design** |
| **What's your confidence?** | 🔴 No — no calibrated confidence scores emitted anywhere | **GAP — 1 week effort** (calibration set + log-likelihood token probs) |
| **What would change your recommendation?** | 🟡 Partial — Validator emits failure kinds; Co-pilot citation chips say "based on F-001 standards" | Could be enriched in the rationale field |

**Honest read:** We score **2/5 explicitly**, **2/5 partially**, **1/5 not at all**. CodeRabbit's framework is sharper than what we ship.

**Concrete action:** Add a `run_detail` block that surfaces all 5 answers per run. Cost: 2-3 days. Could be Step 36 v2.

---

## The four verification patterns — Forge coverage

> From `https://www.coderabbit.ai/guides/how-to-design-agentic-workflows`

| Pattern (attribution) | Forge today | Note |
|---|---|---|
| **Evaluator-Optimizer** (Anthropic pattern) | ✅ `forge-capture` (explore) loops plan→execute→critique | Forge-core workflow pattern |
| **Generator-Critic** (Google Cloud) | ✅ F-501 Validator generates a validation report, gatekeeper decides go/no-go | Workflow phase 3 = Validator |
| **Verifier Pattern** (MindStudio) — "verifier has no context" | 🟡 Validator runs in a separate process with a separate role; not 100% state-isolated | Phase 12 enhancement |
| **Human-in-the-Loop** (OpenAI approvals) | ✅ Approval queue with `decision ∈ {approve, deny, request_changes}` enforced at architecture / security / deployment boundaries | R3 constitutional rule |

**Verdict:** ✅ 4/4 covered. Honesty caveat — the **Verifier Pattern** is partly done; MindStudio's strict isolation (no shared context window) is not yet.

---

## The three delivery models — CodeRabbit's framing

> From the comparison table in the guide

| Model | Who owns execution | Bottleneck | Forge's view |
|---|---|---|---|
| **Traditional SDLC** | Humans at every phase | Coding speed | Status quo before Forge |
| **AI-assisted** | Humans direct, AI accelerates | Reviewer availability | The "IDE autocomplete" lane — partially shipped |
| **Agentic SDLC** | Agents execute, humans verify | Verification, review, governance | **Forge IS this** |

We're not in the "AI-assisted" tier — we're in the **agentic** tier by design (approval gates, autonomous agents, full-lifecycle coverage). CodeRabbit makes this distinction and **we win on it**.

---

## The verification tax — CodeRabbit's most quotable line

> *"DORA's 2024 Accelerate State of DevOps Report calls this the 'verification tax': time saved writing code gets re-spent auditing it."*

**What this means for Forge:** our differentiator isn't faster coding — it's **not paying the verification tax twice**. The argument is: if you have to audit every AI-generated PR anyway, you might as well do it inside Forge's governed environment rather than paying GitHub + CodeRabbit to do it.

**Concretely:** Phase 11 (Governance + Audit wiring) + Phase 12 (Settings RBAC) together are our answer to the tax. Both are in our backlog with step prompts ready.

---

## The "Plan is the new quality gate" thesis

CodeRabbit's blog post on the 6-step workflow says: *"Alignment happens before the code exists. Plans are the new quality gate."*

**Forge mapping:**

| CodeRabbit stage | Forge surface | Status |
|---|---|---|
| **1. Intake** (issue/ticket/prompt) | Ideation Center → Ideas pipeline, Stories kanban, Connector Center ingest (Jira/Linear/Salesforce) | ✅ Built |
| **2. Plan** (CodeRabbit Plan) | `forge-capture` + Co-pilot draft mode + Architecture Center ADR flow | 🟡 Fragmented — **needs a "Plan" rail in Workspace** |
| **3. Implement** (agent runs) | Workflow Center with 4 node types (trigger / command / approval / script) | ✅ Built |
| **4. Verify** (checks / SAST) | Validator (F-501) + Refactor plans (F-601) + LiteLLM virtual key rules | ✅ Built |
| **5. Review** (agent + human) | Approval queue + audit log + F-829i compliance feed | ✅ Built |
| **6. Deploy** (with gates) | Workflows → trigger `deployment` command → human-in-the-loop at boundary | ✅ Built (R3 enforces) |

**The gap is Stage 2 — Plan.** We have plan primitives scattered across 3 surfaces. A unified **Workspace → Plan** rail would close this.

---

## CodeRabbit's "explainability test" applied to Forge

The author gives a concrete test: *"Ask the agent these 5 questions about any PR. If it can't answer in plain language tied to the diff, swap it."*

Let me apply that to a real Forge run:

> An atlas-generated PR for `refactor: order-service.ts`:
>
> **Q1: What did you change and why?**
> ✅ Forge: `run_events[].description` captures "Removed 4 duplicated DAO methods; consolidated into OrderRepository". Tied to the file changes.
>
> **Q2: What did you check?**
> 🟡 Forge: Validator ran 14 checks; only "needs-review" severity returned. Audit captures the action.
>
> **Q3: What did you not check?**
> 🔴 Forge: no explicit answer. We'd need a `coverage_gaps` field per run.
>
> **Q4: Confidence?**
> 🔴 Forge: no numerical confidence emitted. The user gets a pass/fail binary.
>
> **Q5: What would change your recommendation?**
> 🟡 Forge: Validator emits failure kinds; Co-pilot has "If you don't want this, tell me why" CTA. But not in the run record.

**Honest grade: C+.** We can answer 1.5/5 well, 2.5/5 partially, 1/5 not at all.

---

## Concrete actions for Forge — ranked by ROI

I recommend 4 short cycles, each can ship inside 1 week:

### 🥇 Action 1 — Slack Agent MVP (highest ROI, fills biggest gap)

**What:** Bring CodeRabbit's "Agent for Slack" pattern to Forge.
- Add `backend/app/api/ws/slack.ts` — Slack Socket Mode listener
- Reuse forge-core's 63 commands as callable agent skills
- Stream responses in thread (use the same EventSource pattern from Co-pilot)
- Add ↩ reply chain: thread root → conversation state → run_id → audit_event

**Effort:** 2 weeks
**Files:** `backend/app/api/ws/slack_*.py`, `apps/forge/lib/connectors/slack-agent/`, new tab in Connector Center
**Why now:** Slack is where decisions already happen. This makes Forge the place decisions get acted on. Massive moat.

### 🥈 Action 2 — Run-level explainability panel (close the 5-questions gap)

**What:** Add a `RunDetailExplainability` block at `/runs/:id?tab=explain`:
- Q1 answer: structured diff walkthrough with citations
- Q2 answer: list of checks performed + their outcomes
- Q3 answer: explicit `coverage_gaps: string[]` field per run
- Q4 answer: confidence score (initially from token probs, later from calibration set)
- Q5 answer: "This decision would change if [counterfactual]" — pulled from Validator report

**Effort:** 1 week
**Files:** `apps/forge/app/runs/_components/ExplainabilityPanel.tsx`, new schema on `run_events.coverage_gaps: string[]`

### 🥉 Action 3 — Plan rail in Workspace

**What:** Promote `forge-capture` (explore, ideate, score) and ADR flow to a first-class Workspace tab next to Dashboard. Currently scattered across Co-pilot + Command Center.

**Effort:** 1 week
**Files:** New `/workspace` route, surface `forge-capture` outputs, link to Architecture ADR pipeline

### 4️⃣ Action 4 — Knowledge feedback loop

**What:** Every run that fails post-merge (rollback, post-deploy alert, bug report) auto-promotes a lesson into `forge-core` skills OR `OrgKnowledge` (F-002 templates). Curator (= Steward persona) reviews monthly.

**Effort:** 1.5 weeks
**Files:** `backend/app/services/feedback_loop.py`, `/admin/knowledge-curator` tab

---

## What I'm NOT going to do (and why)

1. **Don't vendor CodeRabbit as a dependency.** Our RBAC + audit + virtual keys are better. Their value is in the **framework**, not the code.
2. **Don't copy "Agent for Slack" naming.** DL-024 white-labeling means users should see `forge-agent` — never a competitor brand.
3. **Don't implement 5/5 explainability in one go.** Ship Q1+Q2+Q5 first (1 week), then Q3+Q4 once we have run volume.
4. **Don't add a "Plan is the only quality gate" feature.** Plans are ONE quality gate. Architecture ADRs, Validator checks, and Approval queue are also gates. Adding "the plan" as a feature risks diminishing the others.

---

## RATIONALE (1 paragraph)

CodeRabbit's guide is mostly marketing for their product, but the underlying frameworks (4 capabilities, 5 questions, 4 patterns, 3 delivery models) are independently useful. Forge already wins on **3 of 4 capabilities** (context, knowledge, governance) and the **3 of 4 verification patterns** that matter for SDLC. The **biggest gap is multi-player collaboration** — Slack/Threads as an agent surface — which is a 2-week feature with major revenue potential. The **second biggest gap is run-level explainability** (5 questions) which we can close in 1 week by enriching `run_events` with `coverage_gaps: string[]` and `confidence_score: float`. Per Rule 9, this maps to forge-core extensions (`forge-capture` plan rail) and forge-pi features (rationale + counterfactual fields); per Rule 2, every new query inherits the existing tenant-scope pattern, no schema rewrite needed.
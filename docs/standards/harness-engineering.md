# Standard: Harness Engineering

> **Status:** ✅ Canonical — every Forge agent runs inside this harness
> **Doc owner:** Platform team
> **Source of truth:** `backend/app/integrations/litellm/` + `backend/app/core/audit.py` + `backend/app/services/steering_rules.py` + `packages/forge-core/`
> **Last updated:** 2026-07-01
> **Upstream:** Martin Fowler / Birgitta Böckeler — *Harness Engineering for Coding Agent Users* (April 2026)
> **Upstream:** ThoughtWorks — *Preparing Your Team for the Agentic SDLC* (Dirk Lässig, March 2026)

---

## Purpose

Adopt the Fowler / Böckeler framing — **Agent = Model + Harness** — and make every component of forge-ai's harness *explicit, testable, and auditable*. Without this doc the harness exists implicitly across half a dozen packages; with it, every rule R1-R18 has a named sensor or guide that enforces it.

> **Working definition.** The *harness* is everything outside the model that shapes what an agent can see, do, and emit. The *model* is what LiteLLM routes the call to. Everything else — schemas, indexes, policies, audits, judges, metrics — is harness.

---

## Source of truth

- **This file** — the canonical vocabulary and map
- **Guides (feedforward)** — `backend/app/schemas/`, `packages/forge-core/forge-core.catalog.json`, `backend/app/onboarding/wizard_state.py`
- **Sensors, computational** — Pydantic v2 validators, SQLAlchemy composite indexes (`(tenant_id, project_id, …)`), `ruff` + `mypy` + `pytest` in CI, `alembic` migrations, `backend/app/core/audit.py`
- **Sensors, inferential** — LiteLLM-as-judge calls (gated by R1), OpenTelemetry span evaluation, `forge-pi` semantic KG validation
- **Policy engine** — `backend/app/services/steering_rules.py` + `backend/app/schemas/steering_policy.json`
- **Audit log** — `audit_log` table (Rule R6) is the canonical event store
- **Metrics** — `agent_metrics` table (planned, Phase B of plan) for drift detection

---

## 1. The two halves of the agent

```text
        ┌────────────────────────────────────────────┐
        │                  AGENT                     │
        │                                            │
        │   ┌──────────────────┐  ┌──────────────┐  │
        │   │      MODEL       │  │   HARNESS    │  │
        │   │  (claude-sonnet, │  │  (everything │  │
        │   │   gpt-*, etc.)   │  │   else)      │  │
        │   └──────────────────┘  └──────────────┘  │
        │                                            │
        └────────────────────────────────────────────┘

Model:  opaque, non-deterministic, hallucination-prone, context-window-bounded
Harness: explicit, testable, auditable, deterministic-where-possible
```

**Invariant.** No LLM call leaves `app/integrations/litellm/`. No reliability comes from the model — every guarantee comes from the harness around it.

> *"Like humans, agents make mistakes (hallucinate) and operate within 'cognitive' limits (context windows). Humans have long mastered the art of building reliable systems from fallible human logic using sophisticated processes and methods like iterating, pairing, reviewing, testing."* — Lässig, March 2026.

---

## 2. The harness is a cybernetic governor

The harness regulates the agent's output by combining **feedforward controls** (guides) and **feedback controls** (sensors), with the goal of converging the agent's output toward a *desired state* defined by typed artifacts, policies, and tests.

```text
                        ┌─────────────────────┐
                        │   DESIRED STATE     │
                        │  (schemas + tests + │
                        │   policies + rules) │
                        └──────────▲──────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
       FEEDFORWARD                                 FEEDBACK
       (Guides)                                    (Sensors)
       "what to do"                                "what happened"
              │                                         │
   ┌──────────┴──────────┐                  ┌───────────┴───────────┐
   │ • Typed schemas     │                  │ • Pydantic validators │
   │ • Catalog entries   │                  │ • DB composite index  │
   │ • Onboarding wizard │                  │ • CI tests + linters  │
   │ • Policy DSL        │                  │ • Migration checks    │
   │ • Skill prompts     │                  │ • Audit rows          │
   └─────────────────────┘                  │ • LLM-as-judge (slow) │
                                            │ • OTel eval (slow)    │
                                            └───────────────────────┘
```

**Regulation categories** (the trichotomy from Fowler/Böckeler):

| Category | What it regulates | Forge implementation | Speed |
|---|---|---|---|
| **Maintainability** | Internal code quality, lint, types, test coverage | `ruff`, `mypy`, `pytest --cov`, AST rules | Computational (ms) |
| **Architecture fitness** | Cross-cutting invariants: tenancy, layer isolation, no-SDK-bypass | Composite indexes, AST grep for forbidden imports, alembic migration checks | Computational (ms) |
| **Behaviour** | "Did the agent do the right thing?" — semantic correctness | LLM-as-judge (gated by R1), OTel span evaluation, KG consistency check | Inferential (s) |

> *"You want to have checks as far left in the path to production as possible, since the earlier you find issues, the cheaper they are to fix."* — Fowler/Böckeler.

---

## 3. Guides — feedforward controls

Guides tell the agent *what shape to emit* before the call lands. They do not inspect the model's output; they constrain the input and the contract.

### 3.1 Typed artifact schemas (Rule R4)

Every agent emits one of: ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan. Schemas live in `backend/app/schemas/` and are Pydantic v2 models. No free-form dicts cross the wire.

**Harness effect:** the *desired state* is concrete enough that a downstream sensor can validate against it.

### 3.2 Forge-core catalog (Rule R9)

Skills, agents, and commands are listed in `packages/forge-core/forge-core.catalog.json`. The UI auto-discovers from this catalog; no hardcoded lists in `apps/forge`. Future extension: `risk_score`, `last_completion_rate`, `validation_agent_id` per catalog entry (Phase B).

**Harness effect:** the agent knows which skills exist, what their preconditions are, and which are forbidden.

### 3.3 Onboarding wizard state (Rule R16)

The wizard (`backend/app/onboarding/wizard_state.py` + `apps/forge/components/onboarding/`) captures per-tenant defaults: which agents are enabled, which validation agents gate which generative agents, which policy pack is active.

**Harness effect:** agent capabilities are tenant-scoped and progressive — new tenants start narrow, mature tenants expand.

### 3.4 Policy-as-code DSL (Rule R8)

Per-tenant guardrails in `backend/app/services/steering_rules.py` evaluated against `backend/app/schemas/steering_policy.json`. No hardcoded per-tenant values anywhere in `app/`.

**Harness effect:** policies are versioned, diffable, and tenant-portable. Same JSON Schema evaluator, different rule sets per tenant.

### 3.5 Skill prompts

Each `forge-core/skills/*/SKILL.md` file is a feedforward guide — it tells the model what role to play, what schema to emit, which tools to prefer, which to avoid.

---

## 4. Sensors — feedback controls

Sensors run *after* the agent acts and decide whether the output converges on the desired state.

### 4.1 Computational sensors (deterministic, ms-fast)

| Sensor | Catches | Where |
|---|---|---|
| Pydantic `model_validate` | Schema drift, missing fields, wrong types | Every endpoint, every LLM call boundary |
| SQLAlchemy composite-index enforcement | Tenant/project isolation regressions | Migration lint + query-plan audit |
| `ruff check` / `mypy --strict` | Style, type errors | CI gate |
| AST grep for forbidden imports | R1 violations (`openai`, `anthropic`, `google.generativeai`, `langchain_openai`, `cohere`, `ollama`) | CI gate |
| `pytest` + coverage gate | Functional regressions | CI gate |
| `alembic upgrade --check` | Schema drift between migrations and models | CI gate |
| `audit_log` row shape check | R6 violations (every agent action must emit) | CI gate on the audit decorator |
| Composite `litellm_call_records` | R1 violations (any non-LiteLLM call path) | CI gate |

### 4.2 Inferential sensors (non-deterministic, slower)

| Sensor | Catches | Where | Cost |
|---|---|---|---|
| **LLM-as-judge** | Semantic correctness — "is this PRD actually good?", "does this ADR answer the question?" | `forge-core/skills/agent-validator/` (planned, Phase C) | Tokens + latency |
| **OTel span evaluation** | Drift in latency, cost, error rate per agent class | OpenTelemetry collector → `forge-observability/` | Storage |
| **KG consistency check** | Cross-tenant edges, dangling nodes, schema-violating facts | `forge-pi/capabilities/kg_validate.py` | Compute |
| **A/B on completion rate** | Behavioural drift between model versions | `agent_metrics` table (Phase B) | Storage |

### 4.3 The two-tier gating rule

> **Inferential sensors run only after all computational sensors pass.** If a computational sensor fails, the agent's output is rejected *before* the LLM-as-judge sees it.

Rationale: avoid burning tokens judging output that was malformed to begin with. Aligns with Fowler/Böckeler: computational sensors are deterministic + fast; inferential sensors are *expensive* by comparison.

---

## 5. Regulation categories in forge-ai

| Category | Sensors | Guides | When to add a new check |
|---|---|---|---|
| **Maintainability** | ruff, mypy, pytest, coverage | skill prompts naming the style | When a new lint rule fires > 5% of PRs |
| **Architecture fitness** | AST grep, composite-index lint, alembic check, policy DSL | R2/R5/R9/R10/R11 cross-cutting rules | When a new constitutional rule promotes from `architecture-rules.md` |
| **Behaviour** | LLM-as-judge, OTel eval, KG consistency, completion-rate drift | onboarding wizard state, policy DSL | When completion rate drops > 1σ below baseline for any tenant cohort |

---

## 6. Per-rule mapping (the 18 rules → harness components)

| Rule | What it asserts | Harness component |
|---|---|---|
| **R1** Provider-agnostic via LiteLLM | No direct SDKs | AST grep sensor + `app/integrations/litellm/` only |
| **R2** Multi-tenancy by default | Every row carries `tenant_id` + `project_id` | Composite-index sensor + AST check on new models |
| **R3** Human approval gates | Architecture/Security/Deployment boundaries require approval | Policy DSL + `audit_log` gate |
| **R4** Typed artifacts only | No free-form dicts cross the wire | Pydantic v2 schemas + `model_validate` sensor |
| **R5** Layer isolation | Org vs Project memory never merge | KG consistency sensor + composite index |
| **R6** Mandatory auditability | Every agent action → audit row | `audit_log` decorator + row-shape sensor |
| **R7** Mandatory observability | OTel spans + metrics + logs from day one | OpenTelemetry sensor + span evaluator |
| **R8** Configurable everything | No hardcoded GitHub/Claude/AWS/Jira | Policy DSL + JSON Schema evaluator |
| **R9** forge-core is canonical | Skills/agents/commands read from catalog | Catalog reader + UI discovery sensor |
| **R10** forge-pi powers product intelligence | Codebase scan/KG/PRD via forge-pi | Cross-package import boundary sensor |
| **R11** forge-browser powers visual automation | Screenshots/pixel-diff/a11y via forge-browser | Cross-package import boundary sensor |
| **R12** Cross-cutting concerns not siloed | Connector/Co-pilot/Command Center everywhere | UI component surface sensor |
| **R13** Canvas-first layout | Complex screens use collapsible rails | Design-system lint |
| **R14** Bidirectional knowledge | Every artifact has outgoing + incoming refs | KG consistency sensor |
| **R15** Empty states explain | Icon + value prop + primary + secondary | Component-library sensor |
| **R16** Onboarding is a wizard | Skippable, resumable, ends with tour | Wizard state schema |
| **R17** Lifecycle is one workflow | Ticket → Idea → PRD → Story → Run → Deploy | Status-trigger table |
| **R18** Documentation is part of the product | Every Built Feature has a `docs-site/` page | `scripts/check-feature-docs.sh` |

---

## 7. Validation agents — the second-order harness

A validation agent is an agent whose purpose is to *challenge another agent's output*. It runs the same harness but reads a typed artifact and returns `accept | reject | request_changes` with a structured reason.

**Why:** the article's thesis that *agents are developing from passive tools to active team members* implies they should police each other. A single validator agent per artifact class closes the behaviour-harness gap.

**Bootstrapping** (Phase C of plan):
- New `forge-core/skills/agent-validator/` skill.
- Reuses existing typed artifact schemas (no new types needed).
- Runs *after* computational sensors, *before* the artifact is committed to the audit log.

---

## 8. The empirical loop — guarding against the METR failure mode

METR's RCT (arXiv:2507.09089, July 2025) found AI tooling **slowed experienced developers 19%** on tasks they already knew well, despite a 24% pre-study predicted speedup. Forge-ai must not repeat that mistake.

**Per-tenant instrumentation:**

1. `agent_metrics` table records `time_on_task` (assignment → PR merge) per tenant per agent class.
2. Co-pilot surfaces a weekly "agent value ledger": "Agent X saved Y hours / cost Z hours for tenant T this week."
3. Onboarding wizard (R16) defaults new tenants to **validation agents on, generative agents opt-in** — the inverse of the METR failure mode.
4. Quarterly audit (via `gsd-audit-milestone`): any agent class with net-negative `time_on_task` for a tenant cohort is switched to HOTL-only mode for that cohort.

> The harness must *measure* whether it is making the team faster, not assume it.

---

## 9. Adding a new sensor or guide

**Before adding anything, ask the ladder:**

1. **Does this need to exist?** A speculative sensor = skip it.
2. **Already in this codebase?** Re-use an existing one. Most "new" sensors are AST rules layered on existing imports.
3. **Stdlib does it?** `ast`, `json`, `re` cover most static checks.
4. **Already-installed dep solves it?** `ruff` + `mypy` + `pytest` + `pydantic` + `sqlalchemy` cover most sensors.
5. **Only then:** the minimum code.

**When you do add one:**

1. Add a section to § 4 (sensor) or § 3 (guide).
2. Add the rule it enforces to § 6.
3. Add it to `scripts/check-*.sh` if it should run in CI.
4. Document the *desired state* it enforces — no sensor without a named invariant.

---

## 10. Anti-patterns

| Anti-pattern | Why it's wrong | What to do instead |
|---|---|---|
| Adding an inferential sensor before all computational sensors pass | Wastes tokens, hides malformed output | Two-tier gate (§ 4.3) |
| Sensor that calls the model to validate the model's output, recursively | Infinite loop, no convergence bound | LLM-as-judge only on typed artifacts, max one round |
| Hardcoding per-tenant rules in `app/services/` | Violates R8 | Policy DSL + JSON Schema |
| Sensor that doesn't write to `audit_log` | Violates R6 | All sensor outcomes → audit row |
| Adding a "trust score" without a measurement | Drift-by-fiat | Inherit from `agent_metrics.completion_rate` |
| Guide that contradicts a policy | Misleading the model | Guides are *lex*-prior; policies are *parse*-posterior |

---

## See also

- `docs/standards/architecture-rules.md` — the 18 constitutional rules (this file is its harness view)
- `docs/standards/litellm-integration.md` — Rule R1 substrate
- `docs/standards/coding-standards.md` — `ruff` + `mypy` configuration
- `docs/standards/testing.md` — sensor test patterns
- `docs/standards/data-model.md` — composite indexes, `audit_log` schema
- `docs/standards/api-conventions.md` — endpoint sensor surface
- Upstream: [Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html) · [Agentic SDLC](https://www.thoughtworks.com/en-in/insights/articles/preparing-your-team-for-agentic-software-development-life-cycle) · [METR RCT](https://arxiv.org/abs/2507.09089)
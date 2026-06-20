# QA Agent — playbook

**Scope:** what the QA stage does, when each test tier is required, the v1 contract, and the Phase 4 self-healing plan.
**Audience:** every sub-agent and engineer touching Epic 4 (`Forge AI-20`) or the gate between Dev → QA → Security.
**Stage injection:** Inject into **QA**, **Dev**, **Security**, and **CTO** reviews for any change that touches the test generator contract.

---

## 1. What this stage does

Sits between the **Dev** stage (PR merged, CI green) and the **Security** stage (no high/critical findings). Produces a runnable test suite for a merged PR and a coverage report, then hands off to Security.

```
Dev (PR merged)
     │
     ▼
QA Agent
  ├── collect: PR diff, tech-stack.md, customer/conventions.md
  ├── plan:    TestPlan  (per-tier test inventory)
  ├── execute: run each tier, capture pass/fail + duration
  ├── report:  CoverageReport  (line, branch, mutation where available)
  └── publish: open / update a qa/test-gen PR via GitHub MCP
     │
     ▼
Security (scans the new test surface + the changes)
```

The QA Agent never mutates a test in the source PR directly. Tests are added on a `qa/test-gen` branch; merge is the DevOps stage's call (per `architecture.md` §3).

## 2. The four test tiers

| Tier         | Required for                       | Framework (default)       | Selection rule                            |
| ------------ | ---------------------------------- | ------------------------- | ----------------------------------------- |
| Unit         | Every change touching business logic | Jest / PHPUnit / pytest   | Derive from `tech-stack.md` language tag  |
| Integration  | Every change crossing a service boundary | Service-local runner | One per service boundary in the diff     |
| E2E          | Every change touching a user-visible path | Playwright (preferred) / Cypress | Only when diff includes UI or critical API path |
| Contract     | Every change crossing an MCP / API boundary | Pact (preferred) / Dredd | When a public API or MCP tool signature changes |

If `tech-stack.md` does not name a framework, **stop and ask**, do not default. The four tiers are mandatory; downgrading is a CTO call, not an agent call.

## 3. The v1 contract (Forge AI-41 ADR)

```python
from agents.qa.schemas import TestPlan, TestRun, CoverageReport
```

- `TestPlan` — what the agent intends to run, per tier, with the chosen framework and the command line.
- `TestRun` — what actually happened: per-tier pass/fail, p50/p99 duration, sample evidence.
- `CoverageReport` — line, branch, mutation-score (when available).

The full ADR is `docs/adr/0004-test-generator-handoff.md` once [Forge AI-41](/Forge AI/issues/Forge AI-41) is merged. Until then, the contract above is the source of truth. **Note (2026-06-17):** ADR-0004 is still listed as *proposed* in [project/tech-stack.md](../project/tech-stack.md); the `docs/adr/0004-test-generator-handoff.md` file does not exist on disk yet, so this section is the de facto source of truth — point a cold-started sub-agent here, not at the missing ADR file.

## 4. Non-obvious design choices

1. **v1 generators are deterministic, not LLM-backed.** Same reasoning as the Ideation synthesizer (see `ideation.md` §4): replayable, auditable, cheap. LLM-driven synthesis ships in Phase 2 behind a feature flag.
2. **Published tests live on a `qa/test-gen` branch, not in the source PR.** Merge control stays with the DevOps stage (per `architecture.md` §3 gate "Dev → QA").
3. **Every response carries provenance** — `mode: "live" | "sample"`, framework version, command line, commit SHA, durations. Never strip this; the Audit Agent reads it.
4. **A `not_implemented` status is a real status.** If the generator is asked for a tier it does not yet support (e.g. mutation score in v1), it returns `not_implemented`, not a fake pass.
5. **The smoke test exercises three paths**: happy / failed-validation / not-implemented. A QA agent that cannot fail loudly is not safe to merge.

## 5. The handoff to Security

The Security stage consumes:

- `TestRun.tests_passed == 100%` of in-scope tiers
- `CoverageReport` is attached as an artifact, not just summarised in a comment
- The list of tiers returned as `not_implemented` is explicitly listed, so Security can decide whether to block

A `not_implemented` tier on a critical path (auth, billing) is a Security-block, not a QA-pass.

## 6. Phase 4 — Self-healing (out of MVP, in scope of Forge AI-37)

When the Phase 4 feature flag flips:

- Self-healing reads CI run history for Playwright / Cypress failures.
- Emits `RepairProposal` records (see `agents/selfhealing/schemas.py`).
- Proposes selector repairs; re-runs the affected suite; fails loud if coverage drops.
- v1 today: scaffold only, no LLM, no test mutation. The `RepairProposal.validate()` call rejects any payload with an `applied_at` field — a guardrail so we cannot accidentally turn it on early.

## 7. Smoke tests

- `python -m agents.qa.smoke_test` — must pass before any QA-Agent PR is merged (per `coding.md` review bar).
- Writes `agents/qa/evidence/smoke_test_run.json` with all three paths.

## 8. Owners and dependencies

- [Forge AI-20](/Forge AI/issues/Forge AI-20) — Epic 4 — QA Agent (CTO, in_progress)
- [Forge AI-33](/Forge AI/issues/Forge AI-33) — Goal 4.1 — Test Generator
- [Forge AI-37](/Forge AI/issues/Forge AI-37) — Goal 4.2 — Self-Healing Agent (Phase 4, backlog)
- [Forge AI-41](/Forge AI/issues/Forge AI-41) — ADR-0004: Test generator handoff contract
- [Forge AI-43](/Forge AI/issues/Forge AI-43) — Build Test Generator agent skeleton (`agents/qa/`)
- [Forge AI-46](/Forge AI/issues/Forge AI-46) — Smoke test for QA Agent (blocked by [Forge AI-43](/Forge AI/issues/Forge AI-43))
- [Forge AI-49](/Forge AI/issues/Forge AI-49) — Wire QA Agent to @fora/mcp-github (blocked by [Forge AI-43](/Forge AI/issues/Forge AI-43) and [Forge AI-46](/Forge AI/issues/Forge AI-46))
- [Forge AI-65](/Forge AI/issues/Forge AI-65) — Document QA playbook (this file; the formal commit lands via the issue, not via a free edit)
- [Forge AI-91](/Forge AI/issues/Forge AI-91) — Self-Healing v1 scaffold (Phase 4)

GitHub MCP: [Forge AI-4](/Forge AI/issues/Forge AI-4) (done).
Senior Engineer hire (will own the v1 skeleton + smoke test): [Forge AI-7](/Forge AI/issues/Forge AI-7).

## 9. Cost notes — token budget for the LLM-driven generator (v2)

The v1 generator is **deterministic and free** (no LLM call; emits skeleton files from a fixture PR diff). The v2 generator will call the synthesis MCP to flesh out each `TierPlan`. Cost discipline starts before the first token is spent.

**Per-`TestPlan` ceiling (hard cap; halts the run):**

| Tier        | v1 (deterministic) | v2 (LLM-driven, target) | v2 (hard ceiling) | Why |
| ----------- | ------------------ | ----------------------- | ----------------- | --- |
| `unit`      | 0 tokens           | 2 000 tokens            | 4 000 tokens      | Boilerplate-heavy; small per-file prompt |
| `integration` | 0 tokens         | 3 000 tokens            | 6 000 tokens      | Service seams need more context |
| `e2e`       | 0 tokens           | 4 000 tokens            | 8 000 tokens      | Playwright/Cypress selectors, fixtures |
| `contract`  | 0 tokens           | 2 000 tokens            | 4 000 tokens      | Pact brokers, schema dump |
| **Per-run total** | **0**        | **≤ 11 000 tokens**     | **≤ 22 000 tokens** | Sum across tiers; in line with [devops.md §12](./devops.md#12-stage-contract--epic-6-devops-stage) cost caps |

**Per-tenant per-day cap (enforced by the [cost-agent], see [architecture.md §2](./architecture.md#2-architecture-principles-in-order-of-weight)):** $50/day. Hitting the cap halts the QA stage for that tenant until the next UTC day.

**What we measure and ship to the audit log:**

- `tokens_in`, `tokens_out`, `model`, `framework_version`, `tier`, `commit_sha` — one row per generator call.
- `cost_usd_total` rolled up to the run, the tenant, and the day.
- The `not_implemented` and `skipped` tiers **must not bill** (no prompt was sent); a regression here is a P1 finance bug.

**What we will NOT do in v2:**

- Do not call the synthesis MCP for a tier that is `skipped` (selection rule did not match). Skipped is skipped.
- Do not chain multiple model calls per file. One synthesis call → one file. The deterministic scaffold handles the rest.
- Do not let the agent pick the model. The model is the Forge default (Claude Sonnet 4.6 today); a future ADR may revisit.
- Do not retry on a 4xx. Retry only on 5xx, 429, or network — per [coding.md §6](./coding.md#6-error-handling).

**v1 self-check (no LLM, no spend):**

- The smoke test in §7 runs the v1 path end-to-end. A green smoke is the proof that we can land the v2 work without a cost surprise; if v1 cannot emit four skeleton files for free, v2 will not get cheaper.

## 10. Related

- The staged workflow this stage implements: see [architecture.md §3](./architecture.md#3-the-staged-workflow-the-spine)
- The agent handoff contract for this stage: [architecture.md §4](./architecture.md#4-the-agent-handoff-contract) and the in-file v1 contract in [§3 above](./qa.md#3-the-v1-contract-fora-41-adr) — ADR-0004 (`docs/adr/0004-test-generator-handoff.md`) is still *proposed* in [project/tech-stack.md](../project/tech-stack.md) pending [Forge AI-41](/Forge AI/issues/Forge AI-41) and the file does not yet exist, so point cold-started sub-agents at §3 until the ADR lands
- Test discipline (the bar every generated test must clear): see [coding.md §5](./coding.md#5-testing-discipline)
- Egress, secret scanning, and the safety evals the synthesis MCP must pass: see [security.md §5](./security.md#5-llm-agent-specific-controls)
- How the QA stage runs in CI: see [devops.md §2](./devops.md#2-cicd-pipeline)
- The product these tests serve: [project/PRD.md](../project/PRD.md)
- The framework choice for each tier: [project/tech-stack.md](../project/tech-stack.md)
- Customer overrides on tier strictness: [customer/conventions.md](../customer/conventions.md)

---

**Versioning:** this file ships through the normal release train. A change is a major version bump if it adds or removes a test tier, changes the handoff contract schema, or tightens a v2 cost ceiling. A change that loosens a v2 cost ceiling is rejected. The CTO owns merges to this file.

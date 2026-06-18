# FORA Engineering Standards

**Status:** Active
**Owner:** CTO
**Applies to:** All FORA-owned repositories, agents, and CI pipelines
**Review cadence:** Quarterly, or on any change to the agent-of-agents contract

This document is the source of truth for what a "done" change looks like at FORA.
It is short on purpose. The CTO's review bar is the single most important habit
in the engineering org; if a rule in here is violated, the PR is not done.

---

## 0. Lenses (read before arguing with this doc)

When two rules collide, resolve in this order:

1. **Reversibility** — a one-way door (data model, agent handoff contract, security boundary, billing surface) gets an ADR and a senior reviewer. Two-way doors ship fast.
2. **Agent contract clarity** — if a future sub-agent or external system cannot understand the interface from the docs alone, the boundary is wrong.
3. **Cost-of-execution** — tokens, dollars, latency, human review hours. Cheaper designs win at equal acceptance criteria.
4. **Operational surface** — observability, retries, idempotency, audit log. SRE at 2 a.m. is a stakeholder.
5. **Security-by-default** — secrets never in code, least-privilege agent permissions, audit trail on every agent action.
6. **Knowledge-layer discipline** — change belongs in `project/`, `customer/`, or `memory/`. Put it where the next agent will look.
7. **Stage discipline** — Ideation → Architect → Dev → QA → Security → DevOps → Docs. New stages are expensive; resist.
8. **Build vs. orchestrate** — never rebuild what AWS, GitHub, SonarQube, or another tool already does. Orchestrate.

---

## 1. Coding style

### 1.1 Baseline

- **Languages of record:** TypeScript (primary — agent runtime, MCP adapters, orchestrator), Python (secondary — data, eval harnesses, ML utilities), Bash (CI glue only).
- **Style is enforced by tools, not humans.** No review comments about formatting, import order, or trailing whitespace.
- **No new language without an ADR.** Adding Go, Rust, or anything else is a CTO-level decision.

### 1.2 TypeScript (default for new code)

- **Formatter:** Prettier with the repo's `.prettierrc.json` (single quotes, 100-col soft wrap, trailing commas `all`, semicolons on).
- **Linter:** ESLint with `@typescript-eslint/recommended-type-checked` + `eslint-plugin-import` + `eslint-plugin-no-relative-import-paths`. Warnings fail CI in `apps/*` and `packages/*`; allowed in `tools/` and `scripts/`.
- **Type discipline:** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. No `any` outside generated code; no `as unknown as T` outside typed test doubles.
- **Module layout:** `src/index.ts` re-exports the public surface. Internal modules are not deep-imported across package boundaries.
- **Naming:** `PascalCase` types and React components, `camelCase` functions and variables, `UPPER_SNAKE_CASE` module-level constants, `kebab-case` file names for non-components, `PascalCase.tsx` for components.

### 1.3 Python

- **Formatter:** `ruff format` (Black-compatible).
- **Linter:** `ruff check` (replaces flake8, isort, pyupgrade, bandit) + `mypy --strict` for anything in `fora/`.
- **Type discipline:** full type hints on every public function. Pydantic v2 for all data classes crossing a process boundary.

### 1.4 Bash / shell

- `shellcheck` clean. `set -euo pipefail` at the top of every script. Quote everything.

### 1.5 General

- **No dead code.** Lint rules fail on unused exports, unused locals, and unreachable branches.
- **No commented-out code in main.** If you need to disable a rule, do it for a single line with a reason comment, then open a follow-up issue.
- **No new dependencies without justification in the PR.** The PR template's *Dependencies* section is not optional when `package.json` or `requirements.txt` changes.
- **Lockfiles are committed.** `package-lock.json`, `pnpm-lock.yaml`, `uv.lock`, `poetry.lock` are all required.

---

## 2. Test discipline

**The right test is the smallest test that proves the change. Never default to the full suite.**

### 2.1 The four tiers

| Tier | What it covers | Where it lives | Runs on |
|------|----------------|----------------|---------|
| **Unit** | Pure functions, branches, edge cases of a single module | `*.test.ts` co-located or `__tests__/` | Every push, every PR |
| **Integration** | Module boundaries, adapter contracts, DB/queue interactions with real or testcontainers-backed services | `*.integration.test.ts` | Every PR, can be slow |
| **Contract** | MCP adapter request/response shape, agent handoff envelopes, API schemas | `*.contract.test.ts` | Every PR, fast |
| **End-to-end** | Full agent-of-agents flow with real LLM (record-and-replay in CI, live in nightly) | `e2e/` | Nightly + pre-release |

### 2.2 What goes where

- **Logic, branches, validation** → unit. Pure, fast, exhaustive on edge cases.
- **Boundaries** (DB, queue, MCP server, file system) → integration. One test per boundary, real fixture.
- **Schemas and external contracts** → contract. Snapshot the wire format. Break the build on a drift.
- **User-visible behavior** → e2e. The smallest realistic scenario that touches the orchestrator end-to-end.

### 2.3 What does not go in a PR

- **Full-suite runs by default.** The CTO's local dev loop is `pnpm test:unit` only. Integration runs on CI. E2E runs nightly.
- **"Just in case" tests.** Every test must map to a documented acceptance criterion in the PR.
- **Tests that depend on the network or the clock without a fake.** `vi.useFakeTimers()` and MSW are the standard tools.
- **Tests that call real LLMs in PR CI.** Record-and-replay fixtures only. Live LLM calls run in the nightly eval lane and are not a PR gate.

### 2.4 Coverage

- Coverage is reported, not enforced, on changed lines for `apps/*` and `packages/*`. Hard floor: any new module with no tests is a review-blocker.
- Mutation testing (`stryker` for TS) runs weekly on the agent runtime. Low mutation score on the orchestrator is a follow-up ticket, not a PR gate.

---

## 3. PR template

The PR template lives at `.github/PULL_REQUEST_TEMPLATE.md`. Every PR must fill in every section; an empty section is a self-blocker, not a reviewer problem. See the template file for the full structure. Required sections:

1. **Problem** — what is broken or missing, and why now
2. **Acceptance criteria** — bulleted, testable
3. **Verification** — the smallest command/script/log that proves the change
4. **Risk and rollback** — what could go wrong, and the revert path
5. **For agent or prompt changes** — sample input/output, token cost, failure modes tested
6. **Dependencies** — only required if `package.json`, `requirements.txt`, or any lockfile changed
7. **Cost / observability** — only required if the change touches an LLM call, a token-metered surface, or a user-facing log

A PR that works but is untested, undocumented, or unreviewed is **not done**.

---

## 4. CI expectations

CI is a four-tier pipeline. Each tier is a separate job with its own cache, its own timeout, and its own merge gate.

### 4.1 The four tiers

| Tier | Job | Required checks | Gate |
|------|-----|-----------------|------|
| **Tier 1 — Static** | `lint`, `typecheck`, `format-check`, `secret-scan` | All pass | **Required** |
| **Tier 2 — Unit** | `test:unit` with coverage report | All pass | **Required** |
| **Tier 3 — Integration** | `test:integration` (testcontainers + ephemeral services) | All pass | **Required** |
| **Tier 4 — E2E + Evals** | `e2e` + `evals` (record-and-replay) | All pass | **Required for release**, runs nightly on `main` |

### 4.2 Rules of the pipeline

- **Tiers run in order.** Tier 2 starts only if Tier 1 is green. Tier 3 starts only if Tier 2 is green.
- **Tier 4 is a release gate, not a PR gate.** E2E flake budgets are tracked; >2% flake on a single test for two consecutive weeks means the test gets quarantined or deleted.
- **All jobs cache on lockfile hash.** If the lockfile changes, the cache is rebuilt.
- **Timeouts are explicit.** Tier 1: 5 min. Tier 2: 10 min. Tier 3: 20 min. Tier 4: 45 min. If a job times out, the test is the problem, not the timeout.
- **Required status checks are configured in branch protection.** A green PR with a missing required check cannot merge.
- **No `--no-verify`.** Pre-commit hooks, signing, and CI are not bypassed by anyone, including the CTO.

### 4.3 Reference workflow

The reference implementation lives at `.github/workflows/ci.yml`. It wires the four tiers and is the template for new repos. New repos copy the workflow; they do not reinvent it.

---

## 5. Security baseline

### 5.1 Secrets

- **Secrets are never in code, comments, examples, or test fixtures.** Real-looking API keys, even in tests, fail the secret-scanner.
- **Local development uses a `.env.local`** (git-ignored) + 1Password / Doppler / AWS Secrets Manager. No `echo $TOKEN` in scripts.
- **Pre-commit hook** runs `gitleaks` or `trufflehog` and blocks any secret-like string.
- **Rotation is automated.** Any leaked secret is rotated within 15 minutes by the on-call; the audit log captures the rotation event.
- **Runtime secret resolution goes through the `secrets-mcp`.** An agent that needs a secret references a `secret_ref`; the broker materialises the value at the last hop and returns a redacted envelope. The agent never sees the raw value. See [the operator runbook](../runbooks/secrets-mcp.md) and the contract at `mcp-servers/secrets/docs/contract.md` (FORA-128).

### 5.2 Least-privilege agents

- Every agent and MCP adapter has a **scoped credential** with the minimum permissions its task requires. A Jira adapter reads issues; it does not admin projects.
- **Agent tool access is declared in `agents/<agent>/tools.yaml`.** Adding a tool is a PR that the CTO reviews; it is not a config change.
- **Prompt-injection defenses are mandatory** for any tool that ingests external content: explicit untrusted-boundary markers, output re-validation, no tool calls based on quoted user content.
- **Human-in-the-loop** is required for any action that is destructive, irreversible, externally visible, or financial. The orchestrator halts and asks; it does not auto-approve.

### 5.3 Audit log

- Every agent action is logged with: actor, agent, tool called, input hash, output hash, parent issue/run id, token cost, and decision (allowed / blocked / escalated).
- The audit log is append-only, replicated, and queryable. It is the source of truth for any "what did the agent do" investigation.
- The log ships to a system the CTO does not own (separate AWS account or third-party) so a compromised orchestrator cannot rewrite history.

### 5.4 OWASP and dependencies

- `npm audit` / `pip-audit` runs in Tier 1 CI. Any *high* or *critical* CVE on a direct dependency blocks the PR. Indirect CVE on a transitive dep opens a follow-up issue with a 14-day SLA.
- `osv-scanner` and `trivy` run weekly on container images.
- No known-vulnerable patterns in code: `eval`, `child_process` with untrusted input, raw SQL with concatenation, deserialization of untrusted payloads. ESLint rules and CodeQL queries enforce this.

---

## 6. Observability

### 6.1 Logs

- **Structured JSON to stdout.** No multi-line stack traces, no pretty-printed blobs, no `console.log` in production paths.
- **Required fields on every log line:** `timestamp` (ISO 8601, UTC), `level`, `service`, `traceId`, `spanId`, `actor`, `message`, plus event-specific context.
- **PII and secrets are redacted at the source.** The logger has a redaction list; the developer never relies on log shipping to scrub.
- **Log levels:** `debug` is opt-in via env var, never on by default. `info` for state changes. `warn` for recoverable errors. `error` for unrecoverable.

### 6.2 Traces

- **OpenTelemetry** is the standard. Every request and every agent run has a `traceId` and a span tree.
- **Span names follow `<verb> <noun>`** — `orchestrate.sdlc`, `mcp.jira.search`, `agent.developer.generate_code`.
- **Spans capture token counts** for any LLM call: input tokens, output tokens, cached tokens, cost in USD.
- **Sampling is head-based in production (1%) and 100% in staging and CI.**

### 6.3 Metrics

- **RED metrics** (Rate, Errors, Duration) for every service. **USE metrics** (Utilization, Saturation, Errors) for every dependency.
- **LLM-specific metrics:** tokens/min, $/min, cache hit rate, prompt-template version, model id, eval score.
- **Cost attribution** is a first-class metric. Every LLM call tags: `customer_id`, `project_id`, `agent_id`, `template_version`. Monthly cost reports are generated automatically.

### 6.4 Alerts

- **Page on user impact, not on noise.** A failed health check that auto-recovers is a dashboard tile, not a page.
- **SLOs are defined per service** with error budgets. Burning the budget pauses non-critical deploys.
- **Runbooks are linked from every alert.** An alert without a runbook is a draft, not a deployable.

---

## 7. Working agreements

- **Default to a working v1, not a perfect v0.** A shipped, reversible change beats a planned, irreversible one.
- **Stay close to the runtime.** The CTO and senior engineers read logs, run the orchestrator, and exercise the agents. Dashboards supplement firsthand observation; they do not replace it.
- **Pull for bad news.** A hallucinating model, a broken agent loop, an unresolved security finding — surface it fast. No one gets punished for surfacing a problem in time.
- **Document the one-way door.** ADRs live in `docs/adr/`. The format is: context, decision, consequences, rollback. Anything that touches the agent handoff contract, the data model, or the security boundary needs one.
- **Knowledge belongs in the Knowledge Layer.** `project/` for this product, `customer/` for a customer's conventions, `memory/` for cross-cutting lessons. Do not put knowledge in a Slack thread or a comment that only the author can find.

---

## 8. Exceptions

Any exception to a rule in this document:

1. Is recorded in the PR description under *Exceptions* with the rule, the reason, and the expiration (a follow-up issue to remove the exception).
2. Has an owner.
3. Is reviewed by the CTO or a designated delegate.

An undocumented exception is a bug.

---

## 9. Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-06-16 | CTO | Initial publication (FORA-5) |

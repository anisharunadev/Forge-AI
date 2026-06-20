# Coding Memory

**Scope:** Engineering coding standards, testing discipline, and the review bar.
**Audience:** Every developer, code-reviewer, and sub-agent that touches the codebase.
**Stage injection:** Inject into **Developer**, **Reviewer**, and **Refactor** sub-agents. Cross-reference from **QA** (tests) and **Security** (secure-coding cross-cuts).

---

## 0. Quick start

- **Read [README §9](../README.md#9-quick-start-for-a-new-sub-agent) first.** That is your first ten minutes. This file is the bar you are checked against; the README is how you walk in.
- **The test pyramid in §5 maps to the CI pipeline in [devops.md §2](./devops.md#2-cicd-pipeline).** The pipeline runs `lint → typecheck → unit → integration → e2e → build`; this file owns the four test layers (unit, integration, e2e, eval) and the rules for which layer a change needs. A green pipeline is not enough — the change must hit the right layers.
- **One-way doors need an ADR and CTO sign-off.** A two-way door ships in the same PR. If you are unsure which one it is, treat it as a one-way door and file the ADR.

---

## 1. Operating principles

1. **Working v1 beats perfect v0.** Ship the smallest code that solves the user's problem end-to-end. Then harden.
2. **Read like the surrounding code.** Match the comment density, naming, and idiom of the file you are editing. Do not import foreign style into a file that is already consistent.
3. **Reversibility rules pace.** Two-way doors (refactors, internal renames, swapping a library) ship fast. One-way doors (data model, agent handoff contract, auth, secrets) need an ADR and CTO sign-off.
4. **The cost of a comment is one minute; the cost of a misunderstood API is a week.** Comment non-obvious *why*, not mechanical *what*. Public functions and interfaces always have a one-line docstring.
5. **Optimise for the next agent, not the next commit.** The reader is usually a sub-agent that just woke up with only this file in context. Code that needs tribal knowledge to be safe is a bug.

## 2. Languages, formatters, and the toolchain defaults

- **Primary languages:** TypeScript (Node 20 LTS, ESM, strict mode), Python 3.12 (for the agent runtime, evals, and any ML). Do not introduce Go, Rust, Java, or C# without an ADR.
- **Formatter:** Prettier (TS/JS) and Black (Python) with project defaults. No hand-formatting debates. Run the formatter in pre-commit, not in code review.
- **Linter:** ESLint with `@typescript-eslint/recommended-type-checked` and `eslint-plugin-import` for TS; Ruff for Python. Treat lint warnings as errors in CI on `main`.
- **Type checker:** `tsc --noEmit` must be clean on every PR. No `any` in new code; cast through `unknown` with a justification comment if you must.
- **Package manager:** `pnpm` for TS, `uv` for Python. Lockfiles are committed; CI fails if the lockfile and `package.json`/`pyproject.toml` disagree.
- **Pre-commit hook:** `pre-commit` framework. Required hooks: formatter, linter, `gitleaks`, `ruff`/`tsc`, `commitlint` (conventional commits).

## 3. Repo layout (default monorepo)

```
.
├── apps/                  # Deployable services (api, web, worker, agent-runtime)
├── packages/              # Shared libraries (sdlc-types, mcp-clients, llm-tools, evals)
├── infra/                 # IaC (Terraform, Helm, ArgoCD manifests)
├── workspace/             # The Knowledge Layer (memory/, customer/, project/)
├── .omc/                  # oh-my-claudecode state, plans, and run logs
├── docs/                  # ADRs, runbooks, postmortems
└── tools/                 # Repo-local CLIs and codegen
```

- New code goes in `apps/<name>/src/` and `packages/<name>/src/`. Do not create top-level `src/`.
- `apps/<name>/test/` mirrors `src/`. Mirror the directory structure exactly.
- Cross-app imports go through `packages/`, never directly across `apps/`.

## 4. Naming and idiom

| Surface | Convention | Example |
| --- | --- | --- |
| Files (TS) | `kebab-case.ts` | `agent-orchestrator.ts` |
| Files (Python) | `snake_case.py` | `mcp_router.py` |
| Classes / types | `PascalCase` | `SDLCAgent`, `RunContext` |
| Functions / methods | `camelCase` (TS) / `snake_case` (Py) | `runStage()`, `get_run_context()` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_TOOL_RETRIES = 3` |
| Booleans | `is_/has_/should_` prefix | `is_idempotent`, `has_audit_log` |
| DB tables | `snake_case`, plural | `agent_runs`, `audit_events` |
| Env vars | `Forge AI_<SCOPE>_<NAME>` | `Forge AI_AGENT_RUNTIME_URL` |
| Log keys | `snake_case` | `agent.run.id`, `stage.duration_ms` |

## 5. Testing discipline

The test pyramid is the law, not a suggestion.

- **Unit tests** — Every public function. Fast, isolated, deterministic. Mock I/O at the seam (DB, HTTP, LLM, clock). Target: < 5 s for the full unit suite.
- **Integration tests** — One per external seam (DB, MCP server, S3, queue). Real service or `testcontainers`, not mocks. Target: < 60 s for the full integration suite.
- **End-to-end tests** — One happy path per user-visible flow (Forge Ideation → Architect → Dev → QA → Security → DevOps → Docs). Use a recorded fixture; never call a real LLM in CI. Target: < 5 min for the full e2e suite.
- **Eval tests** — Every prompt, tool schema, and agent handoff contract. Golden inputs/outputs live in `packages/evals/cases/`. CI fails on regression > 5 %.

**How this maps to the CI pipeline** (see [devops.md §2](./devops.md#2-cicd-pipeline)): the pipeline runs `lint → typecheck → unit → integration → e2e → build`. The `lint` and `typecheck` stages are gates before `unit`; the `build` stage runs after `e2e` and ships the container. The four test layers above are the contents of `unit`, `integration`, and `e2e`; `lint` and `typecheck` are the formatter and type-checker rules in §2 of this file. The `eval` layer is not a separate pipeline stage — it runs as part of `unit` for prompt/contract changes.

**Rule of thumb:** the smallest test that proves the change is the right test. Do not add a 500-line integration test to prove a one-line bug fix.

### What every PR must include

- [ ] Test that fails before the fix and passes after.
- [ ] Coverage on the changed branch ≥ the project median; do not decrease overall.
- [ ] Eval case added/updated if the change touches a prompt, tool schema, or agent contract.
- [ ] A `Risk & Rollback` section in the PR description (see §9).

## 6. Error handling

- **Never swallow an error.** If you catch it, you either re-throw, return a typed `Result`, or log with full context (`run_id`, `stage`, `tool`, `attempt`) and re-throw.
- **All I/O is bounded and retried.** Network calls: 3 attempts, exponential backoff with jitter, total cap 30 s. LLM calls: 2 attempts, retry only on 5xx/429/network, never on 4xx other than 429.
- **Idempotency keys on every mutating call.** If a request retries, the second call must be a no-op.
- **Timeouts on every external call.** Default 10 s for HTTP, 60 s for LLM, 5 s for DB. No infinite waits.

## 7. Logging and observability

- **Structured JSON logs only.** `pino` (TS) / `structlog` (Python). Never `console.log` in a service.
- **Every log line carries** `run_id`, `stage`, `agent_id`, `tool`, `attempt`, `duration_ms`.
- **Use log levels deliberately.** `debug` = noise that helps the next debugger. `info` = state changes (run started, run completed, tool called). `warn` = recovered error. `error` = unrecovered error that needs a human.
- **No PII or secrets in logs.** Scan with `gitleaks` pre-commit and `detect-secrets` in CI. LLM prompt/response bodies are logged only when `Forge AI_LOG_LLM=1` (dev only).
- **Metrics, not strings.** A stage completing is a counter (`stage.completed{stage="qa"}`) and a histogram (`stage.duration_ms{stage="qa"}`). Dashboards are written in PromQL, not in grep.

## 8. Dependency policy

- New dependency → a one-paragraph justification in the PR (problem, alternatives considered, why this one, license, maintenance signal).
- No copyleft (GPL/AGPL) in the core platform. Permissive (MIT/Apache-2.0/BSD) preferred.
- Prefer libraries with a stable API, a published security policy, and an active maintainer. Check the last commit date and the open-issue count before adding.
- Pin exact versions in production deps; `^` is acceptable in dev deps. Renovate keeps both fresh on a weekly PR cadence.

## 9. The PR template (use it, do not edit it)

```markdown
## Problem

<one paragraph: what is broken or missing and why it matters>

## Acceptance criteria

- [ ] <observable, testable criterion>
- [ ] <observable, testable criterion>

## Changes

<bullet list of what changed and where>

## Verification

- command: <the smallest command that proves it>
- output: <paste it or link the run>
- screenshot: <if user-visible>

## Tests

- [ ] unit added/updated
- [ ] integration added/updated (if touching a seam)
- [ ] eval case added/updated (if touching prompt/contract)
- [ ] manual repro recipe included (if non-obvious)

## Risk & Rollback

- Risk: <what could go wrong in prod>
- Blast radius: <who is affected>
- Rollback: <the exact revert or feature-flag toggle>
```

## 10. Code review bar

A PR is **ready to merge** when:

- The diff is small enough to read in one sitting (rule of thumb: < 400 changed lines, excluding generated files).
- Tests cover the change at the right level (see §5).
- The `Risk & Rollback` section is honest, not boilerplate.
- At least one reviewer from the affected sub-team has approved. For one-way doors (data model, auth, secrets, agent handoff contract), the CTO must approve.
- No `TODO` without a linked issue. No `FIXME` without an owner and a date.

A reviewer says **"approve with comments"** when the comments are non-blocking. A reviewer says **"request changes"** when the code as written should not ship. Do not split the difference with "approve with comments" if you actually mean "this is wrong."

## 11. Anti-patterns (auto-flag in review)

- `any` in TypeScript outside an `interop` boundary.
- `try { ... } catch (e) {}` with an empty body.
- A function longer than ~80 lines or with > 4 levels of nesting.
- A test that depends on real time, real network, or another test's side effect.
- A configuration value hard-coded in a service that should be an env var.
- A new abstraction with exactly one caller. (Build the second caller before you generalise.)
- A "temporary" hack still in `main` 30 days after the PR that introduced it.

## 12. Related

- Architecture decisions: see [architecture.md](./architecture.md)
- Deployment, runbooks, on-call: see [devops.md](./devops.md)
- Secure-coding specifics: see [security.md](./security.md)
- The product these standards serve: see [project/PRD.md](../project/PRD.md)

---

**Versioning:** this file ships through the normal release train (see [README §5](../README.md#5-versioning)). A change is a major version bump if it tightens a one-way door (e.g., adds a new test tier, changes the PR review bar, or adds a new anti-pattern auto-flag). A change that relaxes a rule is rejected. The CTO owns merges to this file.

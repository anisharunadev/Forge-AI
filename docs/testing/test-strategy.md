# Forge AI — Test Strategy

> Status: Phase 11 / T14
> Owner: QA + Platform
> Linked: `docs/engineering/standards.md`, NFR-001 (reliability), NFR-002 (testability), NFR-035 (security)

## 1. Philosophy

We follow the **test pyramid** rigorously. Cheap, fast tests at the bottom; slow, broad tests at the top. We optimize for *signal-per-second*, not for coverage theater.

```
                  /\
                 /  \           E2E (Playwright)
                / 5  \          - Critical user journeys only
               /------\         - Slow, expensive, flaky-prone
              /  15   \         Integration (pytest + testcontainers)
             /----------\       - Real DB / Redis / Keycloak
            /    30     \       - Component boundaries
           /--------------\     Unit (pytest + vitest)
          /      50        \    - Pure logic, fast (<5ms / test)
         /==================\  Static (ruff, mypy, eslint, tsc)
                              - Cheapest signal
```

**Rule of thumb**: if you can write it as a unit test, do. Integration is for boundaries (DB, network, queue). E2E is for confidence on the last 2 %.

## 2. Coverage targets

Targets are *floors*, not goals. We celebrate when a critical path is well-covered more than when a util hits 100 %.

| Surface                      | Line  | Branch | Function | Notes                              |
|------------------------------|-------|--------|----------|------------------------------------|
| Backend (overall)            | 80 %  | 70 %   | 85 %     | Enforced in `ci-backend.yml`       |
| Frontend (overall)           | 70 %  | 60 %   | 80 %     | Enforced in `ci-frontend.yml`      |
| Shared packages              | 80 %  | 75 %   | 90 %     | Same as backend                    |
| **Critical paths (95 %+)**   | 95 %  | 90 %   | 100 %    | See list below                     |
| Cost ledger                  | 95 %+ | 90 %   | 100 %    | Money math is non-negotiable       |
| Auth (login, refresh, logout)| 95 %+ | 90 %   | 100 %    | Security-critical                  |
| Row-Level Security policies  | 95 %+ | 90 %   | 100 %    | Tenant isolation                   |
| Approval gate (LangGraph)    | 95 %+ | 90 %   | 100 %    | Human-in-the-loop correctness       |
| LLM Proxy / cost attribution | 95 %+ | 90 %   | 100 %    | Token math                         |
| Terminal PTY isolation       | 90 %+ | 85 %   | 95 %     | Cannot escape workspace            |

Anything in the critical-paths list that drops below its target **fails CI** even if the global number is green.

## 3. Test categories

| Category        | Purpose                                            | When to use                              |
|-----------------|----------------------------------------------------|------------------------------------------|
| **smoke**       | "Is the system up at all?"                         | Post-deploy, on every PR merge to main   |
| **regression**  | "Did this break an already-working thing?"         | Always — every PR                        |
| **contract**    | "Does producer and consumer agree on the schema?"  | API changes, MCP server changes          |
| **chaos**       | "Does the system survive a failure?"               | Weekly + pre-release                     |
| **load**        | "Does the system hold under load?"                 | Monthly + before any major change        |
| **security**    | "Can we bypass auth, RLS, cost limits?"            | Pre-release + after security work        |
| **accessibility** | "Can users with disabilities use this?"          | On every UI change                       |

## 4. Mocking strategy

| Boundary        | Approach                                           | Why                                   |
|-----------------|----------------------------------------------------|---------------------------------------|
| LiteLLM Proxy   | Mock with `pytest-httpx` / `MSW`                   | Don't pay real LLM cost in CI         |
| OpenAI / Anthropic upstream | Always mocked via LiteLLM Proxy | Test the *proxy*, not the vendor      |
| Postgres        | `testcontainers-python` (real Postgres 16)         | RLS behaves differently on SQLite     |
| Redis           | `fakeredis` for unit, real Redis for integration   | Redis semantics matter                |
| Keycloak        | `testcontainers-keycloak`                          | JWT validation has real corner cases  |
| MCP servers     | Stub with contract-based fixtures                  | Don't fork the network                |
| Clock / time    | `freezegun` / `@sinonjs/fake-timers`               | Idempotency, retries, rate limits     |
| WebSockets      | In-process ASGI client (`httpx-ws`)                | Don't stand up a real broker          |
| HTTP upstream   | `respx` / `MSW`                                    | Reproducibility                       |

**Never** mock the database unless you are doing pure logic work. RLS bugs hide behind mocks.

## 5. Performance benchmarks (in CI as a soft gate)

These run nightly, not on every PR, because they are noisy. PR runs that exceed 2× the threshold fail loudly with a perf annotation.

| Metric                                       | Target  | Hard fail |
|----------------------------------------------|---------|-----------|
| API p50 latency (`/api/v1/*`)                | < 100 ms| > 250 ms  |
| API p99 latency (`/api/v1/*`)                | < 500 ms| > 1.5 s   |
| Terminal cmd roundtrip (`run → output`)      | < 100 ms| > 400 ms  |
| LangGraph turn latency (no tool calls)       | < 2 s   | > 6 s     |
| LangGraph turn latency (with MCP tool call)  | < 8 s   | > 20 s    |
| Frontend LCP (3G profile)                    | < 2.5 s | > 4.0 s   |
| Frontend TBT                                 | < 200 ms| > 600 ms  |
| Postgres query p95 (auth-scoped)             | < 20 ms | > 100 ms  |

Benchmarks live in `backend/tests/perf/` and `apps/forge/tests/perf/`. They are excluded from PR CI by default.

## 6. Test data

We never use real PII, real customer data, or real secrets in tests. Period.

| Layer        | Tool                              | Notes                                |
|--------------|-----------------------------------|--------------------------------------|
| Python       | `factory_boy` + `faker`           | Per-model factories in `tests/factories/` |
| TypeScript   | `@faker-js/faker` + custom factories | Per-feature factories            |
| Snapshots    | Generated from factories, never hand-edited | Commit to git |
| Tenants      | Predefined list in `tests/tenants.py` | `acme-prod`, `beta-corp`, etc.    |
| Users        | Synthetic only (`users[0]@forge.test`) | Never look like real emails       |
| Cost ledger  | Deterministic — `decimal.Decimal`, no float | Tests assert exact cents          |

## 7. Flaky test policy

A flaky test is a bug. We treat it as such.

1. CI auto-retries the failing test **once**. If it passes on retry, the test is marked `flaky` and the PR is allowed to merge with a non-blocking warning.
2. A `flaky` annotation opens a Jira ticket automatically assigned to the file's owning team.
3. **Three flakes in a week → the test is quarantined** (skipped by default, only runs on a nightly "quarantine" lane).
4. Quarantined tests that are not fixed within 14 days are deleted.

This is harsh but it works: a quarantined test that nobody fixes is a test that lies to you.

## 8. Branching and ownership

- `tests/` is the cross-cutting folder for end-to-end harness code.
- Backend tests live next to code: `backend/app/<module>/tests.py` or `backend/tests/`.
- Frontend tests live next to code: `apps/forge/<feature>/__tests__/`.
- Every PR that adds production code must add at least one test at the appropriate tier (enforced by CODEOWNERS review).

## 9. Required references

Every PR description must link the **ADR**, **NFR**, or **FR** it implements. CI's `ci-monorepo.yml` `adr-consistency` job warns when a code change has no such reference.

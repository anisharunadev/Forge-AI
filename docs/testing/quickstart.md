# Forge AI — Testing Quickstart

> Status: Phase 11 / T14
> Audience: new contributors, on-call engineers, anyone who needs to run a test in 5 minutes.

## 1. TL;DR

```bash
# Backend unit tests (no infra needed)
cd backend && pytest -m "not integration" -x

# Backend integration tests (needs docker compose for postgres + redis)
cd backend && docker compose -f tests/docker-compose.test.yml up -d
pytest -m integration -x
docker compose -f tests/docker-compose.test.yml down -v

# Frontend unit tests
pnpm --filter forge test:unit

# Frontend E2E tests
pnpm --filter forge exec playwright install --with-deps chromium
pnpm --filter forge test:e2e

# Monorepo-wide
pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

## 2. Running tests

### 2.1 Unit tests

Unit tests have no external dependencies and run on every save.

```bash
# Backend
cd backend
pytest -m "not integration" --no-cov -x
pytest backend/app/agents/langgraph/nodes/summarize_node_tests.py  # one file
pytest -k "test_cost_ledger"                                       # one keyword

# Frontend
pnpm --filter forge test:unit
pnpm --filter forge test:unit -- --watch                            # watch mode
pnpm --filter forge test:unit -- src/lib/cost/ledger.test.ts        # one file
```

### 2.2 Integration tests

Integration tests use real Postgres, real Redis, and (sometimes) Keycloak via testcontainers. They need Docker running.

```bash
# Start dependencies once
docker compose -f tests/docker-compose.test.yml up -d

# Run
cd backend
pytest -m integration --no-cov

# Tear down
docker compose -f tests/docker-compose.test.yml down -v
```

### 2.3 End-to-end tests (Playwright)

E2E tests run against a built frontend + a running backend.

```bash
# One-time
pnpm --filter forge exec playwright install --with-deps chromium

# Run
pnpm --filter forge build
pnpm --filter forge test:e2e

# Debug
pnpm --filter forge test:e2e -- --debug
pnpm --filter forge test:e2e -- --ui
```

### 2.4 Performance benchmarks (nightly only, not on PR)

```bash
# Backend
cd backend
pytest tests/perf/ --benchmark-only --benchmark-autosave

# Frontend
pnpm --filter forge test:perf
```

## 3. Adding a new test

### 3.1 Backend (Python)

```bash
mkdir -p backend/app/<module>/tests
touch backend/app/<module>/tests/__init__.py
touch backend/app/<module>/tests/test_<unit>.py
```

A minimal test:

```python
# backend/app/<module>/tests/test_<unit>.py

def test_<behavior>_when_<condition>_then_<result>():
    # Arrange
    sut = UnitUnderTest(...)

    # Act
    result = sut.do_thing()

    # Assert
    assert result == expected
```

Naming: see `docs/testing/test-naming.md`.

If your test needs real Postgres or Redis, mark it `@pytest.mark.integration` and use the `postgres` and `redis` fixtures from `backend/tests/conftest.py`.

### 3.2 Frontend (TypeScript)

Co-locate the test next to the file:

```bash
touch apps/forge/lib/<feature>/<unit>.test.ts
```

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from './myFunction';

describe('myFunction', () => {
  it('does X when Y', () => {
    expect(myFunction('input')).toBe('output');
  });
});
```

### 3.3 End-to-end (Playwright)

```bash
touch apps/forge/e2e/<feature>/<journey>.spec.ts
```

```typescript
import { test, expect } from '@playwright/test';

test('user can do X', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading')).toBeVisible();
});
```

## 4. Debugging a failing test

### 4.1 Backend

```bash
# Verbose output
pytest path/to/test.py -xvs

# Drop into pdb on failure
pytest path/to/test.py --pdb

# Only run the failing case
pytest path/to/test.py::test_name -xvs
```

For async tests, use `pytest -xvs --log-cli-level=DEBUG` to see logs.

### 4.2 Frontend

```bash
# Verbose
pnpm --filter forge test:unit -- --reporter=verbose

# Watch + only failed
pnpm --filter forge test:unit -- --watch --onlyFailures

# VS Code: launch.json debug config
{
  "type": "node",
  "request": "launch",
  "name": "vitest current file",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["--filter", "forge", "test:unit", "--", "--"],
  "args": ["${relativeFile}"],
  "console": "integratedTerminal"
}
```

### 4.3 E2E

```bash
# UI mode (opens Playwright inspector)
pnpm --filter forge test:e2e -- --ui

# Trace viewer (after a failure)
pnpm --filter forge test:e2e -- --trace on
pnpm exec playwright show-report apps/forge/playwright-report
```

### 4.4 Database state issues

If an integration test is leaking data, check the cleanup fixture:

```python
@pytest.fixture
async def db_session():
    async with async_session() as session:
        yield session
        await session.rollback()  # or truncate
```

Use the `tenant_factory` fixture to get a clean tenant per test.

## 5. Common pitfalls

| Pitfall                                              | Fix                                                          |
|------------------------------------------------------|--------------------------------------------------------------|
| Tests pass locally, fail in CI                       | Check timezone, env vars, network. Use `freezegun`/`fakeredis`. |
| Flaky on first run, green on retry                   | Add `await asyncio.sleep(0)` or use polling with timeout.   |
| Test takes 30+ seconds                               | It is probably an integration test masquerading as a unit.   |
| Test mutates global state                            | Use `pytest.fixture` with explicit scope.                    |
| Coverage dropped and you don't know why              | `pytest --cov-report=html` then browse `htmlcov/index.html`. |
| Snapshot test changed unexpectedly                   | Diff the snapshot. If legitimate, `pytest --snapshot-update`. |
| "Works on my machine" but CI is red                  | Pin your Python/Node version. Check `pyproject.toml`.        |
| Playwright test times out                            | Increase `timeout` in `playwright.config.ts`, or fix the flake. |
| LangGraph test is non-deterministic                  | Snapshot the *state transitions*, not the message content.   |
| Terminal PTY test produces garbage                   | Add `stty rows 40 cols 200 sane` before the test body.       |

## 6. Pre-commit hooks

We run a subset of checks on commit via `lefthook`:

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    backend-lint:
      run: cd backend && ruff check --fix app tests
    backend-format:
      run: cd backend && ruff format app tests
    frontend-lint:
      run: pnpm -r --filter "./apps/*" lint
    frontend-format:
      run: pnpm -r --filter "./apps/*" prettier --write .
```

Install:

```bash
lefthook install
```

## 7. Where to read more

- Strategy: `docs/testing/test-strategy.md`
- Naming: `docs/testing/test-naming.md`
- LangGraph: `docs/testing/langgraph-integration-tests.md`
- Terminal: `docs/testing/terminal-center-tests.md`
- Pen-test: `docs/testing/security-pen-test.md`
- Standards: `docs/engineering/standards.md`

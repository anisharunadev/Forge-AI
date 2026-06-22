# Testing Patterns

**Analysis Date:** 2026-06-22

This document captures the testing patterns actually used across the
Forge AI monorepo. The canonical strategy is
`docs/testing/test-strategy.md` (test pyramid, mocking boundaries,
coverage floors, flaky-test policy). This file documents the
*implementation* — how tests are written, where they live, and what
patterns are mandatory.

---

## Test Framework

### Frontend (apps/forge)

| Aspect         | Tool                                            |
|----------------|-------------------------------------------------|
| Runner         | **Vitest 2.1.0**                                |
| Assertion      | Vitest's built-in `expect` + `@testing-library/react 16.0.1` + `@testing-library/dom 10.4.0` |
| DOM env        | **jsdom 25.0.1** (configured in `vitest.config.ts`) |
| E2E runner     | **Playwright 1.48.0**                          |
| Config files   | `apps/forge/vitest.config.ts`, `apps/forge/playwright.config.ts` |
| Globals        | `globals: true` (no `import { describe }` shim) — but tests still import explicitly for clarity |

```ts
// apps/forge/vitest.config.ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

### Backend (backend)

| Aspect         | Tool                                            |
|----------------|-------------------------------------------------|
| Runner         | **pytest** (asyncio mode = `auto`)              |
| Async plugin   | `pytest-asyncio` (configured via `asyncio_mode = "auto"`) |
| HTTPX mocks    | `httpx` (used directly for LiteLLM-stubbing + FastAPI TestClient) |
| Time           | `freezegun`, `monkeypatch` (no `unittest.mock` for time, `monkeypatch.setenv` preferred) |
| DB             | In-memory async SQLite via `sqlite+aiosqlite:///:memory:` + SQLAlchemy 2.x metadata |
| Coverage       | `pytest-cov` (`--cov=app`, `--cov-fail-under=70`) |

```toml
# backend/pyproject.toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
addopts = "-ra -q"
```

---

## Run Commands

| Purpose             | Command (frontend)                                  | Command (backend)              |
|---------------------|-----------------------------------------------------|--------------------------------|
| All tests           | `pnpm test` (`vitest run`)                          | `python -m pytest`             |
| One file            | `vitest run tests/connector-card-mcp.test.tsx`      | `pytest tests/test_idea_enhance.py` |
| Watch mode          | `vitest` (no `run`)                                 | `pytest -f`                    |
| Coverage            | `vitest run --coverage`                             | `pytest --cov=app --cov-fail-under=70` |
| E2E                 | `pnpm test:e2e` (`playwright test`)                 | n/a                            |
| Lint                | `pnpm -r --filter "./apps/*" lint` (CI-driven; no local script in `apps/forge/package.json`) | `bash scripts/lint.sh` (ruff + mypy) |
| Typecheck           | `pnpm typecheck` (`tsc --noEmit`)                   | `mypy app`                     |

Per `apps/forge/package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:e2e": "playwright test",
  "typecheck": "tsc --noEmit"
}
```

---

## Test File Organization

### Frontend

```
apps/forge/
├── tests/                       # Unit + integration tests (Vitest)
│   ├── <area>.test.ts           # Top-level modules (timeline, useRealtime)
│   ├── <area>.test.tsx          # React component tests
│   ├── connectors/              # Feature-grouped tests
│   │   └── connector-lifecycle.test.tsx
│   ├── intelligence/            # Project Intelligence
│   │   ├── draft-prd-sections.test.tsx
│   │   ├── epic-card.test.tsx
│   │   └── ...
│   ├── persona/
│   ├── project-intelligence/
│   ├── refactor/
│   ├── validator/
│   └── e2e/                     # Playwright tests
│       ├── 01-smoke.spec.ts
│       ├── 02-command-center.spec.ts
│       ├── ...
│       └── helpers.ts           # Shared Playwright helpers
├── __tests__/                   # Cross-cutting feature tests
│   └── ...
└── components/                  # Source code (no co-located tests here)
```

**Pattern:** tests are organized by **feature area**, not by source
directory. The `tests/intelligence/` folder covers all components and
hooks for the Project Intelligence Center; `tests/e2e/` contains only
Playwright specs.

### Backend

```
backend/
├── tests/
│   ├── conftest.py              # Shared fixtures (autouse env, sqlite_db, event_bus)
│   ├── test_<unit>.py           # Service-level tests
│   ├── test_<unit>_<scenario>.py
│   └── agents/                  # (rare) sub-folder for grouped tests
└── app/                         # Source code (no co-located tests here)
```

**Pattern:** tests live in `backend/tests/` (separate from source).
Source modules do not carry inline `tests.py` files; the convention
described in `docs/testing/test-strategy.md` §8 ("backend tests live
next to code: `backend/app/<module>/tests.py`") is **NOT** yet
implemented in this codebase — every test is in `backend/tests/`.

---

## Test Structure

### Suite Organization

**Frontend (Vitest):**

```typescript
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

describe('<ConnectorDetailPanel>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the detail panel with the right testid and data attributes', () => {
    const { container } = renderWithClient(
      <ConnectorDetailPanel connector={connector()} auditEntries={feed(5)} />,
    );
    const root = container.querySelector('[data-testid="connector-detail"]');
    expect(root).toBeTruthy();
  });
});
```

(Pattern taken from `apps/forge/tests/connector-detail.test.tsx`.)

**Backend (pytest):**

```python
async def test_rotate_updates_config_emits_bus_event_and_reprobes(
    sqlite_db, lifecycle, stub_manager, event_bus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    ...
```

(Pattern taken from `backend/tests/test_connector_lifecycle.py`.)

### Setup / Teardown

- **Vitest**: `beforeEach`/`afterEach` reset timers and restore mocks
  (`vi.useFakeTimers()`, `vi.useRealTimers()`,
  `vi.restoreAllMocks()`). Example:
  `apps/forge/tests/useRealtime.test.ts`.
- **pytest**: `conftest.py` defines an **autouse** fixture
  `_set_test_env` that injects minimum env so pydantic-settings can
  construct `Settings` (`DATABASE_URL`, `REDIS_URL`,
  `LITELLM_PROXY_URL`, `LITELLM_API_KEY`, `KEYCLOAK_URL`,
  `JWT_SECRET`, `ENVIRONMENT=test`).

### Assertion Patterns

- `expect(...).toBe(...)` / `.toEqual(...)` / `.toHaveLength(...)` /
  `.toBeTruthy()` / `.toBeNull()` / `.toContain(...)` /
  `.toMatch(/.../)`.
- For DOM queries, prefer `screen.getByTestId(...)` or
  `screen.getByRole(...)` over `container.querySelector(...)`.
- Forbidden-substring checks are explicit loops over a
  `FORBIDDEN` array (`assertNoRawCredential` in
  `connector-detail.test.tsx`).
- Backend tests use `await session.execute(stmt).scalars().all()` and
  assert against `len(rows)`, `rows[0].target_id`, etc.

---

## Mocking

### Backend

- **LLM calls**: never hit real LiteLLM. Tests use
  `unittest.mock.AsyncMock`, `patch.object`, or scripted MCP clients
  (see `backend/tests/test_architecture_core.py::_FakeLLM`,
  `backend/tests/test_jira_push_real.py::_fake_jira_create_issue_handler`).
- **Event bus**: in-memory via `conftest.py` `event_bus` fixture
  (`EventBus(use_redis=False)`).
- **DB**: real SQLite in-memory via `sqlite_db` fixture. RLS is not
  exercised at this layer (SQLite lacks it); integration tests use
  real Postgres via testcontainers per
  `docs/testing/test-strategy.md` §4.
- **Module-level singletons**: `monkeypatch.setattr(module, "name", fake)`
  pattern, not `patch()`. See `backend/tests/test_ideation.py`
  patching `kg_mod.freshness_ledger` and `event_bus_mod.bus`.
- **LiteLLM proxy URL**: stubbed at the transport layer (httpx mock)
  or by patching `litellm_client` directly.
- **What NOT to mock**: the database (`docs/testing/test-strategy.md`
  §4: "Never mock the database unless you are doing pure logic work.
  RLS bugs hide behind mocks.").

### Frontend

- **WebSocket**: install a fake constructor on `globalThis` and cast
  through `unknown` (see `useRealtime.test.ts`):
  ```typescript
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  const wsImpl = FakeWebSocket as unknown as typeof WebSocket;
  return renderHook(() => useRealtime({ WebSocketImpl: wsImpl, ...opts }));
  ```
- **fetch**: `vi.spyOn(globalThis, 'fetch')` per the documented
  project convention (see `ideation-enhance.test.tsx`,
  `persona-memory-panel.test.tsx`, `ideation-push-jira.test.tsx`).
- **Next.js router**: `vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))` (see `apps/forge/tests/refactor/page.test.tsx`).
- **TanStack Query**: tests wrap the component in a fresh `QueryClient`
  with `retry: false` to keep mutations fast and deterministic:
  ```typescript
  function renderWithClient(ui: React.ReactElement) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  }
  ```
  Used in `connector-lifecycle.test.tsx`,
  `ideation-enhance.test.tsx`, `persona-memory-panel.test.tsx`,
  `connector-detail.test.tsx`.
- **Custom hooks** (e.g. `use-toast`): `vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [] }),
}))` (see `connector-lifecycle.test.tsx`).
- **What NOT to mock**: prefer real implementations of pure helpers
  (`cn`, `backoffMsFor`) and use fake constructors only for
  network-shaped dependencies (WS, fetch).

---

## Fixtures and Factories

### Backend Fixtures (conftest.py)

- `event_bus` — in-memory event bus
  (`EventBus(use_redis=False)`).
- `sqlite_db` — async in-memory SQLite engine with all models
  registered against `base.metadata`. Stubbed `projects` table for FK
  resolution. Monkeypatches `session_mod._engine` /
  `session_mod._session_factory` for the lifetime of the test.
- `_set_test_env` (autouse) — env injection for pydantic-settings.

Per-test helpers (private to each test file) build typed seed rows:

```python
async def _seed_idea(sqlite_db, *, tenant_id: str, project_id: str) -> Idea:
    factory = get_session_factory()
    async with factory() as session:
        idea = Idea(id=uuid.uuid4(), tenant_id=tenant_id, ...)
        session.add(idea)
        await session.commit()
        await session.refresh(idea)
    return idea
```

(From `backend/tests/test_idea_enhance.py`.)

Class-based fakes capture calls and provide canned responses:

```python
class _StubManager:
    def __init__(self) -> None:
        self.created: list[dict] = []
        self.updated: list[dict] = []
        self.tested: list[str] = []
    ...
```

(From `backend/tests/test_connector_lifecycle.py`.)

### Frontend Fixtures

- Inline factory functions named `<thing>()` or `<thing>Fixture()`
  inside each test file:
  ```typescript
  function connector(overrides: Partial<McpConnector> = {}): McpConnector {
    return { id: "jira", name: "jira", ...overrides };
  }
  function feed(n: number): ReadonlyArray<AuditEntry> {
    return Array.from({ length: n }, (_, i) => entry({}, i));
  }
  ```
  (Pattern from `apps/forge/tests/connector-detail.test.tsx`.)
- `renderWithClient(ui)` helper — fresh `QueryClient` wrapper.
- `setup(page)` / `navigateTo(page, path)` — shared Playwright
  helpers in `tests/e2e/helpers.ts`.

---

## Coverage

### Targets (per `docs/testing/test-strategy.md` §2)

| Surface                       | Line | Branch | Function | Enforced by            |
|-------------------------------|------|--------|----------|------------------------|
| Backend (overall)             | 80%  | 70%    | 85%      | `ci-backend.yml`       |
| Frontend (overall)            | 70%  | 60%    | 80%      | `ci-frontend.yml`      |
| Cost ledger                   | 95%+ | 90%    | 100%     | Critical path          |
| Auth (login, refresh, logout) | 95%+ | 90%    | 100%     | Critical path          |
| Row-Level Security policies   | 95%+ | 90%    | 100%     | Critical path          |
| Approval gate (LangGraph)     | 95%+ | 90%    | 100%     | Critical path          |
| LLM Proxy / cost attribution  | 95%+ | 90%    | 100%     | Critical path          |

**Current CI gate:** `pytest --cov-fail-under=70` (the backend floor
is set to **70** in CI rather than the 80% target in the strategy
doc — see `.github/workflows/ci-backend.yml`). Dropping below this
fails the build.

### View Coverage

```bash
# Backend
cd backend
pytest --cov=app --cov-report=html --cov-report=term

# Frontend
cd apps/forge
pnpm test -- --coverage
# Produces apps/forge/coverage/ (uploaded as artifact)
```

---

## Test Types

### Unit Tests (Tier 1, ~50%)

- **What:** Pure functions, parsers, hooks in isolation, RBAC checks.
- **Where:**
  - Frontend: `apps/forge/tests/*.test.ts` (e.g. `timeline.test.tsx`,
    `useRealtime.test.ts`, `connector-rbac.test.ts`).
  - Backend: `backend/tests/test_<unit>.py` (e.g. `test_idea_enhance.py`,
    `test_persona_memory_store.py`).
- **Speed target:** < 5 ms per test (per
  `docs/testing/test-strategy.md` §1 pyramid).
- **Coverage:** `require_permission`, dataclasses, parsers, parsers,
  pure helpers (`backoffMsFor`, `parseRequirementBrief`).

### Integration Tests (Tier 2, ~15%)

- **What:** Service boundaries with real DB + bus + LiteLLM stub.
- **Where:** `backend/tests/test_ideation.py` (~25 KB, the largest
  integration suite), `test_architecture_core.py`,
  `test_connector_lifecycle.py`, `test_daily_ingest_job.py`.
- **Stack:** `sqlite_db` + `event_bus` + scripted MCP clients +
  patched module-level singletons via `monkeypatch.setattr`.
- **Frontend integration:** components that wrap TanStack Query or
  call `/api/proxy` — exercised with `renderWithClient` + `vi.spyOn`
  fetch (`connector-lifecycle.test.tsx`,
  `ideation-push-jira.test.tsx`).

### E2E Tests (Tier 3, ~5%)

- **What:** Critical user journeys, mockable backend responses,
  persona navigation.
- **Where:** `apps/forge/tests/e2e/`
  (`01-smoke.spec.ts` through `13-project-intelligence.spec.ts`).
- **Runner:** Playwright with webServer auto-start
  (`pnpm dev` unless `FORGE_NO_WEBSERVER` is set).
- **Helper:** `setup(page)`, `navigateTo(page, path)`,
  `expectToast(page, text)`, `dismissToasts(page)`,
  `isBackendReachable(page)` (in `tests/e2e/helpers.ts`).
- **Mocking pattern:** `page.route('**/api/v1/forge-commands/**',
  async (route) => { await route.fulfill({ ... }); })`
  (`02-command-center.spec.ts`).
- **Selector strategy:** `data-testid` attributes on every
  meaningful UI element, `getByRole(...)` for headings, `getByLabel`
  for inputs.

### Critical Path Tests

- Auth (`backend/tests/test_approval_decide_wire.py`,
  `test_ideation_push_rbac.py`).
- Cost ledger (not yet present; placeholder per
  `docs/testing/test-strategy.md` §2 — TODO in backlog).
- RLS (covered at the schema layer; full integration via
  testcontainers in CI per §4).

---

## Common Patterns

### Async Testing (Backend)

```python
pytestmark = pytest.mark.asyncio

async def test_submit_idea_basic(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    assert isinstance(idea, Idea)
    assert idea.status == IdeaStatus.NEW
```

With `asyncio_mode = "auto"` in `pyproject.toml`, every `async def
test_*` function is automatically wrapped — no decorator required
(though `@pytest.mark.asyncio` is also used explicitly in some files
like `test_daily_ingest_job.py` and `test_persona_memory_store.py`).

### Error Testing (Backend)

```python
async def test_get_agent_raises_404_for_other_tenant():
    with pytest.raises(HTTPException) as exc_info:
        await get_agent(agent_id, principal=other_tenant_principal)
    assert exc_info.value.status_code == 404
```

Or simply assert the raised exception directly when calling a service:

```python
def test_xxx_raises_when_yyy():
    with pytest.raises(LookupError):
        await stub_manager.get_connector(bad_id)
```

(Pattern from `_StubManager.get_connector` in
`test_connector_lifecycle.py`.)

### Timer / Fake Time (Frontend)

```typescript
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

act(() => vi.advanceTimersByTime(1_100));
```

(Pattern from `apps/forge/tests/useRealtime.test.ts` — needed for the
exponential backoff + poll-fallback tests.)

### Async-Await UI Events (Frontend)

```typescript
act(() => sock.openNow());
act(() => sock.sendFrame({ topic: 'run.updated', envelope: { x: 1 } }));
```

Wrap every state-affecting event in `act(...)` so React commits the
update synchronously.

### Mocking Module Resolvers (Frontend)

```typescript
vi.mock('@/lib/hooks/useMigrationPlans', () => ({
  useMigrationPlans: (...args: unknown[]) => mockUseMigrationPlans(...args),
}));
```

Declare module mocks at the **top** of the test file (before the
import under test) so the hoisted mock is in place before the module
graph is resolved.

---

## Test Data Conventions

Per `docs/testing/test-strategy.md` §6:

- **Tenants:** synthetic UUIDs; `acme`, `beta-corp` are reserved for
  integration fixtures (`backend/tests/tenants.py`).
- **Users:** synthetic `users[0]@forge.test`.
- **Cost ledger:** `decimal.Decimal`, never `float`; tests assert
  exact cents.
- **No real PII, customer data, or secrets** in any test file.

---

## Flaky Test Policy

Per `docs/testing/test-strategy.md` §7:

1. CI auto-retries failing tests once; passing on retry marks the test
   `flaky` (PR still merges with a warning).
2. A `flaky` annotation opens a Jira ticket auto-assigned to the
   file's owning team.
3. Three flakes in a week → test is quarantined (skipped by default,
   runs only on nightly quarantine lane).
4. Quarantined tests not fixed within 14 days are deleted.

In practice the codebase uses `vi.useFakeTimers()` and the
`sqlite_db` fixture to keep flakiness low. The Playwright config sets
`fullyParallel: false` to avoid cross-test interference in
`apps/forge/playwright.config.ts`.

---

## CI Wiring

| File                              | Steps                                                                |
|-----------------------------------|----------------------------------------------------------------------|
| `.github/workflows/ci-backend.yml`| ruff check, ruff format check, mypy, pytest + coverage (--cov-fail-under=70), integration tests via docker compose, coverage to Codecov |
| `.github/workflows/ci-frontend.yml`| ESLint, Prettier check, tsc --noEmit, vitest --coverage, Playwright e2e, next build, bundle analysis |
| `.github/workflows/ci-monorepo.yml`| ADR / NFR reference check on every PR                                |
| `.github/workflows/security-scan.yml`| Security scanning (referenced from strategy §5)                   |

---

## Required References on Every PR

Per `docs/testing/test-strategy.md` §9, every PR description must
link the **ADR**, **NFR**, or **FR** it implements. CI's
`ci-monorepo.yml` `adr-consistency` job warns when a code change has
no such reference.

---

## Where to Add New Tests

| New code type                                | Test location                                                          |
|----------------------------------------------|------------------------------------------------------------------------|
| Backend service `app/services/<x>.py`        | `backend/tests/test_<x>.py`                                            |
| Backend API endpoint `app/api/v1/<x>.py`     | `backend/tests/test_<x>.py`                                            |
| Frontend hook `lib/<x>.ts`                   | `apps/forge/tests/<x>.test.ts`                                         |
| Frontend component `components/<area>/<X>.tsx`| `apps/forge/tests/<area>/<x>.test.tsx` (feature-grouped)              |
| New persona / page                           | `apps/forge/tests/e2e/<NN>-<page>.spec.ts`                             |
| Critical path (auth, cost, RLS, approval)    | Add a Tier-2 integration test that fails CI when coverage drops below 95% |

---

*Testing analysis: 2026-06-22*

# Standard: Testing

> **Status:** ✅ Canonical — every backend service + frontend component has tests
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/tests/` + `apps/forge/tests/`
> **Last updated:** 2026-06-30

---

## Purpose

Forge is an enterprise platform. Tests aren't optional. Every backend service has unit + integration tests; every frontend component has at least one rendering test; critical paths have E2E coverage. This document codifies the **test pyramid**, **coverage targets**, and **patterns** that keep tests reliable, fast, and useful.

---

## Source of truth

- **This file** — `/workspace/docs/standards/testing.md`
- **Backend tests** — `backend/tests/` (pytest + pytest-asyncio)
- **Frontend tests** — `apps/forge/tests/` (Vitest + React Testing Library)
- **E2E tests** — `apps/forge/e2e/` (Playwright)
- **Pytest config** — `backend/pyproject.toml` (`[tool.pytest.ini_options]`)
- **CI** — `.github/workflows/ci-backend.yml` + `ci-frontend.yml` + `lighthouse.yml`

---

## 1. Test pyramid

```
           /\
          /E2E\              ← Playwright (5% of tests)
         /─────\               Critical user journeys only
        / Intg  \            ← pytest integration (20%)
       /─────────\              Real DB + Redis + LiteLLM stub
      /   Unit    \          ← pytest unit + Vitest (75%)
     /───────────────\         Pure functions, isolated logic
```

**Distribution targets:**
- **75% unit** — fast, isolated, no I/O
- **20% integration** — real DB + Redis, mocked LiteLLM
- **5% E2E** — Playwright, critical paths only

---

## 2. Backend tests (pytest + pytest-asyncio)

### 2.1 — Test layout

```
backend/tests/
├── conftest.py                # Global fixtures (db_session, principal, redis_stub)
├── agents/                    # LangGraph sub-graph tests
│   ├── test_sdlc_agent.py
│   ├── test_refactor_agent.py
│   └── test_code_validator.py
├── api/                       # Route handler tests
│   └── v1/
│       ├── test_workflows.py
│       ├── test_seeds.py
│       └── test_admin_llm_gateway.py
├── copilot/                   # Co-pilot service tests
│   ├── test_copilot_budget.py
│   ├── test_copilot_security.py
│   └── test_copilot_service.py
├── integrations/              # External integration tests
│   └── litellm/
│       ├── conftest.py        # Stub LiteLLM client
│       └── test_usage_query.py
├── schemas/                   # Pydantic validation tests
│   ├── test_migration_plan.py
│   └── test_validation_report.py
├── services/                  # Service layer tests
│   ├── test_workflow_executor.py
│   └── test_seed_service.py
└── test_<feature>.py          # Top-level feature tests
```

### 2.2 — Global fixtures (`conftest.py`)

```python
# backend/tests/conftest.py
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.session import get_engine
from app.core.security import AuthenticatedPrincipal
from app.db.models.tenant import Tenant


@pytest_asyncio.fixture
async def db_session():
    """Yields a transactional DB session; rolls back after test."""
    engine = get_engine()
    async with async_sessionmaker(engine)() as session:
        try:
            yield session
        finally:
            await session.rollback()


@pytest_asyncio.fixture
async def principal(db_session):
    """Yields a test principal in the `acme-corp` test tenant."""
    tenant = await db_session.get(Tenant, ACME_TENANT_ID)
    return AuthenticatedPrincipal(
        actor_id=UUID("00000000-0000-4000-8000-000000000001"),
        tenant_id=tenant.id,
        project_id=UUID("00000000-0000-4000-8000-000000000002"),
        scopes=["seeds:view", "seeds:manage"],
        email="test@acme-corp.com",
    )


@pytest_asyncio.fixture
async def litellm_stub(monkeypatch):
    """Replaces LiteLLMClient with a deterministic stub."""
    from app.core import litellm_client

    class StubLLM:
        async def acompletion(self, **kwargs):
            return {"choices": [{"message": {"content": "{}"}}]}

        async def aembeddings(self, **kwargs):
            return {"data": [{"embedding": [0.0] * 1536}]}

    monkeypatch.setattr(litellm_client, "LiteLLMClient", StubLLM)
    return StubLLM()
```

### 2.3 — Unit test pattern (no I/O)

```python
# backend/tests/schemas/test_migration_plan.py
import pytest
from pydantic import ValidationError

from app.schemas.migration_plan import MigrationPlan, MigrationPhase


def test_migration_plan_minimum_required_fields():
    """MigrationPlan requires id + tenant_id + project_id + phased_plan + effort_estimate."""
    plan = MigrationPlan(
        tenant_id=UUID("00000000-0000-4000-8000-000000000ace"),
        project_id=UUID("00000000-0000-4000-8000-000000000002"),
        phased_plan=[
            MigrationPhase(
                order=1,
                name="Phase 1",
                description="Initial migration phase",
            )
        ],
        source_inventory=SourceInventory(...),
        target_architecture=TargetArchitecture(...),
        effort_estimate=EffortEstimate(total_effort_days=5.0),
    )
    assert plan.generated_by == "refactor_agent"
    assert plan.schema_version == "1.0.0"


def test_migration_plan_rejects_extra_fields():
    """extra='forbid' rejects unknown fields (R4 enforcement)."""
    with pytest.raises(ValidationError) as exc_info:
        MigrationPlan(
            tenant_id=UUID("..."),
            project_id=UUID("..."),
            phased_plan=[],
            effort_estimate=EffortEstimate(total_effort_days=0),
            unknown_field="bad",  # ← rejected
        )
    assert "unknown_field" in str(exc_info.value)
```

### 2.4 — Integration test pattern (real DB + Redis)

```python
# backend/tests/api/v1/test_seeds.py
import pytest

pytestmark = pytest.mark.asyncio


async def test_apply_seed_creates_seed_run(db_session, principal):
    """POST /seeds/{name}/apply creates a SeedRun record."""
    from app.services.seed_service import SeedService
    from app.api.v1.seeds import apply_seed

    # Arrange: seed service + idempotent request
    service = SeedService(session_factory=lambda: db_session)
    request = SeedApplyRequest(allow_in_prod=False)

    # Act
    response = await apply_seed(
        name="acme-corp",
        body=request,
        principal=principal,
        db=db_session,
    )

    # Assert
    assert response.seed_name == "acme-corp"
    assert response.status in {"running", "completed"}

    # Cleanup
    await db_session.execute(delete(SeedRun).where(SeedRun.id == response.id))


async def test_apply_seed_requires_seeds_manage_permission(db_session, principal):
    """Principal without 'seeds:manage' gets 403."""
    principal.scopes = []  # remove all scopes
    with pytest.raises(HTTPException) as exc_info:
        await apply_seed(name="acme-corp", body=SeedApplyRequest(), principal=principal, db=db_session)
    assert exc_info.value.status_code == 403


async def test_cross_tenant_seed_returns_404(db_session, principal):
    """Seed belonging to another tenant returns 404 (not 403 — no enumeration)."""
    # Create a seed in tenant B
    other_tenant = Tenant(slug="beta-ind", name="Beta Industries")
    db_session.add(other_tenant)
    await db_session.flush()

    # Try to access from tenant A's principal
    with pytest.raises(HTTPException) as exc_info:
        await get_seed(name="acme-corp", principal=principal, db=db_session)
    assert exc_info.value.status_code == 404
```

### 2.5 — LangGraph agent test pattern

```python
# backend/tests/agents/test_refactor_agent.py
import pytest
from app.agents.refactor_agent import build_refactor_graph
from app.agents.refactor_agent_state import RefactorAgentState


@pytest.mark.asyncio
async def test_refactor_graph_full_pipeline(litellm_stub):
    """End-to-end pipeline: inventory → plan → phases → risks → push."""
    graph = build_refactor_graph()

    initial_state: RefactorAgentState = {
        "run_id": "test-run-001",
        "tenant_id": "00000000-0000-4000-8000-000000000ace",
        "project_id": "00000000-0000-4000-8000-000000000002",
        "source_repo_url": "https://github.com/acme/monolith",
        "source_language": "java",
        "target_language": "kotlin",
        "target_framework": "spring-boot",
    }

    result = await graph.ainvoke(initial_state)

    # Assert all 5 nodes ran
    assert "source_inventory" in result
    assert "target_architecture" in result
    assert "phased_plan" in result
    assert len(result["phased_plan"]) >= 1  # at least one phase
    assert "risk_register" in result


@pytest.mark.asyncio
async def test_refactor_graph_handles_aws_transform_failure(litellm_stub, monkeypatch):
    """inventory_source failure → graceful abort."""
    async def failing_inventory(*args, **kwargs):
        raise AWSTransformUnavailableError("AWS Transform down")

    monkeypatch.setattr("app.agents.refactor_agent._inventory_node", failing_inventory)
    graph = build_refactor_graph()

    result = await graph.ainvoke({...})
    assert result["errors"]  # error recorded
    assert "phased_plan" not in result  # downstream didn't run
```

### 2.6 — LiteLLM stub pattern (CRITICAL — R1)

```python
# backend/tests/integrations/litellm/conftest.py
import pytest


@pytest.fixture
def litellm_stub(monkeypatch):
    """Replaces LiteLLMClient with a deterministic stub.

    CRITICAL: All tests use this stub. NEVER hit a real LLM provider
    in tests — costs money + adds flakiness.
    """
    from app.core import litellm_client

    class StubLLM:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.calls = []

        async def acompletion(self, **kwargs):
            self.calls.append(kwargs)
            # Return deterministic response based on prompt content
            prompt = kwargs["messages"][-1]["content"]
            if "refactor" in prompt.lower():
                content = '{"phased_plan": [{"order": 1, "name": "Phase 1"}], "risk_register": []}'
            else:
                content = '{"result": "ok"}'
            return {
                "choices": [{"message": {"content": content}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
            }

        async def aembeddings(self, **kwargs):
            return {"data": [{"embedding": [0.0] * 1536}]}

    stub = StubLLM()
    monkeypatch.setattr(litellm_client, "LiteLLMClient", lambda **kwargs: stub)
    return stub
```

---

## 3. Frontend tests (Vitest + React Testing Library)

### 3.1 — Test layout

```
apps/forge/tests/
├── ai-native/                 # AI-native component tests
│   └── panels.test.tsx
├── audit/                     # Audit timeline tests
│   └── audit-timeline-virtualized.test.tsx
├── charts/                    # Chart component tests
│   └── chart-card.test.tsx
├── components/                # Component tests
│   └── seeds/
│       └── DemoBanner.test.tsx
├── connector-card-mcp.test.tsx
└── ... (per-feature)
```

### 3.2 — Component test pattern

```typescript
// apps/forge/tests/components/seeds/DemoBanner.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DemoBanner } from '@/components/seeds/DemoBanner';

describe('DemoBanner', () => {
  it('renders drift warning when checksumStatus is "drift"', () => {
    render(<DemoBanner checksumStatus="drift" seedName="acme-corp" rowCount={42} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/drift detected/i);
  });

  it('renders success state when applied', () => {
    render(<DemoBanner checksumStatus="match" seedName="acme-corp" rowCount={42} />);
    expect(screen.getByText(/acme-corp/i)).toBeInTheDocument();
  });

  it('renders nothing when isDemoTenant is false', () => {
    const { container } = render(
      <DemoBanner isDemoTenant={false} seedName="acme-corp" applied rowCount={42} />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

### 3.3 — Hook test pattern

```typescript
// apps/forge/tests/hooks/useMigrationPlans.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { useMigrationPlans } from '@/lib/hooks/useMigrationPlans';

vi.mock('@/lib/api', () => ({
  listMigrationPlans: vi.fn().mockResolvedValue([
    { planId: 'plan-001', status: 'in_progress', phases: [] },
  ]),
}));

describe('useMigrationPlans', () => {
  it('polls every 30s', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMigrationPlans('project-forge-demo'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.refetchInterval).toBe(30_000);
  });
});
```

### 3.4 — Accessibility test (axe-core)

```typescript
// apps/forge/tests/accessibility/seeds-page.test.ts
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

import { AdminSeedsPage } from '@/app/admin/seeds/page';

expect.extend(toHaveNoViolations);

describe('AdminSeedsPage accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(<AdminSeedsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

---

## 4. E2E tests (Playwright)

### 4.1 — Layout

```
apps/forge/e2e/
├── auth.spec.ts                # Login flow
├── seeds.spec.ts               # Seed apply + reset + rollback
├── workflows.spec.ts           # Workflow create + run + pause
├── co-pilot.spec.ts            # Open panel + send message + receive response
└── critical-journeys.spec.ts   # End-to-end demo
```

### 4.2 — Pattern

```typescript
// apps/forge/e2e/seeds.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Seeds', () => {
  test.beforeEach(async ({ page }) => {
    // Login as steward
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'steward@acme-corp.com');
    await page.fill('[data-testid="password"]', 'dev-password-change-in-prod');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('/dashboard');
  });

  test('steward can apply acme-corp seed', async ({ page }) => {
    await page.goto('/admin/seeds');
    await page.click('[data-testid="apply-seed-button"]');
    await page.click('[data-testid="apply-confirm"]');

    // Wait for seed run to complete
    await expect(page.getByTestId('seed-status')).toContainText(/applied/i, {
      timeout: 30_000,
    });
  });

  test('PM cannot apply seed (403)', async ({ page, context }) => {
    // Switch to PM user via persona cookie
    await context.addCookies([
      { name: 'forge.persona', value: 'pm', domain: 'localhost', path: '/' },
    ]);

    await page.goto('/admin/seeds');

    // PM sees the page but the apply button is hidden or disabled
    await expect(page.getByTestId('apply-seed-button')).toBeDisabled();
  });
});
```

### 4.3 — CI integration

```yaml
# .github/workflows/e2e.yml
- name: E2E tests
  run: |
    docker compose up -d
    pnpm playwright install
    pnpm playwright test
```

---

## 5. Coverage targets

| Layer | Target | Minimum |
|---|---|---|
| **Backend services** (`app/services/`) | 90% | 80% |
| **Backend API** (`app/api/`) | 85% | 75% |
| **Backend schemas** (`app/schemas/`) | 95% | 90% |
| **Backend agents** (`app/agents/`) | 80% | 70% |
| **Frontend components** (`components/`) | 75% | 60% |
| **Frontend hooks** (`lib/hooks/`) | 90% | 80% |
| **E2E critical journeys** | 100% | 100% |

**Per-PR check:** CI fails if any line's coverage drops below minimum.

### 5.1 — Coverage exemptions

The following are exempt from coverage checks:
- Generated files (`*.generated.ts`)
- Type-only files (`types.ts`)
- Config files (`config.py`, `next.config.ts`)
- Migration scripts (`migrations/versions/*.py`)

---

## 6. Test data

### 6.1 — Test fixtures (`conftest.py`)

```python
# Standard tenant UUIDs (used across all tests)
ACME_TENANT_ID = UUID("00000000-0000-4000-8000-000000000ace")
ACME_PROJECT_ID = UUID("00000000-0000-4000-8000-000000000002")
BETA_TENANT_ID = UUID("00000000-0000-4000-8000-000000000bee")
```

### 6.2 — Test seed data (`backend/scripts/seed_test.py`)

Idempotent test seed that resets the DB to a known state.

```bash
python backend/scripts/seed_test.py --reset
```

### 6.3 — Factory pattern

```python
# backend/tests/factories.py
import factory
from app.db.models.story import Story


class StoryFactory(factory.alchemy.SQLAlchemyModelFactory):
    class Meta:
        model = Story
        sqlalchemy_session_persistence = "commit"

    tenant_id = ACME_TENANT_ID
    project_id = ACME_PROJECT_ID
    title = factory.Sequence(lambda n: f"Story #{n}")
    status = "draft"


# Usage
story = StoryFactory()
```

---

## 7. Linting + formatting

### 7.1 — Python (Ruff)

```toml
# backend/pyproject.toml
[tool.ruff]
line-length = 100
target-version = "py313"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "SIM", "PL"]
ignore = ["PLR0913", "PLR2004", "B008"]
```

**Commands:**
```bash
# Format
ruff format backend/

# Lint
ruff check backend/ --fix

# Type-check
mypy backend/app/
```

### 7.2 — TypeScript (ESLint + Prettier)

```bash
# Format
pnpm prettier --write apps/forge/

# Lint
pnpm eslint apps/forge/ --fix

# Type-check
pnpm tsc --noEmit
```

### 7.3 — Pre-commit hook

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    hooks:
      - id: ruff
        files: ^backend/
      - id: ruff-format
        files: ^backend/

  - repo: https://github.com/pre-commit/mirrors-prettier
    hooks:
      - id: prettier
        files: ^apps/forge/
```

---

## 8. CI pipeline

### 8.1 — `.github/workflows/ci-backend.yml`

```yaml
name: Backend CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.13'

      - name: Install dependencies
        run: |
          cd backend
          pip install -e ".[test]"

      - name: Lint
        run: |
          cd backend
          ruff check .
          ruff format --check .

      - name: Type-check
        run: |
          cd backend
          mypy app/

      - name: Run tests
        run: |
          cd backend
          pytest --cov=app --cov-report=xml --cov-fail-under=80

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

### 8.2 — `.github/workflows/ci-frontend.yml`

```yaml
name: Frontend CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install
        run: pnpm install

      - name: Lint
        run: pnpm lint

      - name: Type-check
        run: pnpm tsc --noEmit

      - name: Run tests
        run: pnpm test --coverage

      - name: Lighthouse
        run: pnpm lhci autorun
```

---

## 9. Forbidden patterns

### 9.1 — Backend

```python
# ❌ No LLM stub in tests (costs money + flaky)
def test_real_openai_call():
    response = openai.ChatCompletion.create(...)  # FORBIDDEN

# ❌ No shared state across tests
GLOBAL_USER = create_user()  # Banned — use fixtures

# ❌ No sleep (use deterministic waits)
import time
time.sleep(5)  # Banned — use poll_until()

# ❌ No real database in unit tests
@pytest.fixture
def real_db():
    return create_engine("postgresql://prod...")  # Use test DB or transactional rollback

# ❌ No `if __name__ == "__main__"` in tests (use pytest)
if __name__ == "__main__":
    test_apply_seed()  # Banned
```

### 9.2 — Frontend

```typescript
// ❌ No real fetch in tests
fetch('/api/v1/seeds');  // Mock the api module instead — see `tests/copilot/hooks.test.tsx`
//   and `tests/copilot/knowledge-hooks.test.tsx` for the `vi.mock('../../lib/api/client', …)`
//   pattern. MSW is NOT installed in this repo.

// ❌ No real timers in component tests
setTimeout(() => ..., 1000);  // Use vi.useFakeTimers()

// ❌ No real localStorage in tests
localStorage.setItem('key', 'value');  // Use vi.stubGlobal

// ❌ No console.log in tests
console.log('debug:', data);  // Banned — use screen.debug() or testing-library queries
```

---

## 10. Verification checklist

- [ ] Every backend service has unit + integration tests
- [ ] Every Pydantic schema has validation tests
- [ ] Every LangGraph agent has graph-level tests
- [ ] Every frontend component has at least 1 test
- [ ] Every TanStack Query hook has polling + enabled tests
- [ ] Every mutating route has RBAC + 403 tests
- [ ] Every cross-tenant query has 404 tests
- [ ] Every LLM call is stubbed (no real provider in tests)
- [ ] Every accessibility-sensitive page has axe-core test
- [ ] Lighthouse CI passes (Accessibility ≥ 90)
- [ ] Coverage meets minimum thresholds (services ≥ 80%, components ≥ 60%)
- [ ] Pre-commit hook passes (Ruff + Prettier + TypeScript)
- [ ] No skipped tests (`pytest.skip()` or `it.skip()` without justification)
- [ ] No flaky tests (CI fails if test fails 2x in a row)

---

## Related docs

- [Architecture rules](./architecture-rules.md)
- [Coding standards](./coding-standards.md)
- [Design system](./design-system.md)
- [API conventions](./api-conventions.md)
- [Data model](./data-model.md)
- [Git workflow](./git-workflow.md)
- [LiteLLM integration](./litellm-integration.md)
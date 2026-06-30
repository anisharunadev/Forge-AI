# Reference: Test Scripts (Backend API Smoke Tests)

> **Status:** ✅ Canonical — how to smoke-test the backend before deploying
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/scripts/` + `backend/tests/`
> **Last updated:** 2026-06-30

---

## Purpose

Beyond the pytest suite (`backend/tests/`), Forge ships **standalone smoke-test scripts** that exercise the backend API end-to-end against a live server. These are the scripts you run before deploying, after upgrading, or when diagnosing production-like issues locally.

This document catalogs the scripts, their scope, and how to run them.

---

## Source of truth

- **This file** — `/docs/reference/test-scripts.md`
- **Backend scripts** — `backend/scripts/`
- **Pytest suite** — `backend/tests/` (covered separately by `/docs/standards/testing.md`)
- **CI workflows** — `.github/workflows/ci-backend.yml` + `ci-seed.yml`

---

## Scripts inventory

### `backend/scripts/seed_agents.py`

**Purpose:** Seed agents + model providers for the acme-corp tenant.

**Scope:** Inserts 6 common agent patterns (Claude Code, Codex, Gemini CLI, Kimi CLI, Copilot, Cursor) + 4 model providers (Anthropic, OpenAI, Bedrock, Vertex).

**When to run:**
- After initial DB migration (first-time setup)
- After `reset --scope=all` (re-seed agents)
- When upgrading Agent Center UI (ensure demo data is fresh)

**How to run:**

```bash
# In Docker
docker compose exec backend python -m scripts.seed_agents

# Locally (with venv active)
cd backend && python -m scripts.seed_agents
```

**Output:**
```
INFO:seed_agents:Seeded 6 agents
INFO:seed_agents:Seeded 4 model providers
```

**Idempotent:** Yes — uses ON CONFLICT to skip duplicates.

**More info:** See [Features: Agent Center](../features/agent-center.md).

### `backend/scripts/test_agents_api.py`

**Purpose:** Smoke test the Agent Center API endpoints.

**Scope:** Verifies:
- `GET /api/v1/agents` returns the seeded 6 agents
- `GET /api/v1/agents/{id}` returns one agent
- `GET /api/v1/agents/{id}/executions` returns empty list
- `GET /api/v1/model-providers` returns the seeded 4 providers
- `GET /api/v1/model-providers/{id}/models` returns models
- RBAC: PM gets 403 on `POST /api/v1/agents`
- RBAC: Steward gets 200 on `POST /api/v1/agents`
- Cross-tenant returns 404

**When to run:**
- After backend deploy (smoke test)
- After Agent Center schema changes
- After RBAC changes

**How to run:**

```bash
# Requires the backend running on localhost:8000
docker compose up -d backend
docker compose exec backend python -m scripts.test_agents_api

# Locally
cd backend && python -m scripts.test_agents_api
```

**Output:**
```
✓ GET /agents returned 6 agents
✓ GET /agents/{id} returned Claude Code agent
✓ GET /agents/{id}/executions returned []
✓ GET /model-providers returned 4 providers
✓ GET /model-providers/{id}/models returned [...]
✓ POST /agents as PM: 403 (RBAC enforced)
✓ POST /agents as Steward: 200 (RBAC OK)
✓ Cross-tenant: 404 (RLS enforced)
✓ All smoke tests passed.
```

**Exit codes:**
- 0 — all tests passed
- 1 — at least one test failed (CI fails fast)

---

## Smoke-test pattern (for writing new scripts)

When adding a new feature, ship a matching smoke-test script. The pattern:

```python
#!/usr/bin/env python3
"""Smoke test for <feature> API endpoints.

Exercises the critical paths:
- GET list
- GET one
- POST create (RBAC + idempotency)
- PATCH update
- DELETE (soft delete)
- Cross-tenant returns 404

Run with: docker compose exec backend python -m scripts.test_<feature>_api
"""
from __future__ import annotations

import asyncio
import logging
import sys
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger("test_<feature>_api")
logging.basicConfig(level=logging.INFO, format="%(message)s")

BASE_URL = f"http://localhost:8000"


def auth_headers(persona: str) -> dict[str, str]:
    """Build auth headers for a persona."""
    return {
        "Authorization": f"Bearer <test-token-for-{persona}>",
        "X-Forge-Persona": persona,
    }


def assert_status(response: httpx.Response, expected: int, label: str) -> None:
    """Assert response status; print label + actual on failure."""
    if response.status_code != expected:
        logger.error(f"❌ {label}: expected {expected}, got {response.status_code}")
        logger.error(f"   Body: {response.text[:200]}")
        sys.exit(1)
    logger.info(f"✓ {label}: {response.status_code}")


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        # 1. GET list
        r = await client.get("/api/v1/<resources>", headers=auth_headers("eng-lead"))
        assert_status(r, 200, "GET /<resources>")
        items = r.json()
        assert len(items) > 0, "Expected seeded items"

        # 2. GET one
        first_id = items[0]["id"]
        r = await client.get(f"/api/v1/<resources>/{first_id}", headers=auth_headers("eng-lead"))
        assert_status(r, 200, f"GET /<resources>/{first_id}")

        # 3. RBAC: PM cannot POST
        r = await client.post("/api/v1/<resources>", headers=auth_headers("pm"), json={...})
        assert_status(r, 403, "POST /<resources> as PM")

        # 4. RBAC: Steward can POST
        r = await client.post("/api/v1/<resources>", headers=auth_headers("steward"), json={...})
        assert_status(r, 201, "POST /<resources> as Steward")

        # 5. Cross-tenant returns 404
        r = await client.get("/api/v1/<resources>/00000000-0000-4000-8000-000000000fff",
                            headers=auth_headers("eng-lead"))
        assert_status(r, 404, "Cross-tenant GET")

    logger.info("✓ All smoke tests passed.")


if __name__ == "__main__":
    asyncio.run(main())
```

---

## CI integration

`.github/workflows/ci-seed.yml`:

```yaml
name: Seed smoke tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: forge
          POSTGRES_PASSWORD: forge
          POSTGRES_DB: forge_test
        ports: [5432:5432]
        options: --health-cmd pg_isready --health-interval 10s

      redis:
        image: redis:7
        ports: [6379:6379]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.13'

      - name: Install
        run: |
          cd backend
          pip install -e ".[test]"

      - name: Migrate
        run: |
          cd backend
          alembic upgrade head
        env:
          DATABASE_URL: postgresql+asyncpg://forge:forge@localhost:5432/forge_test

      - name: Seed
        run: |
          cd backend
          python -m scripts.seed_agents
        env:
          DATABASE_URL: postgresql+asyncpg://forge:forge@localhost:5432/forge_test

      - name: Start backend
        run: |
          cd backend
          uvicorn app.main:app --port 8000 &
          sleep 5
        env:
          DATABASE_URL: postgresql+asyncpg://forge:forge@localhost:5432/forge_test

      - name: Smoke test agents API
        run: |
          cd backend
          python -m scripts.test_agents_api
```

**Any failed smoke test blocks merge.**

---

## How to write a smoke test for a new feature

When shipping a new feature, ship a smoke-test script:

```bash
# 1. Copy the template
cp backend/scripts/test_agents_api.py backend/scripts/test_<feature>_api.py

# 2. Replace <feature> with your feature name
# 3. Adjust the assertions for your routes
# 4. Add a CI job in .github/workflows/
# 5. Update /docs/reference/test-scripts.md
```

---

## Local smoke test workflow

```bash
# 1. Reset the demo tenant
docker compose exec backend python -m seeds.framework.apply_seed acme-corp --reset

# 2. Seed agents
docker compose exec backend python -m scripts.seed_agents

# 3. Start backend (in another terminal)
docker compose up backend

# 4. Wait for backend to be ready
until curl -sf http://localhost:8000/api/v1/health; do sleep 1; done

# 5. Run smoke tests
docker compose exec backend python -m scripts.test_agents_api

# 6. (Optional) Run the pytest suite
cd backend && pytest -v
```

---

## Pytest suite vs smoke-test scripts

| | Pytest suite | Smoke-test scripts |
|---|---|---|
| **Scope** | Unit + integration | End-to-end (live server) |
| **Speed** | Fast (seconds) | Slower (seconds-to-minutes) |
| **DB** | In-process or test DB | Live DB (could be demo seed) |
| **HTTP** | httpx AsyncClient (in-process) | Real HTTP requests |
| **When** | Every PR | Pre-deploy + on-demand |
| **Coverage** | Deep (edge cases) | Shallow (critical paths) |
| **Files** | `backend/tests/` (100+ files) | `backend/scripts/test_*.py` (sparse) |

**Both are required.** Pytest catches edge cases; smoke tests catch integration issues that only manifest with a live server.

---

## Forbidden patterns

- ❌ Smoke test that calls a real LLM (always stub via `litellm_stub`)
- ❌ Smoke test that doesn't assert on status code
- ❌ Smoke test that doesn't test RBAC (PM vs Steward)
- ❌ Smoke test that doesn't test cross-tenant (404, not 403)
- ❌ Smoke test that depends on seed data being present (verify preconditions)
- ❌ Smoke test that hardcodes tenant UUIDs (use `acme-corp` slug + `_coerce_tenant_id`)
- ❌ Smoke test that runs without `--reset` (stale state breaks assertions)

---

## Verification checklist (per smoke test)

- [ ] Tests critical read path (GET list, GET one)
- [ ] Tests critical write path (POST create, PATCH update, DELETE)
- [ ] Tests RBAC (PM 403, Steward 200)
- [ ] Tests cross-tenant (404)
- [ ] Asserts on status code + body shape
- [ ] Logs clear success/failure messages (✓ / ❌)
- [ ] Exits with non-zero on failure (CI fails fast)
- [ ] Idempotent (can run multiple times)
- [ ] Pre-flight check: server reachable + DB migrated

---

## Related docs

- [Features: Agent Center](../features/agent-center.md) — `test_agents_api.py` target
- [Features: Seed Management](../features/seeds-admin.md) — Seed framework
- [Reference: seed-scripts](./seed-scripts.md) — Seed framework + `seed_agents.py`
- [Standards: testing](../standards/testing.md) — Pytest patterns
- [Reference: api-catalog](./api-catalog.md) — All routes tested
- [Reference: db-schema](./db-schema.md) — Tables tested
- [Standards: api-conventions](../standards/api-conventions.md) — Wire contract


Copy
/goal


Wire Phase 2 (Agents + Providers + Runtimes) to the real backend. The codebase already has partial wiring (apps/forge/app/agent-center/page.tsx uses useAgents + adapter pattern) but the agent center is showing empty because of missing seed data + incomplete API coverage. Fix BOTH backend (seed data + endpoint coverage) and frontend (real CRUD via existing hooks). Read the actual files first.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "FastAPI SQLAlchemy async seed script tenant scoped CRUD" --domain ux-guideline -f markdown


Adopt every rule. Then build in this EXACT order:


==========================================================

ZONE 1 — AUDIT EXISTING CODE (READ FIRST)

==========================================================


READ these files to understand what's already there:


1. `backend/app/db/models/agent.py` — see the Agent model fields

2. `backend/app/db/models/runtime.py` — see Runtime model

3. `backend/app/db/models/assignment.py` — see Assignment model

4. `backend/app/schemas/agents.py` — see AgentCreate / AgentRead / AgentUpdate shapes

5. `backend/app/api/v1/agents.py` — see existing route coverage

6. `backend/app/api/v1/model_providers.py` — see provider routes

7. `backend/app/api/v1/agent_runtimes.py` — see runtime routes

8. `backend/app/api/v1/agent_assignments.py` — see assignment routes

9. `apps/forge/lib/query/hooks.ts` — see existing useAgents, useModelProviders, useCreateAgent etc

10. `apps/forge/lib/agent-center/adapter.ts` — see UI adapter

11. `apps/forge/app/agent-center/page.tsx` — see how data flows

12. `backend/scripts/seed_agents.py` — see if it exists and what it seeds


The agent center is already wired to real API (per page.tsx header comment "step-54 Phase 2"). The issue is the API returns empty data because there's no seed data AND/OR some routes are missing.


==========================================================

ZONE 2 — VALIDATE BACKEND ROUTES (add what's missing)

==========================================================


VERIFY these routes exist. If any are missing, ADD them:


**agents.py** (check all 5):

- GET /agents (list, tenant-scoped)

- GET /agents/{id} (get)

- POST /agents (create)

- PATCH /agents/{id} (update)

- DELETE /agents/{id} (delete)

- POST /agents/{id}/test (test connectivity)


**model_providers.py** (check):

- GET /providers

- GET /providers/{id}

- POST /providers

- PATCH /providers/{id}

- DELETE /providers/{id}

- GET /providers/resolve/{model_alias}

- POST /providers/{id}/test


**agent_runtimes.py** (check):

- GET /runtimes

- POST /runtimes/start

- POST /runtimes/{handle_id}/stop

- GET /runtimes/{handle_id}/metrics


**agent_assignments.py** (check):

- GET /assignments

- POST /assignments

- DELETE /assignments/{id}


If any are missing, add them following the existing patterns in the codebase. Each route MUST:

- Use `Depends(get_current_tenant)` for tenant scoping (Rule 2)

- Use `@audit()` decorator for mutations (Rule 6)

- Use `Depends(require_permission(...))` for RBAC

- Return Pydantic schemas (not dicts)


==========================================================

ZONE 3 — COMPLETE THE SEED SCRIPT

==========================================================


READ `backend/scripts/seed_agents.py` first. If it doesn't exist, CREATE it. If incomplete, COMPLETE it.


The seed script must:

1. Create default tenant "acme-corp" if not exists

2. Create 4 model providers (Anthropic, OpenAI, AWS Bedrock, Google Vertex)

3. Create 2 runtimes (local-docker, production-k8s)

4. Create 6 common agent patterns (Code reviewer, Refactor agent, Sync agent, Test runner, Doc generator, Security auditor)


Run it:

```bash

docker compose exec backend python -m scripts.seed_agents
Verify in DB:

bash

Copy
docker compose exec postgres psql -U forge -d forge -c "SELECT name, type, status FROM agents;"

docker compose exec postgres psql -U forge -d forge -c "SELECT name, display_name FROM model_providers;"
Should show 6 agents and 4 providers.

========================================================== ZONE 4 — WRITE API ENDPOINT TEST SCRIPT
CREATE backend/scripts/test_agents_api.py:

python

Copy
#!/usr/bin/env python3

"""Test agents API endpoints. Run: docker compose exec backend python -m scripts.test_agents_api"""


import asyncio

import httpx

import sys


BASE_URL = "http://localhost:8000/api/v1"



async def get_token():

    """Get auth token via OIDC password grant."""

    async with httpx.AsyncClient() as c:

        res = await c.post(

            "http://keycloak:8080/realms/forge/protocol/openid-connect/token",

            data={

                "grant_type": "password",

                "client_id": "forge-backend",

                "username": "arun@acme-corp.com",

                "password": "dev-password-change-in-prod",

            },

        )

        if res.status_code != 200:

            print(f"Failed to get token: {res.status_code} {res.text}")

            sys.exit(1)

        return res.json()["access_token"]



async def test(method, path, token, expected=200, **kw):

    res = await getattr(httpx.AsyncClient(timeout=10), method)(

        f"{BASE_URL}{path}",

        headers={"Authorization": f"Bearer {token}"},

        **kw,

    )

    ok = "✓" if res.status_code == expected else "✗"

    print(f"{ok} {method.upper():6s} {path:50s} → {res.status_code} (expected {expected})")

    if res.status_code != expected:

        print(f"  Body: {res.text[:200]}")

        return None

    return res.json() if res.headers.get("content-type", "").startswith("application/json") else None



async def main():

    token = await get_token()

    print(f"Token: {token[:20]}...\n")

    passed = failed = 0

    

    def count(ok): 

        nonlocal passed, failed

        if ok: passed += 1

        else: failed += 1

    

    async with httpx.AsyncClient(timeout=10) as c:

        # AGENTS

        print("=" * 50 + "\nAGENTS\n" + "=" * 50)

        count(await test("get", "/agents", token) is not None)

        agents = await test("get", "/agents", token) or []

        print(f"  → {len(agents)} agents found")

        test_id = agents[0]["id"] if agents else None

        

        if test_id:

            count(await test("get", f"/agents/{test_id}", token) is not None)

            count(await test("post", f"/agents/{test_id}/test", token) is not None)

        

        new_agent = await test("post", "/agents", token, expected=201, json={

            "name": "Test Agent", "type": "cli", "version": "1.0.0"

        })

        count(new_agent is not None)

        if new_agent:

            count(await test("patch", f"/agents/{new_agent['id']}", token, json={"name": "Updated"}))

            count(await test("delete", f"/agents/{new_agent['id']}", token, expected=204) is None or True)

            count(await test("get", f"/agents/{new_agent['id']}", token, expected=404) is None or True)

        

        # PROVIDERS

        print("\n" + "=" * 50 + "\nPROVIDERS\n" + "=" * 50)

        count(await test("get", "/providers", token) is not None)

        providers = await test("get", "/providers", token) or []

        if providers:

            count(await test("get", f"/providers/{providers[0]['id']}", token) is not None)

            count(await test("post", f"/providers/{providers[0]['id']}/test", token) is not None)

        

        # RUNTIMES

        print("\n" + "=" * 50 + "\nRUNTIMES\n" + "=" * 50)

        count(await test("get", "/runtimes", token) is not None)

        

        # ASSIGNMENTS

        print("\n" + "=" * 50 + "\nASSIGNMENTS\n" + "=" * 50)

        count(await test("get", "/assignments", token) is not None)

    

    print(f"\n{'=' * 50}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 50}")

    return 0 if failed == 0 else 1



if __name__ == "__main__":

    sys.exit(asyncio.run(main()))
Run it:

bash

Copy
docker compose exec backend python -m scripts.test_agents_api
ALL tests must pass before moving to Zone 5.

========================================================== ZONE 5 — FRONTEND WIRING (if all tests pass)
The frontend already has the structure (apps/forge/app/agent-center/page.tsx uses useAgents, useModelProviders, useCreateAgent, etc). The issue is likely:

A. The lib/query/hooks.ts useAgents() function — verify it calls the right endpoint B. The lib/agent-center/adapter.ts — verify it handles the backend response shape C. The seed data didn't run, so the API returns []

VERIFY in order:

bash

Copy
# 1. Check the hook

cat apps/forge/lib/query/hooks.ts | grep -A 20 "export function useAgents"
bash

Copy
# 2. Check the adapter

cat apps/forge/lib/agent-center/adapter.ts | head -80
bash

Copy
# 3. Check the page

cat apps/forge/app/agent-center/page.tsx | head -100
If useAgents returns api.get<Agent[]>('/agents') — correct. If adapter transforms backend AgentRead → UI Agent shape — verify fields map correctly.

Common bugs to fix:

Agent model missing lastInvokedAt, invocations24h — adapter returns "—" defaults
capabilities is dict[str, Any] not List[str] — adapter may not parse correctly
Missing defaultProvider or defaultModel — adapter fills with null
project_id filter — check if it filters correctly
========================================================== ZONE 6 — VERIFICATION CHECKLIST
ALL must pass before declaring done:

 python -m scripts.seed_agents runs and prints "Seed complete"
 psql ... -c "SELECT COUNT(*) FROM agents" returns 6
 psql ... -c "SELECT COUNT(*) FROM model_providers" returns 4
 python -m scripts.test_agents_api shows 12/12 passed
 curl http://localhost:8000/api/v1/agents -H "Authorization: Bearer $TOKEN" returns 6 agents
 Frontend http://localhost:3000/agent-center shows 6 agent cards
 Create agent via UI → appears in list
 Update agent via UI → changes persist
 Delete agent via UI → removed
 Test connection button → returns real status
 All agent counts on dashboard reflect real DB counts
========================================================== CONSTRAINTS
Use existing patterns from codebase (don't invent new ones)
Backend routes MUST be tenant-scoped (Rule 2) — use Depends(get_current_tenant)
All mutations MUST have @audit() decorator (Rule 6)
All routes MUST use require_permission(...) (RBAC)
Frontend MUST use existing hooks (don't create new ones unless needed)
All Pydantic schemas MUST be reused (don't create duplicate types)
ALL tests must pass before declaring done
DO NOT use static/dummy data anywhere
DO NOT skip the test script
========================================================== DELIVERABLE
backend/scripts/seed_agents.py — complete with 6 agents, 4 providers, 2 runtimes
backend/scripts/test_agents_api.py — full CRUD test coverage
Any missing backend routes added (per Zone 2)
Frontend adapter verified or fixed (per Zone 5)
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep existing adapter pattern, keep existing UI components, keep existing query hooks
VERIFICATION: All 11 items in Zone 6 checklist pass
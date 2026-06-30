/goal


Fix two real-data gaps in the Agent Center + Dashboard:


1. **"Test connection" is fake** — backend/app/api/v1/model_providers.py test endpoint only checks if api_key is present, never actually calls LiteLLM. Make it really verify the credentials against the LiteLLM proxy (or upstream provider).


2. **"Top performing model providers" shows zeros** — Dashboard widget has no real data feed. Wire it to actual run metrics from the DB.


3. **"Recent agents" shows test/dummy data** — Backend is returning "Test agent patched 1782640565" entries which look like leftover from agent_registry test runs. Filter out test-prefixed names.


Read these files first to understand the current implementation:

- `backend/app/api/v1/model_providers.py` (the test endpoint)

- `backend/app/services/model_provider_registry.py` (the registry)

- `backend/app/services/litellm_client.py` (the LiteLLM client wrapper)

- `backend/app/api/v1/dashboard.py` (dashboard endpoints)

- `backend/app/services/dashboard.py` (dashboard service)

- `backend/scripts/seed_agents.py` (which seeds "Test agent patched" entries)

- `apps/forge/app/agent-center/page.tsx` (the frontend page)


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/search.py "FastAPI LiteLLM proxy health check API key validation async httpx" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/search.py "SQLAlchemy aggregate group by join run metrics by provider" --domain ux-guideline -f markdown


Adopt every rule. Then build in this order:


==========================================================

ZONE 1 — REAL LITELLM TEST CONNECTION

==========================================================


REPLACE the fake test in `backend/app/api/v1/model_providers.py` test endpoint.


The current code only checks `api_key_present` and returns "ok" without calling anyone. Make it actually:


1. **For Anthropic**: Call LiteLLM proxy `/v1/messages` with a minimal test request

2. **For OpenAI**: Call LiteLLM proxy `/v1/chat/completions` with `max_tokens=1`

3. **For Bedrock/Vertex/Azure**: Call respective health endpoints

4. **For Custom**: HEAD request to the api_base URL

5. **Measure latency** — return `latency_ms` from the actual response


```python

# Replace the test_provider endpoint in backend/app/api/v1/model_providers.py

@router.post("/{provider_id}/test")

@audit(action="model_providers.test", target_type="model_provider")

async def test_provider(

    provider_id: UUID,

    principal: Principal,

    _perm: Principal = require_permission("model_providers:read"),

) -> dict[str, Any]:

    """Test provider by actually calling LiteLLM proxy."""

    try:

        existing = await model_provider_registry.get_provider(provider_id)

    except LookupError as exc:

        raise HTTPException(status_code=404, detail=str(exc)) from exc

    

    if str(existing.tenant_id) != str(principal.tenant_id):

        raise HTTPException(status_code=404, detail="model_provider_not_found")

    

    config = existing.config or {}

    api_key = config.get("api_key") or config.get("apiKey")

    api_base = config.get("api_base") or existing.api_base

    model = existing.default_model or "claude-sonnet-4.5"

    

    if not existing.enabled:

        return {"status": "error", "message": "Provider is disabled. Enable it before testing."}

    

    if not api_key:

        return {"status": "error", "message": "No api_key configured. Edit the provider and add one."}

    

    # ACTUALLY call the LLM

    import httpx, time

    start = time.monotonic()

    try:

        async with httpx.AsyncClient(timeout=10) as client:

            if existing.name == "anthropic":

                res = await client.post(

                    "https://api.anthropic.com/v1/messages",

                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},

                    json={"model": model, "max_tokens": 1, "messages": [{"role": "user", "content": "hi"}]},

                )

            elif existing.name == "openai":

                res = await client.post(

                    f"{api_base or 'https://api.openai.com/v1'}/chat/completions",

                    headers={"Authorization": f"Bearer {api_key}"},

                    json={"model": model, "max_tokens": 1, "messages": [{"role": "user", "content": "hi"}]},

                )

            else:  # bedrock, vertex, custom

                res = await client.get(f"{api_base}/v1/models", headers={"Authorization": f"Bearer {api_key}"})

            

            latency = int((time.monotonic() - start) * 1000)

            

            if 200 <= res.status_code < 300:

                return {

                    "status": "ok",

                    "message": f"Provider reachable · {latency}ms",

                    "latency_ms": latency,

                    "model": model,

                    "litellm_alias": existing.litellm_model_alias,

                }

            elif res.status_code == 401:

                return {"status": "error", "message": "Invalid API key (401 Unauthorized)"}

            elif res.status_code == 403:

                return {"status": "error", "message": "API key lacks required permissions (403)"}

            elif res.status_code == 404:

                return {"status": "error", "message": f"Model '{model}' not found at {api_base}"}

            else:

                return {"status": "error", "message": f"HTTP {res.status_code}: {res.text[:200]}"}

    except httpx.TimeoutException:

        return {"status": "error", "message": f"Timeout after 10s — check {api_base}"}

    except Exception as e:

        return {"status": "error", "message": f"Connection failed: {str(e)[:200]}"}
The wizard's "Test connection" button already calls this endpoint — the toast on success/failure will now be real.

========================================================== ZONE 2 — REAL DASHBOARD METRICS
READ backend/app/api/v1/dashboard.py and backend/app/services/dashboard.py.

The "Top performing model providers" widget needs real data from the runs table. Add (or fix) a /dashboard/top-providers endpoint:

python

Copy
# Add to backend/app/api/v1/dashboard.py

@router.get("/top-providers")

@cache(ttl=60)  # cache 60s

async def get_top_providers(

    principal: Principal,

    days: int = 7,

    db: AsyncSession = Depends(get_db),

):

    """Top performing model providers by usage (real data from runs)."""

    from app.db.models import Run, ModelProvider

    from sqlalchemy import func, desc

    

    since = datetime.utcnow() - timedelta(days=days)

    

    # Aggregate runs by model + provider

    results = await db.execute(

        select(

            Run.model,

            Run.provider_id,

            func.count(Run.id).label("run_count"),

            func.sum(Run.total_cost_usd).label("total_cost"),

            func.avg(Run.duration_seconds).label("avg_duration"),

            func.sum(

                func.case(

                    (Run.status == "succeeded", 1),

                    else_=0,

                )

            ).label("success_count"),

        )

        .where(Run.tenant_id == principal.tenant_id)

        .where(Run.started_at >= since)

        .where(Run.model.isnot(None))

        .group_by(Run.model, Run.provider_id)

        .order_by(desc("run_count"))

        .limit(10)

    )

    

    # Join with providers to get display name

    provider_ids = [r.provider_id for r in results if r.provider_id]

    providers = {}

    if provider_ids:

        prov_rows = await db.execute(

            select(ModelProvider).where(ModelProvider.id.in_(provider_ids))

        )

        providers = {p.id: p for p in prov_rows.scalars()}

    

    return [

        {

            "model": row.model,

            "provider_id": str(row.provider_id) if row.provider_id else None,

            "provider_name": providers.get(row.provider_id, {}).display_name if row.provider_id else "Unknown",

            "run_count": row.run_count,

            "total_cost": float(row.total_cost or 0),

            "avg_duration_seconds": float(row.avg_duration or 0),

            "success_rate": (row.success_count / row.run_count * 100) if row.run_count else 0,

        }

        for row in results

    ]
In the frontend apps/forge/lib/query/hooks.ts:

typescript

Copy
export function useTopProviders(days: number = 7) {

  return useQuery({

    queryKey: ['dashboard', 'top-providers', days],

    queryFn: () => api.get<TopProvider[]>(`/dashboard/top-providers?days=${days}`),

    staleTime: 60_000,  // cache 60s

  });

}
In apps/forge/app/agent-center/page.tsx (or wherever the widget is):

typescript

Copy
const { data: topProviders } = useTopProviders(7);


// Render with real numbers

{topProviders?.map(p => (

  <div key={p.model} className="flex justify-between">

    <span>{p.model}</span>

    <span>{p.run_count} runs · ${p.total_cost.toFixed(2)}</span>

  </div>

))}
========================================================== ZONE 3 — FILTER TEST DUMMY AGENTS
The "Recent agents" list shows entries like "Test agent patched 1782640565" — these come from agent_registry test runs polluting the production data. Two fixes:

Option A (backend filter) — in backend/app/api/v1/agents.py list endpoint:

python

Copy
@router.get("", response_model=list[AgentRead])

async def list_agents(

    principal: Principal,

    db: AsyncSession = Depends(get_db),

    # ... existing params ...

):

    query = db.query(Agent).filter(Agent.tenant_id == principal.tenant_id)

    # Exclude test/seed agents from "recent" view

    query = query.filter(~Agent.name.ilike("Test agent%"))

    query = query.filter(~Agent.name.ilike("%patched%"))

    return query.order_by(Agent.updated_at.desc()).all()
Option B (fix the seed script) — in backend/scripts/seed_agents.py, use realistic production-like names:

python

Copy
# Replace the test names with realistic ones that match the "Common agent patterns" UI

SEED_AGENTS = [

    {

        "name": "Code reviewer",  # was: "Test agent"

        "type": "cli",

        "runtime": "claude-code",

        ...

    },

    # ... same as before

]
Then re-seed: docker compose exec backend python -m scripts.seed_agents.

DO BOTH — fix the seed script so future seeds are clean, AND add the filter so legacy test data doesn't show.

========================================================== ZONE 4 — VALIDATE WIZARD USES REAL DATA
The 4-step wizard already has "Test connection" wired to the backend endpoint. Once Zone 1 is fixed, the wizard will:

1.
Step 1 "Connect provider" — Anthropic test now hits real API, returns real latency or real error
2.
Step 2 "Register agent" — already POSTs to /agents
3.
Step 3 "Configure runtime" — already POSTs to /runtimes
4.
Step 4 "Assign to project" — already POSTs to /assignments
VERIFY each step by looking at apps/forge/components/agent-center/AgentOnboardingWizard.tsx:

Step 1 calls useTestProvider (or similar) on "Test connection" click — should now show real result
Step 2 calls useCreateAgent — verify it sends provider_id
Step 3 calls useCreateRuntime — verify config is sent
Step 4 calls useCreateAssignment — verify agent_id, project_id, role
If any step has hardcoded dummy data, fix it.

========================================================== ZONE 5 — VERIFICATION CHECKLIST
All must pass before declaring done:

 curl -X POST .../providers/{id}/test with real Anthropic key returns 200 with latency_ms
 curl -X POST .../providers/{id}/test with FAKE key returns "Invalid API key (401)"
 curl -X POST .../providers/{id}/test with TIMEOUT returns "Timeout after 10s"
 curl .../dashboard/top-providers?days=7 returns real data from runs table (not zeros)
 curl .../agents no longer returns "Test agent patched X" entries
 Frontend agent-center page: clicking "Test connection" on Anthropic shows real latency or real error
 Frontend dashboard: "Top performing model providers" shows real models with real counts
 Agent center wizard step 1 actually validates credentials against LiteLLM (not just "reachable")
========================================================== CONSTRAINTS
Use existing patterns from codebase (httpx for HTTP, existing litellm_client.py if suitable)
Use existing Pydantic schemas
Don't break existing routes — only enhance the test endpoint behavior
Tenant scoping (Rule 2) — keep using get_current_tenant
Audit logging (Rule 6) — keep @audit() decorator
RBAC (Rule 8) — keep require_permission(...) on all routes
Test with the actual seeded providers in the dev tenant
Don't add new dependencies — use what's already in requirements.txt (httpx is there)
========================================================== DELIVERABLE
backend/app/api/v1/model_providers.py — real test endpoint (Zone 1)
backend/app/api/v1/dashboard.py — top-providers endpoint (Zone 2)
backend/app/services/dashboard.py — service function (Zone 2)
backend/scripts/seed_agents.py — clean agent names (Zone 3)
apps/forge/lib/query/hooks.ts — useTopProviders hook (Zone 2)
apps/forge/app/agent-center/page.tsx — wire real top-providers data (Zone 2)
All 8 verification items pass
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the wizard structure, keep the existing routes, keep the seed script's purpose

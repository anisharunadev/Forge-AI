text

Copy
/goal


Wire the Connector Center to the real backend. The infrastructure is mostly there (`apps/forge/lib/hooks/useConnectors.ts` has all the TanStack Query hooks, `LiveConnectorDataProvider` exists) BUT `apps/forge/lib/connectors/data.ts` has a giant hardcoded `CONNECTORS` array that the LiveConnectorDataProvider falls back to. The current behavior: even when the backend returns 0 connectors, the UI shows the mock list as if they were real.


The fix: (1) the backend must return real data, (2) the frontend must STOP falling back to mocks when API succeeds, (3) tests must prove it. Read these files first:

- `apps/forge/lib/connectors/data.ts` — the mock dataset (the problem)

- `apps/forge/components/connector-center/LiveConnectorDataProvider.tsx` — the merge logic

- `apps/forge/lib/hooks/useConnectors.ts` — the React Query hooks (already correct)

- `apps/forge/lib/connectors/api.ts` — the API fetcher

- `apps/forge/lib/connectors/types.ts` — the wire types

- `backend/app/api/v1/connectors.py` — backend routes

- `backend/app/api/v1/connector_lifecycle.py` — install/rotate/test routes

- `backend/app/api/v1/marketplace.py` — marketplace catalog

- `backend/app/api/v1/webhooks.py` — webhook routes

- `backend/app/services/connector_manager.py` — sync orchestration

- `backend/app/services/marketplace.py` — marketplace service


INVOKE THE SKILL BEFORE CODING:

  python3 -c "import webbrowser; webbrowser.open('https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults')"

  

Then read the TanStack Query docs on `enabled` and `placeholderData` to understand the right pattern.


Adopt every rule. Then build in this order:


==========================================================

ZONE 1 — VALIDATE BACKEND HAS DATA

==========================================================


Check if there's a connector seed script. Search for it:


```bash

find backend -name "*connector*seed*" -o -name "*seed*connector*" 2>/dev/null
If not found, CREATE backend/scripts/seed_connectors.py:

python

Copy
#!/usr/bin/env python3

"""Seed real connectors for the dev tenant.


Inserts a small but realistic set of installed + available connectors

(github, jira, slack, confluence) so the frontend has something to

show immediately after the user logs in. Run:


    docker compose exec backend python -m scripts.seed_connectors

"""


import asyncio

from uuid import uuid4

from app.db.session import async_session_maker

from app.db.models.connector import (

    Connector, ConnectorStatus, ConnectorType,

)

from app.db.models.tenant import Tenant

from sqlalchemy import select


SEED_CONNECTORS = [

    {

        "name": "GitHub",

        "type": ConnectorType.GITHUB,

        "config": {"api_key": "ghp_demo_replace_me", "org": "acme-corp"},

        "status": ConnectorStatus.HEALTHY,

    },

    {

        "name": "Jira",

        "type": ConnectorType.JIRA,

        "config": {"api_base": "https://acme.atlassian.net", "api_key": "demo_replace_me"},

        "status": ConnectorStatus.HEALTHY,

    },

    {

        "name": "Slack",

        "type": ConnectorType.SLACK,

        "config": {"workspace": "acme-corp", "bot_token": "xoxb_demo_replace_me"},

        "status": ConnectorStatus.HEALTHY,

    },

    {

        "name": "Confluence",

        "type": ConnectorType.CONFLUENCE,

        "config": {"space": "ENG"},

        "status": ConnectorStatus.PENDING,

    },

    {

        "name": "Figma",

        "type": ConnectorType.FIGMA,

        "config": {},

        "status": ConnectorStatus.PENDING,

    },

    {

        "name": "AWS",

        "type": ConnectorType.AWS,

        "config": {"region": "us-east-1"},

        "status": ConnectorStatus.PENDING,

    },

]



async def seed():

    async with async_session_maker() as session:

        tenant = (await session.execute(

            select(Tenant).where(Tenant.slug == "acme-corp")

        )).scalar_one_or_none()

        if not tenant:

            print("✗ Tenant acme-corp not found — run seed_agents first")

            return

        

        for spec in SEED_CONNECTORS:

            existing = (await session.execute(

                select(Connector).where(

                    Connector.tenant_id == tenant.id,

                    Connector.type == spec["type"],

                )

            )).scalar_one_or_none()

            

            if existing:

                print(f"  → {spec['name']} already exists")

                continue

            

            c = Connector(

                id=str(uuid4()),

                tenant_id=tenant.id,

                name=spec["name"],

                type=spec["type"],

                config=spec["config"],

                status=spec["status"],

                created_by=str(tenant.id),  # or actual user id

            )

            session.add(c)

            print(f"✓ Created connector: {spec['name']}")

        

        await session.commit()

        print(f"\n✅ Seeded {len(SEED_CONNECTORS)} connectors")



if __name__ == "__main__":

    asyncio.run(seed())
Run it:

bash

Copy
docker compose exec backend python -m scripts.seed_connectors
VERIFY:

bash

Copy
docker compose exec postgres psql -U forge -d forge -c "SELECT name, type, status FROM connectors;"
Should show: GitHub, Jira, Slack, Confluence, Figma, AWS.

========================================================== ZONE 2 — VERIFY BACKEND ENDPOINTS
Check the existing API fetcher at apps/forge/lib/connectors/api.ts. Look for these functions:

listConnectors(filters?) → GET /connectors
getConnector(id) → GET /connectors/{id}
installConnector(data) → POST /connectors
updateConnectorConfig(id, data) → PATCH /connectors/{id}
disconnectConnector(id) → DELETE /connectors/{id}
syncConnector(id) → POST /connectors/{id}/sync
testConnector(id) → POST /connectors/{id}/test
listMarketplace(filters?) → GET /marketplace (or /connectors/marketplace)
listCredentials() → GET /connectors/credentials
listWebhookDeliveries(id) → GET /webhooks/{id}/deliveries
listWebhooks(direction?) → GET /webhooks
testWebhook(id) → POST /webhooks/{id}/test
createWebhook(data) → POST /webhooks
createCredential(data) → POST /connectors/credentials
revealCredential(id) → POST /connectors/credentials/{id}/reveal
rotateCredential(id) → POST /connectors/credentials/{id}/rotate
revokeCredential(id) → DELETE /connectors/credentials/{id}
For each function, VERIFY the URL path matches the backend route in backend/app/api/v1/connectors.py + backend/app/api/v1/marketplace.py + backend/app/api/v1/webhooks.py.

If any paths don't match, FIX them in api.ts.

If any backend routes are missing, ADD them. Pay special attention to:

POST /marketplace/{slug}/install (might be missing)
POST /webhooks/{id}/test (might be missing)
POST /connectors/credentials/{id}/reveal (might be missing)
========================================================== ZONE 3 — FIX WIRE-TO-LEGACY ADAPTER
The LiveConnectorDataProvider has a mergeConnectors function that falls back to mocks. Read it carefully.

CURRENT BEHAVIOR (BROKEN):

typescript

Copy
if (!liveConnectors || liveConnectors.length === 0) {

  return MOCK_CONNECTORS;  // ← BUG: shows mock data when API succeeds with 0 results

}
This is wrong because it treats "no live data" the same as "API failed". A real empty state should be a real empty state.

FIX:

typescript

Copy
function mergeConnectors(

  liveConnectors: ReadonlyArray<Connector> | undefined,

  isLiveLoaded: boolean,

  isLiveError: boolean,

  installedSlugs: ReadonlyArray<string>,

): ReadonlyArray<Connector> {

  // CASE 1: API loaded successfully but returned empty — show REAL empty state

  if (isLiveLoaded && (!liveConnectors || liveConnectors.length === 0)) {

    return [];  // empty array → tabs render their own empty states

  }

  

  // CASE 2: API errored — fall back to mocks so the UI still works offline

  if (isLiveError) {

    return MOCK_CONNECTORS;

  }

  

  // CASE 3: API still loading — return mocks so the page doesn't flash empty

  if (!isLiveLoaded) {

    return MOCK_CONNECTORS;

  }

  

  // CASE 4: API returned data — use it

  return liveConnectors;

}
Then pass isLiveLoaded and isLiveError from the query result to the merge function. The new logic:

API loading → show mocks (no flash of empty state)
API succeeded with 0 items → show REAL empty state ("No connectors installed")
API errored → fall back to mocks (offline-safe)
API succeeded with items → show them
Also fix marketplaceToConnectors:

typescript

Copy
function marketplaceToConnectors(

  marketplace: ReadonlyArray<...> | undefined,

  isLiveLoaded: boolean,

  isLiveError: boolean,

  installedSlugsSet: Set<string>,

): Connector[] {

  if (isLiveError) {

    // Backend down — show mock marketplace

    return MOCK_CONNECTORS.filter(c => !c.installed).map(attachCapabilities);

  }

  if (isLiveLoaded && (!marketplace || marketplace.length === 0)) {

    return [];  // real empty state

  }

  if (!marketplace) {

    // Still loading

    return MOCK_CONNECTORS.filter(c => !c.installed).map(attachCapabilities);

  }

  return marketplace.map(/* ... */);

}
========================================================== ZONE 4 — VERIFY THE WIRE TYPES MATCH BACKEND
Open apps/forge/lib/connectors/types.ts. Compare the wire types to the Pydantic schemas in backend/app/schemas/connectors.py.

Wire type ConnectorWire should have:

id (UUID string)
name (string)
type ('github' | 'jira' | ...)
config (object)
status ('pending' | 'syncing' | 'healthy' | 'stale' | 'quarantined' | 'failed')
last_sync_at (ISO string | null)
last_error (string | null)
created_at (ISO string)
updated_at (ISO string)
The wireToConnector function in useConnectors.ts must map every backend field. If a field is missing in the wire type, ADD it.

In particular, ADD:

capabilities: string[] (empty array for now — backend doesn't return it yet)
last_sync_at: string | null
last_error: string | null
provider: string | null (Anthropic, OpenAI, etc. for routing)
========================================================== ZONE 5 — INSTALL FLOW (marketplace → installed)
The marketplace tab has "Use this pattern" → install flow. Read the MarketplaceTab component.

VERIFY the flow:

1.
User clicks "Install" on a marketplace card
2.
useInstallConnector().mutate(item) is called
3.
Backend POST /connectors returns the new connector
4.
The "Connected" tab should immediately show the new connector
5.
The marketplace card should now show "Installed ✓"
The useInstallConnector hook should invalidate the marketplace AND the connectors list:

typescript

Copy
export function useInstallConnector() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: { slug: string; config?: object }) =>

      api.installConnector(data),

    onSuccess: () => {

      // Invalidate BOTH lists

      qc.invalidateQueries({ queryKey: connectorQueryKeys.all });

      toast.success('Connector installed');

    },

  });

}
========================================================== ZONE 6 — TEST CONNECTION (real backend call)
The "Test connection" button on the Connected tab calls useTestConnector. VERIFY it:

1.
Calls POST /connectors/{id}/test
2.
Shows a toast with the result (success: "Reachable · 234ms" / failure: "401 Invalid API key")
3.
Doesn't navigate away
4.
Updates the connector's status in the UI if the test changes it
typescript

Copy
async function handleTest(connectorId: string) {

  try {

    const result = await api.testConnector(connectorId);

    if (result.ok) {

      toast.success(`Reachable in ${result.latency_ms}ms`);

    } else {

      toast.error(result.detail || 'Connection failed');

    }

  } catch (err) {

    toast.error('Test failed: ' + err.message);

  }

}
========================================================== ZONE 7 — ACTIVITY FEED (real sync history)
The Activity tab should show real ConnectorSyncHistory records. VERIFY the useConnectorActivity hook polls every 10s and renders correctly.

CHECK the timeline rendering:

Each row: timestamp (relative) + event type icon + connector name + status badge + duration
Auto-refresh toggle works
Filter chips work (All / Pull / Push / Webhook / Test)
Status icons color-coded: green (success), amber (partial), red (failed)
If the timeline is using mocks, swap to real data. The endpoint GET /connectors/activity should return ConnectorSyncHistoryRead[] with real data.

========================================================== ZONE 8 — WRITE ENDPOINT TEST SCRIPT
Create backend/scripts/test_connectors_api.py (mirror of test_agents_api.py):

python

Copy
#!/usr/bin/env python3

"""Test connectors API. Run: docker compose exec backend python -m scripts.test_connectors_api"""


import asyncio, httpx, sys


BASE_URL = "http://localhost:8000/api/v1"


async def get_token():

    async with httpx.AsyncClient() as c:

        res = await c.post(

            "http://keycloak:8080/realms/forge/protocol/openid-connect/token",

            data={"grant_type": "password", "client_id": "forge-backend",

                  "username": "arun@acme-corp.com", "password": "dev-password-change-in-prod"},

        )

        return res.json()["access_token"]



async def test(method, path, token, expected=200, **kw):

    res = await getattr(httpx.AsyncClient(timeout=10), method)(

        f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {token}"}, **kw,

    )

    ok = "✓" if res.status_code == expected else "✗"

    print(f"{ok} {method.upper():6s} {path:50s} → {res.status_code} (expected {expected})")

    if res.status_code != expected:

        print(f"  Body: {res.text[:200]}")

    return res.json() if res.headers.get("content-type", "").startswith("application/json") else None



async def main():

    token = await get_token()

    passed = failed = 0

    def count(ok):

        nonlocal passed, failed

        if ok: passed += 1

        else: failed += 1

    

    async with httpx.AsyncClient(timeout=10) as c:

        print("=" * 50 + "\nCONNECTORS\n" + "=" * 50)

        count(await test("get", "/connectors", token) is not None)

        connectors = (await test("get", "/connectors", token)) or []

        test_id = connectors[0]["id"] if connectors else None

        

        if test_id:

            count(await test("get", f"/connectors/{test_id}", token) is not None)

            count(await test("post", f"/connectors/{test_id}/test", token) is not None)

            count(await test("get", f"/connectors/{test_id}/history", token) is not None)

            count(await test("post", f"/connectors/{test_id}/sync", token) is not None)

        

        new_conn = await test("post", "/connectors", token, expected=201, json={

            "name": "Test Connector", "type": "github", "config": {}

        })

        count(new_conn is not None)

        if new_conn:

            count(await test("patch", f"/connectors/{new_conn['id']}", token, json={"name": "Updated"}))

            count(await test("delete", f"/connectors/{new_conn['id']}", token, expected=204) is None or True)

        

        print("\n" + "=" * 50 + "\nMARKETPLACE\n" + "=" * 50)

        count(await test("get", "/marketplace", token) is not None)

        

        print("\n" + "=" * 50 + "\nACTIVITY\n" + "=" * 50)

        count(await test("get", "/connectors/activity", token) is not None)

        

        print("\n" + "=" * 50 + "\nCREDENTIALS\n" + "=" * 50)

        count(await test("get", "/connectors/credentials", token) is not None)

        

        print("\n" + "=" * 50 + "\nWEBHOOKS\n" + "=" * 50)

        count(await test("get", "/webhooks", token) is not None)

    

    print(f"\n{'=' * 50}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 50}")

    return 0 if failed == 0 else 1



if __name__ == "__main__":

    sys.exit(asyncio.run(main()))
Run:

bash

Copy
docker compose exec backend python -m scripts.test_connectors_api
ALL tests must pass before frontend is fully wired.

========================================================== ZONE 9 — VERIFICATION CHECKLIST
All must pass before declaring done:

 seed_connectors.py runs and inserts 6 connectors
 psql ... -c "SELECT COUNT(*) FROM connectors" returns 6
 test_connectors_api.py shows 12/12 passed
 curl .../connectors returns 6 connectors (NOT empty array, NOT mock data)
 Connector Center Connected tab shows the 6 seeded connectors (from real API, not mock)
 Test connection button on a real connector returns real latency or real error
 Install from marketplace actually creates a new connector (visible in Connected tab)
 Disconnect removes the connector
 Activity tab shows real sync events (not the 2 hardcoded items)
 When API returns 0 connectors, page shows REAL empty state (not mock fallback)
 When API fails (offline), page falls back to mock gracefully
 The mock CONNECTORS array in data.ts is ONLY used as offline fallback (not as primary data)
========================================================== CONSTRAINTS
DON'T delete the CONNECTORS mock array from data.ts — keep it for offline fallback
DO change the merge logic so it only falls back when the API actually fails (not when it returns empty)
Use existing patterns: @audit() on mutations, Depends(get_current_tenant), require_permission(...)
Don't break the ConnectorPicker (cross-cutting) — it reads from useConnectorsOptional()
Don't break the LiveConnectorDataProvider — enhance, don't rewrite
All React Query hooks should poll at sensible intervals (5-30s based on data freshness)
========================================================== DELIVERABLE
backend/scripts/seed_connectors.py (Zone 1)
backend/scripts/test_connectors_api.py (Zone 8)
Any missing backend routes (Zone 2)
Fixed LiveConnectorDataProvider (Zone 3) — real empty state, not mock fallback
Updated wire types in apps/forge/lib/connectors/types.ts (Zone 4)
Updated API fetcher paths in apps/forge/lib/connectors/api.ts (Zone 2)
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the mock CONNECTORS array as offline fallback, keep the ConnectorPicker, keep the LiveConnectorDataProvider structure
All 12 verification items pass
TEST: kill the dev server, reload — should fall back to mock. Restart server, reload — should show real data.

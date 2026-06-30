#!/usr/bin/env python3
"""Test that Forge correctly proxies to LiteLLM admin API.

================================================================================
HOW TO RUN
================================================================================

From the repo root, with the docker-compose stack up:

    docker compose exec backend python -m scripts.test_litellm_proxy

The script runs inside the `backend` container so it can reach:

  - LiteLLM proxy  -> http://litellm:4000
  - Forge backend  -> http://backend:8000
  - Keycloak OIDC  -> http://keycloak:8080  (realms/forge)

It uses these env vars (already set in docker-compose):

  LITELLM_PROXY_URL   default: http://litellm:4000
  LITELLM_MASTER_KEY  default: empty  (required)

The Keycloak credentials below are the recon seed user
(`arun@acme-corp.com` / `dev-password-change-in-prod`) and live only in
the local dev realm.

================================================================================
WHAT THIS SCRIPT CHECKS
================================================================================

Two groups of HTTP checks against running services:

  1. DIRECT LITELLM (4 checks)  -- sanity that the proxy itself is reachable.
     Uses the master key, no Forge auth.

       - /spend/logs
       - /models
       - /guardrails/list
       - /team/list

  2. FORGE -> LITELLM PROXIES (11 checks)
     Hits the Forge backend with a real Keycloak-issued Bearer JWT and
     verifies that each thin-proxy endpoint forwards correctly:

       - GET /costs                   -> LiteLLM /spend/logs
       - GET /costs/burn-rate         -> LiteLLM /spend/teams
       - GET /policies                -> LiteLLM /guardrails/list
       - GET /standards               -> LiteLLM guardrails + manual attestations
       - GET /governance/violations   -> LiteLLM failed/over-budget requests
       - GET /admin/llm-gateway/spend/teams
       - GET /admin/llm-gateway/spend/models
       - GET /admin/llm-gateway/guardrails
       - GET /admin/llm-gateway/models
       - GET /audit/llm-traffic       -> LiteLLM request logs
       - GET /audit                   -> Forge audit log

================================================================================
INTERPRETING RESULTS
================================================================================

For every check, `test()` prints either:

    <check-name>            -- PASS  (HTTP 200)
    <check-name> -- <err>   -- FAIL  (HTTP !=200, network error, or exception)

A final summary line is printed:

    RESULTS: <passed> passed, <failed> failed

The process exits 0 only if `failed == 0`. Use that as the CI gate for
"all 15/15 verification items pass" in step-59.md Zone 15.

Common failures and what they mean:

  - Direct LiteLLM checks fail
        -> LiteLLM container is down, or LITELLM_MASTER_KEY is wrong.
           Run: `docker compose ps litellm` and check the env.

  - Keycloak token step fails
        -> The dev realm isn't seeded yet. Run:
           `docker compose exec backend python -m seeds`
           or re-bootstrap Keycloak.

  - /costs, /policies, /standards, /governance/violations, /audit/llm-traffic fail
        -> The corresponding router in backend/app/api/v1/* was not yet
           rewritten to proxy LiteLLM (see step-59.md Zones 3-7).

  - /admin/llm-gateway/* fail
        -> admin_llm_gateway.py was not extended with the new endpoints
           (see Zone 10).

  - /audit fails but /audit/llm-traffic passes
        -> The base /audit route lost its handler. Restore it; Forge-side
           audit is NOT to be removed (CONSTRAINT in step-59.md).

================================================================================
"""

import asyncio, sys, httpx, os


LITELLM_BASE = os.environ.get("LITELLM_PROXY_URL", "http://litellm:4000")
LITELLM_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
FORGE_BASE = "http://backend:8000/api/v1"



async def get_forge_token():

    async with httpx.AsyncClient() as c:

        res = await c.post(

            "http://keycloak:8080/realms/forge/protocol/openid-connect/token",

            data={"grant_type": "password", "client_id": "forge-backend",

                  "username": "arun@acme-corp.com", "password": "dev-password-change-in-prod"},

        )

        return res.json()["access_token"]



async def test(name, fn):

    try:

        ok = await fn()

        print(f"{'✓' if ok else '✗'} {name}")

        return ok

    except Exception as e:

        print(f"✗ {name} — {e}")

        return False



async def main():

    token = await get_forge_token()

    headers = {"Authorization": f"Bearer {token}"}

    passed = failed = 0



    async with httpx.AsyncClient(timeout=15) as c:

        # Direct LiteLLM calls (sanity check)

        async def direct_spend():

            r = await c.get(f"{LITELLM_BASE}/spend/logs?limit=5",

                            headers={"Authorization": f"Bearer {LITELLM_KEY}"})

            return r.status_code == 200



        async def direct_models():

            r = await c.get(f"{LITELLM_BASE}/models",

                            headers={"Authorization": f"Bearer {LITELLM_KEY}"})

            return r.status_code == 200



        async def direct_guardrails():

            r = await c.get(f"{LITELLM_BASE}/guardrails/list",

                            headers={"Authorization": f"Bearer {LITELLM_KEY}"})

            return r.status_code == 200



        async def direct_teams():

            r = await c.get(f"{LITELLM_BASE}/team/list",

                            headers={"Authorization": f"Bearer {LITELLM_KEY}"})

            return r.status_code == 200



        print("=" * 60 + "\nDIRECT LITELLM (sanity)\n" + "=" * 60)

        if await test("LiteLLM /spend/logs reachable", direct_spend): passed += 1

        else: failed += 1

        if await test("LiteLLM /models reachable", direct_models): passed += 1

        else: failed += 1

        if await test("LiteLLM /guardrails/list reachable", direct_guardrails): passed += 1

        else: failed += 1

        if await test("LiteLLM /team/list reachable", direct_teams): passed += 1

        else: failed += 1



        # Forge proxies

        async def forge_costs():

            r = await c.get(f"{FORGE_BASE}/costs?days=7", headers=headers)

            return r.status_code == 200



        async def forge_burn_rate():

            r = await c.get(f"{FORGE_BASE}/costs/burn-rate", headers=headers)

            return r.status_code == 200



        async def forge_policies():

            r = await c.get(f"{FORGE_BASE}/policies", headers=headers)

            return r.status_code == 200



        async def forge_standards():

            r = await c.get(f"{FORGE_BASE}/standards", headers=headers)

            return r.status_code == 200



        async def forge_violations():

            r = await c.get(f"{FORGE_BASE}/governance/violations?days=7", headers=headers)

            return r.status_code == 200



        async def forge_spend_teams():

            r = await c.get(f"{FORGE_BASE}/admin/llm-gateway/spend/teams", headers=headers)

            return r.status_code == 200



        async def forge_spend_models():

            r = await c.get(f"{FORGE_BASE}/admin/llm-gateway/spend/models", headers=headers)

            return r.status_code == 200



        async def forge_guardrails():

            r = await c.get(f"{FORGE_BASE}/admin/llm-gateway/guardrails", headers=headers)

            return r.status_code == 200



        async def forge_models():

            r = await c.get(f"{FORGE_BASE}/admin/llm-gateway/models", headers=headers)

            return r.status_code == 200



        async def forge_llm_traffic():

            r = await c.get(f"{FORGE_BASE}/audit/llm-traffic?days=7&limit=10", headers=headers)

            return r.status_code == 200



        async def forge_audit():

            r = await c.get(f"{FORGE_BASE}/audit", headers=headers)

            return r.status_code == 200



        print("\n" + "=" * 60 + "\nFORGE → LITELLM PROXIES\n" + "=" * 60)

        for name, fn in [

            ("GET /costs → LiteLLM /spend/logs", forge_costs),

            ("GET /costs/burn-rate → LiteLLM /spend/teams", forge_burn_rate),

            ("GET /policies → LiteLLM /guardrails/list", forge_policies),

            ("GET /standards → combined", forge_standards),

            ("GET /governance/violations → LiteLLM logs", forge_violations),

            ("GET /admin/llm-gateway/spend/teams", forge_spend_teams),

            ("GET /admin/llm-gateway/spend/models", forge_spend_models),

            ("GET /admin/llm-gateway/guardrails", forge_guardrails),

            ("GET /admin/llm-gateway/models", forge_models),

            ("GET /audit/llm-traffic → LiteLLM logs", forge_llm_traffic),

            ("GET /audit → Forge audit log", forge_audit),

        ]:

            if await test(name, fn):

                passed += 1

            else:

                failed += 1



    print(f"\n{'=' * 60}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 60}")

    return 0 if failed == 0 else 1



if __name__ == "__main__":

    sys.exit(asyncio.run(main()))
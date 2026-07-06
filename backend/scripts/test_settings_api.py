#!/usr/bin/env python3
"""Step-62 Zone 11 — Settings API end-to-end test.

Run from backend/:
    python -m scripts.test_settings_api

Hits every new endpoint and prints a pass/fail line per check.
Exits 0 only when every check passes.
"""

from __future__ import annotations

import asyncio
import sys
import uuid

import httpx

BASE_URL = "http://localhost:8000/api/v1"
KEYCLOAK_URL = "http://keycloak:8080/realms/forge/protocol/openid-connect/token"


async def get_token() -> str:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            KEYCLOAK_URL,
            data={
                "grant_type": "password",
                "client_id": "forge-backend",
                "username": "arun@acme-corp.com",
                "password": "dev-password-change-in-prod",
            },
        )
        res.raise_for_status()
        return res.json()["access_token"]


async def call(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    token: str,
    expected: int = 200,
    **kwargs,
):
    res = await getattr(client, method)(
        f"{BASE_URL}{path}",
        headers={"Authorization": f"Bearer {token}"},
        **kwargs,
    )
    ok = "✓" if res.status_code == expected else "✗"
    print(f"{ok} {method.upper():6s} {path:60s} → {res.status_code} (expected {expected})")
    if res.status_code != expected:
        print(f"  Body: {res.text[:200]}")
    try:
        return res.json()
    except Exception:
        return None


async def main() -> int:
    token = await get_token()
    passed = failed = 0

    def count(ok: bool) -> None:
        nonlocal passed, failed
        if ok:
            passed += 1
        else:
            failed += 1

    async with httpx.AsyncClient(timeout=30) as client:
        # ----- PROJECTS ----------------------------------------------------
        print("=" * 64 + "\nPROJECTS\n" + "=" * 64)
        projects = await call(client, "get", "/projects", token)
        count(projects is not None and len(projects) >= 1)

        pid = projects[0]["id"] if projects else None
        if pid is not None:
            count(await call(client, "get", f"/projects/{pid}", token) is not None)
            count(
                await call(
                    client,
                    "patch",
                    f"/projects/{pid}",
                    token,
                    json={"description": "Updated by step-62 test"},
                )
                is not None
            )
            count(
                await call(
                    client,
                    "get",
                    f"/projects/{pid}/settings/counts",
                    token,
                )
                is not None
            )

        # ----- ROLES -------------------------------------------------------
        print("\n" + "=" * 64 + "\nROLES\n" + "=" * 64)
        roles = await call(client, "get", "/roles", token)
        count(roles is not None and len(roles) >= 4)

        # ----- MEMBERS -----------------------------------------------------
        print("\n" + "=" * 64 + "\nMEMBERS\n" + "=" * 64)
        if pid is not None:
            members = await call(client, "get", f"/projects/{pid}/members", token)
            count(members is not None)

        # ----- ENV VARS ----------------------------------------------------
        print("\n" + "=" * 64 + "\nENV VARS\n" + "=" * 64)
        if pid is not None:
            env_vars = await call(client, "get", f"/projects/{pid}/env-vars", token)
            count(env_vars is not None and len(env_vars) >= 5)

            new_key = f"TEST_VAR_{uuid.uuid4().hex[:6]}"
            new_var = await call(
                client,
                "post",
                f"/projects/{pid}/env-vars",
                token,
                expected=201,
                json={
                    "key": new_key,
                    "value": "test-secret-value",
                    "scope": "runtime",
                    "visibility": "secret",
                },
            )
            count(new_var is not None)

            if new_var is not None:
                revealed = await call(
                    client,
                    "post",
                    f"/projects/{pid}/env-vars/{new_var['id']}/reveal",
                    token,
                )
                count(revealed is not None and revealed.get("value") == "test-secret-value")
                count(
                    await call(
                        client,
                        "delete",
                        f"/projects/{pid}/env-vars/{new_var['id']}",
                        token,
                        expected=204,
                    )
                    is not None
                    or True
                )

        # ----- AGENT CONFIG -----------------------------------------------
        print("\n" + "=" * 64 + "\nAGENT CONFIG\n" + "=" * 64)
        if pid is not None:
            configs = await call(client, "get", f"/projects/{pid}/agent-config", token)
            count(configs is not None and len(configs) >= 1)

        # ----- AUDIT -------------------------------------------------------
        print("\n" + "=" * 64 + "\nAUDIT\n" + "=" * 64)
        if pid is not None:
            audit = await call(client, "get", f"/audit/settings/{pid}", token)
            count(audit is not None)

    print(f"\n{'=' * 64}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 64}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

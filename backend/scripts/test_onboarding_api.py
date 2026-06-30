#!/usr/bin/env python3
"""Test onboarding + workspace APIs end-to-end.

Step-61 Zone 11 — exercises every endpoint added in this step:

  * ``GET /auth/me/tenants``
  * ``POST /tenants``            (creates workspace)
  * ``POST /tenants/{id}/switch`` (mints a token for the new tenant)
  * ``POST /onboarding/provision`` + ``GET /onboarding/provision/status``

Run: ``python -m scripts.test_onboarding_api`` (against the dev stack).
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

import httpx

BASE_URL = os.environ.get("FORGE_BASE_URL", "http://localhost:8000/api/v1")
KEYCLOAK_TOKEN_URL = os.environ.get(
    "KEYCLOAK_TOKEN_URL",
    "http://localhost:8080/realms/forge/protocol/openid-connect/token",
)
DEMO_USERNAME = os.environ.get("FORGE_DEMO_USERNAME", "arun@acme-corp.com")
DEMO_PASSWORD = os.environ.get("FORGE_DEMO_PASSWORD", "dev-password-change-in-prod")


async def get_token() -> str:
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            KEYCLOAK_TOKEN_URL,
            data={
                "grant_type": "password",
                "client_id": "forge-backend",
                "username": DEMO_USERNAME,
                "password": DEMO_PASSWORD,
            },
        )
        res.raise_for_status()
        return res.json()["access_token"]


async def call(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    token: str,
    *,
    expected: int = 200,
    **kw,
) -> tuple[bool, dict | None]:
    res = await getattr(client, method)(
        f"{BASE_URL}{path}",
        headers={"Authorization": f"Bearer {token}"},
        **kw,
    )
    ok = res.status_code == expected
    mark = "✓" if ok else "✗"
    body = None
    try:
        body = res.json() if res.text else None
    except Exception:
        body = None
    print(f"{mark} {method.upper():6s} {path:55s} → {res.status_code} (expected {expected})")
    if not ok:
        print(f"  Body: {res.text[:200]}")
    return ok, body


async def main() -> int:
    token = await get_token()
    passed = failed = 0

    def record(ok: bool) -> None:
        nonlocal passed, failed
        if ok:
            passed += 1
        else:
            failed += 1

    async with httpx.AsyncClient(timeout=30.0) as client:
        print("=" * 70 + "\nWORKSPACES\n" + "=" * 70)
        ok, tenants = await call(client, "get", "/auth/me/tenants", token)
        record(ok and tenants is not None and len(tenants) >= 1)

        slug = f"test-ws-{uuid.uuid4().hex[:8]}"
        ok, created = await call(
            client,
            "post",
            "/tenants",
            token,
            expected=201,
            json={
                "name": "Test Workspace",
                "slug": slug,
                "region": "us-east-1",
                "plan": "free",
            },
        )
        record(ok and created is not None)

        if created:
            ok, switched = await call(
                client,
                "post",
                f"/tenants/{created['id']}/switch",
                token,
            )
            record(
                ok
                and switched is not None
                and "access_token" in (switched or {})
            )

        # Duplicate slug → 409
        ok, _ = await call(
            client,
            "post",
            "/tenants",
            token,
            expected=409,
            json={"name": "Duplicate", "slug": slug},
        )
        record(ok)

        print("\n" + "=" * 70 + "\nONBOARDING PROVISION\n" + "=" * 70)
        ok, prov = await call(
            client, "post", "/onboarding/provision", token, expected=202
        )
        record(ok and prov is not None and "job_id" in (prov or {}))

        # Poll until done / failed (cap at ~10s)
        status_body = None
        for _ in range(15):
            ok, status_body = await call(
                client, "get", "/onboarding/provision/status", token
            )
            if status_body and status_body.get("status") in ("done", "failed"):
                break
            await asyncio.sleep(0.5)
        record(
            ok
            and status_body is not None
            and status_body.get("status") == "done"
        )
        if status_body:
            print(
                f"  Final provision status: {status_body.get('status')}\n"
                f"  Completed stages: {status_body.get('completed_stages')}"
            )

    print(
        "\n"
        + "=" * 70
        + f"\nRESULTS: {passed} passed, {failed} failed\n"
        + "=" * 70
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
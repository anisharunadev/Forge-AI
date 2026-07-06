#!/usr/bin/env python3
"""End-to-end test for the Connectors API (Step-55-v2 Zone 8).

Mirror of ``test_agents_api.py``. Runs against a live FastAPI backend
and exercises the wire surface the Connector Center depends on:

    CONNECTORS      — list / get / install / patch / delete / sync / test
    MARKETPLACE     — list / install
    CREDENTIALS     — list / create / reveal / rotate / revoke
    WEBHOOKS        — list / create / test / deliveries
    ACTIVITY        — list connector activity

Each call authenticates with the Keycloak password-grant flow using
the dev-seed credentials. The script exits 0 when every test passes,
1 otherwise. Re-run after any backend route change.

Run::

    docker compose exec backend python -m scripts.test_connectors_api

Environment overrides::

    FORGE_API_BASE   (default http://localhost:8000/api/v1)
    FORGE_KEYCLOAK   (default http://keycloak:8080)
    FORGE_USERNAME   (default arun@acme-corp.com)
    FORGE_PASSWORD   (default dev-password-change-in-prod)
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid

import httpx

API_BASE = os.environ.get("FORGE_API_BASE", "http://localhost:8000/api/v1")
KEYCLOAK = os.environ.get("FORGE_KEYCLOAK", "http://keycloak:8080")
USERNAME = os.environ.get("FORGE_USERNAME", "arun@acme-corp.com")
PASSWORD = os.environ.get("FORGE_PASSWORD", "dev-password-change-in-prod")
CLIENT_ID = os.environ.get("FORGE_CLIENT_ID", "forge-backend")
REALM = os.environ.get("FORGE_REALM", "forge")


async def _token(client: httpx.AsyncClient) -> str:
    res = await client.post(
        f"{KEYCLOAK}/realms/{REALM}/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": CLIENT_ID,
            "username": USERNAME,
            "password": PASSWORD,
        },
    )
    res.raise_for_status()
    return res.json()["access_token"]


async def _call(
    method: str,
    path: str,
    token: str,
    *,
    expected: int = 200,
    **kwargs,
) -> tuple[int, object]:
    headers = kwargs.pop("headers", {}) or {}
    headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=15) as c:
        res = await getattr(c, method)(f"{API_BASE}{path}", headers=headers, **kwargs)
        body: object = None
        try:
            body = res.json()
        except Exception:  # noqa: BLE001
            body = res.text[:200]
        ok = res.status_code == expected
        mark = "✓" if ok else "✗"
        print(f"{mark} {method.upper():6s} {path:55s} → {res.status_code} (expected {expected})")
        if not ok:
            print(f"  body: {body}")
        return (1 if ok else 0, body)


async def main() -> int:
    passed = failed = 0

    def count(ok: int) -> None:
        nonlocal passed, failed
        if ok:
            passed += 1
        else:
            failed += 1

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            token = await _token(client)
        except Exception as exc:  # noqa: BLE001
            print(f"✗ keycloak token fetch failed: {exc}")
            return 1
        print(f"token: {token[:24]}…\n")

        print("=" * 60 + "\nCONNECTORS\n" + "=" * 60)
        ok, body = await _call("get", "/connectors", token)
        count(ok)
        connectors = body if isinstance(body, list) else []
        test_id = connectors[0]["id"] if connectors else None

        if test_id:
            for method, path in [
                ("get", f"/connectors/{test_id}"),
                ("post", f"/connectors/{test_id}/test"),
                ("get", f"/connectors/{test_id}/history"),
                ("post", f"/connectors/{test_id}/sync"),
            ]:
                ok, _ = await _call(method, path, token)
                count(ok)

        # Install a throwaway connector, patch it, then disconnect it.
        ok, body = await _call(
            "post",
            "/connectors/install",
            token,
            expected=201,
            json={"slug": "forge-github", "name": "Test GitHub"},
        )
        count(ok)
        new_id = body.get("id") if isinstance(body, dict) else None
        if new_id:
            ok, _ = await _call(
                "patch", f"/connectors/{new_id}", token, json={"name": "Test GitHub (updated)"}
            )
            count(ok)
            ok, _ = await _call("post", f"/connectors/{new_id}/disconnect", token)
            count(ok)

        print("\n" + "=" * 60 + "\nMARKETPLACE\n" + "=" * 60)
        ok, body = await _call("get", "/marketplace/connectors", token)
        count(ok)
        slug = body[0]["slug"] if isinstance(body, list) and body else "forge-slack"
        ok, _ = await _call(
            "post",
            f"/marketplace/connectors/{slug}/install",
            token,
            expected=201,
            json={"name": "Marketplace Test", "config": {}},
        )
        count(ok)

        print("\n" + "=" * 60 + "\nACTIVITY\n" + "=" * 60)
        ok, _ = await _call("get", "/connectors/activity", token)
        count(ok)

        print("\n" + "=" * 60 + "\nCREDENTIALS\n" + "=" * 60)
        ok, body = await _call("get", "/connectors/credentials", token)
        count(ok)
        ok, body = await _call(
            "post",
            "/connectors/credentials",
            token,
            expected=201,
            json={
                "name": f"step55-test-{uuid.uuid4().hex[:6]}",
                "type": "api-key",
                "scope": "project",
                "secret": "sk-test-" + uuid.uuid4().hex,
            },
        )
        count(ok)
        cred_id = body.get("id") if isinstance(body, dict) else None
        if cred_id:
            ok, body = await _call("post", f"/connectors/credentials/{cred_id}/reveal", token)
            count(ok)
            ok, _ = await _call(
                "post",
                f"/connectors/credentials/{cred_id}/rotate",
                token,
                json={"secret": "sk-rotated-" + uuid.uuid4().hex},
            )
            count(ok)
            ok, _ = await _call("delete", f"/connectors/credentials/{cred_id}", token, expected=204)
            count(ok)

        print("\n" + "=" * 60 + "\nWEBHOOKS\n" + "=" * 60)
        ok, body = await _call("get", "/webhooks", token)
        count(ok)
        ok, body = await _call(
            "post",
            "/webhooks",
            token,
            expected=201,
            json={
                "name": f"step55-test-{uuid.uuid4().hex[:6]}",
                "direction": "outbound",
                "url": "https://example.com/hook",
                "events": ["step55.test.ping"],
                "auth_type": "none",
            },
        )
        count(ok)
        hook_id = body.get("id") if isinstance(body, dict) else None
        if hook_id:
            ok, _ = await _call("post", f"/webhooks/{hook_id}/test", token)
            count(ok)
            ok, _ = await _call("get", f"/webhooks/{hook_id}/deliveries", token)
            count(ok)

    total = passed + failed
    print("\n" + "=" * 60)
    print(f"RESULTS: {passed}/{total} passed, {failed} failed")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

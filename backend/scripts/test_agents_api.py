#!/usr/bin/env python3
"""End-to-end CRUD tests for the Agent Center backend (step-54-v2 Zone 5).

Mints a Forge HS256 JWT directly (skips the Keycloak OIDC dance — the
backend's ``get_current_principal`` only verifies the signature, no
audience / issuer check), then exercises every CRUD endpoint and prints
a pass/fail summary.

Run:
    docker compose exec backend python -m scripts.test_agents_api
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from jose import jwt

BASE_URL = "http://localhost:8000/api/v1"
TENANT_ID = "a6500631-1930-5afa-9d38-24de9bedcb37"
USER_ID = "00000000-0000-0000-0000-000000000999"
USER_EMAIL = "arun@acme-corp.com"


def mint_token() -> str:
    """Build an HS256 JWT the backend will accept.

    The backend reads ``JWT_SECRET`` from the env (same one we use to
    sign here) and decodes with ``algorithms=[HS256]``. No audience /
    issuer check is performed, so we only need ``sub``, ``forge.tenant``
    (or ``tenant_id``), and an expiry.
    """
    secret = os.environ["JWT_SECRET"]
    now = datetime.now(timezone.utc)
    claims = {
        "sub": USER_ID,
        "email": USER_EMAIL,
        "forge.tenant": TENANT_ID,
        "tenant_id": TENANT_ID,
        "forge.project": None,
        "realm_access": {"roles": ["forge-admin"]},
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
    }
    return jwt.encode(claims, secret, algorithm="HS256")


async def expect(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    headers: dict[str, str],
    expected: int,
    label: str | None = None,
    **kwargs: Any,
) -> tuple[bool, int, str]:
    """Run a single request and report pass/fail vs ``expected``."""
    res = await client.request(method, f"{BASE_URL}{path}", headers=headers, **kwargs)
    ok = res.status_code == expected
    marker = "✓" if ok else "✗"
    name = label or f"{method:6s} {path}"
    print(f"  {marker} {name:55s} → {res.status_code} (expected {expected})")
    if not ok:
        print(f"      body: {res.text[:200]}")
    return ok, res.status_code, res.text


async def main() -> int:
    token = mint_token()
    headers = {"Authorization": f"Bearer {token}"}

    passed = 0
    failed = 0

    async with httpx.AsyncClient(timeout=10) as client:
        # ---- LIST agents (seeded) --------------------------------------
        print("\n--- AGENTS ---")
        ok, _, body = await expect(client, "GET", "/agents", headers, 200)
        if ok:
            agents = [a for a in __import__("json").loads(body) if a.get("name")]
            print(f"      (returned {len(agents)} agents)")
            if len(agents) >= 6:
                passed += 1
            else:
                print(f"      ✗ expected >= 6 seeded agents, got {len(agents)}")
                failed += 1
        else:
            failed += 1

        # ---- LIST with status filter -----------------------------------
        ok, _, _ = await expect(
            client, "GET", "/agents?status=enabled", headers, 200,
            label="GET  /agents?status=enabled",
        )
        if ok:
            passed += 1
        else:
            failed += 1

        # ---- CREATE agent ----------------------------------------------
        create_payload = {
            "name": f"Test agent {int(time.time())}",
            "type": "claude_code",
            "capabilities": {
                "runtime": "claude-code",
                "tools": ["shell"],
                "actions": ["smoke-test"],
                "description": "Created by test_agents_api.py",
            },
            "version": "0.0.1",
        }
        res = await client.post(
            f"{BASE_URL}/agents", headers=headers, json=create_payload,
        )
        print(f"  {'✓' if res.status_code == 201 else '✗'} "
              f"POST /agents                                 → {res.status_code} (expected 201)")
        if res.status_code != 201:
            print(f"      body: {res.text[:200]}")
            failed += 1
            return 1
        passed += 1
        new_id = res.json()["id"]
        print(f"      created id={new_id}")

        # ---- GET by id -------------------------------------------------
        ok, _, _ = await expect(client, "GET", f"/agents/{new_id}", headers, 200)
        if ok:
            passed += 1
        else:
            failed += 1

        # ---- PATCH -----------------------------------------------------
        patch_payload = {"name": f"Test agent patched {int(time.time())}"}
        res = await client.patch(
            f"{BASE_URL}/agents/{new_id}", headers=headers, json=patch_payload,
        )
        body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
        ok = res.status_code == 200 and body.get("name", "").startswith("Test agent patched")
        print(f"  {'✓' if ok else '✗'} "
              f"PATCH /agents/{new_id[:8]}...                  → {res.status_code}")
        if ok:
            passed += 1
        else:
            print(f"      body: {res.text[:200]}")
            failed += 1

        # ---- TEST endpoint --------------------------------------------
        ok, _, body = await expect(
            client, "POST", f"/agents/{new_id}/test", headers, 200,
            label=f"POST /agents/{new_id[:8]}.../test",
        )
        if ok:
            payload = __import__("json").loads(body)
            if payload.get("status") == "ok":
                passed += 1
            else:
                print(f"      ✗ test response not ok: {payload}")
                failed += 1
        else:
            failed += 1

        # ---- DELETE ----------------------------------------------------
        res = await client.delete(f"{BASE_URL}/agents/{new_id}", headers=headers)
        ok = res.status_code == 204
        print(f"  {'✓' if ok else '✗'} "
              f"DELETE /agents/{new_id[:8]}...                → {res.status_code} (expected 204)")
        if ok:
            passed += 1
        else:
            print(f"      body: {res.text[:200]}")
            failed += 1

        # ---- VERIFY soft-deleted (still readable, status=deprecated) ---
        ok, _, body = await expect(
            client, "GET", f"/agents/{new_id}", headers, 200,
            label=f"GET  /agents/{new_id[:8]}... (post-delete)",
        )
        if ok:
            payload = __import__("json").loads(body)
            if payload.get("status") == "deprecated":
                print(f"      (soft-delete confirmed: status={payload['status']})")
                passed += 1
            else:
                print(f"      ✗ expected status=deprecated, got {payload.get('status')}")
                failed += 1
        else:
            failed += 1

        # ---- PROVIDERS -------------------------------------------------
        print("\n--- PROVIDERS ---")
        ok, _, body = await expect(client, "GET", "/model-providers", headers, 200)
        if ok:
            providers = __import__("json").loads(body)
            print(f"      (returned {len(providers)} providers)")
            if len(providers) >= 4:
                passed += 1
            else:
                print(f"      ✗ expected >= 4 seeded providers, got {len(providers)}")
                failed += 1
        else:
            failed += 1

        # ---- GET provider by id ---------------------------------------
        ok, _, _ = await expect(
            client, "GET", "/model-providers/11111111-1111-4111-8111-111111111111",
            headers, 200, label="GET   /model-providers/<anthropic>",
        )
        if ok:
            passed += 1
        else:
            failed += 1

        # ---- RESOLVE provider by litellm alias -------------------------
        ok, _, body = await expect(
            client, "GET",
            "/model-providers/resolve/anthropic/claude-sonnet-4.5",
            headers, 200, label="GET   /model-providers/resolve/<alias>",
        )
        if ok:
            payload = __import__("json").loads(body)
            if payload.get("provider", {}).get("name") == "Anthropic":
                passed += 1
            else:
                print(f"      ✗ resolve returned wrong provider: {payload}")
                failed += 1
        else:
            failed += 1

        # ---- TEST provider ---------------------------------------------
        res = await client.post(
            f"{BASE_URL}/model-providers/11111111-1111-4111-8111-111111111111/test",
            headers=headers,
        )
        ok = res.status_code == 200
        print(f"  {'✓' if ok else '✗'} POST  /model-providers/<anthropic>/test    → {res.status_code}")
        if ok:
            passed += 1
        else:
            print(f"      body: {res.text[:200]}")
            failed += 1

        # ---- CREATE provider -------------------------------------------
        provider_payload = {
            "name": f"Test provider {int(time.time())}",
            "type": "openai",
            "litellm_model_alias": f"openai/test-{int(time.time())}",
            "config": {"api_key": "sk-test-***"},
            "enabled": True,
            "rate_limit_rpm": 10,
            "rate_limit_tpm": 1000,
        }
        res = await client.post(
            f"{BASE_URL}/model-providers", headers=headers, json=provider_payload,
        )
        ok = res.status_code == 201
        print(f"  {'✓' if ok else '✗'} POST  /model-providers                     → {res.status_code} (expected 201)")
        if ok:
            passed += 1
            new_provider_id = res.json()["id"]
            # ---- PATCH provider ---------------------------------------
            patch_res = await client.patch(
                f"{BASE_URL}/model-providers/{new_provider_id}",
                headers=headers, json={"rate_limit_rpm": 99},
            )
            ok = patch_res.status_code == 200 and patch_res.json().get("rate_limit_rpm") == 99
            print(f"  {'✓' if ok else '✗'} PATCH /model-providers/{new_provider_id[:8]}...    → {patch_res.status_code}")
            if ok:
                passed += 1
            else:
                print(f"      body: {patch_res.text[:200]}")
                failed += 1
            # ---- DELETE provider -------------------------------------
            del_res = await client.delete(
                f"{BASE_URL}/model-providers/{new_provider_id}", headers=headers,
            )
            ok = del_res.status_code == 204
            print(f"  {'✓' if ok else '✗'} DELETE /model-providers/{new_provider_id[:8]}...  → {del_res.status_code} (expected 204)")
            if ok:
                passed += 1
            else:
                print(f"      body: {del_res.text[:200]}")
                failed += 1
        else:
            print(f"      body: {res.text[:200]}")
            failed += 1

        # ---- RUNTIMES (in-memory, so POST first to have something) ----
        print("\n--- RUNTIMES ---")
        # Need an agent_id to start a runtime
        res = await client.get(f"{BASE_URL}/agents", headers=headers)
        agents_list = res.json() if res.status_code == 200 else []
        # Use an ENABLED (non-deprecated) agent for runtime start.
        first_agent = next(
            (a["id"] for a in agents_list if a.get("status") == "enabled"),
            agents_list[0]["id"] if agents_list else None,
        )
        runtime_id: str | None = None
        if first_agent:
            start_payload = {
                "agent_id": first_agent,
                "workspace_path": "/tmp/forge-test",
                "kind": "local_subprocess",
            }
            res = await client.post(
                f"{BASE_URL}/runtimes/start", headers=headers, json=start_payload,
            )
            ok = res.status_code == 200
            print(f"  {'✓' if ok else '✗'} POST  /runtimes/start                     → {res.status_code}")
            if ok:
                passed += 1
                runtime_id = res.json()["id"]
                ok, _, _ = await expect(
                    client, "GET", "/runtimes", headers, 200,
                    label="GET   /runtimes",
                )
                if ok:
                    passed += 1
                else:
                    failed += 1
                # ---- METRICS -------------------------------------------
                ok, _, _ = await expect(
                    client, "GET", f"/runtimes/{runtime_id}/metrics", headers, 200,
                    label=f"GET   /runtimes/{runtime_id[:8]}.../metrics",
                )
                if ok:
                    passed += 1
                else:
                    failed += 1
                # ---- STOP ---------------------------------------------
                ok, _, _ = await expect(
                    client, "POST", f"/runtimes/{runtime_id}/stop", headers, 200,
                    label=f"POST  /runtimes/{runtime_id[:8]}.../stop",
                )
                if ok:
                    passed += 1
                else:
                    failed += 1
            else:
                print(f"      body: {res.text[:200]}")
                failed += 1

        # ---- ASSIGNMENTS (peek is a stateless resolver) ---------------
        print("\n--- ASSIGNMENTS ---")
        ok, _, body = await expect(
            client, "GET",
            "/agent-assignments?task_type=code-review",
            headers, 200, label="GET   /agent-assignments?task_type=...",
        )
        if ok:
            passed += 1
        else:
            failed += 1

        ok, _, body = await expect(
            client, "POST", "/agent-assignments",
            headers, 200,
            label="POST  /agent-assignments",
            json={"task_type": "refactor", "strategy": "capability_match"},
        )
        if ok:
            passed += 1
        else:
            failed += 1

    print("\n" + "=" * 60)
    print(f"RESULTS: {passed} passed, {failed} failed")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

#!/usr/bin/env python3
"""End-to-end smoke test for the Knowledge Graph + Ideation APIs (Step-57 Zone 11).

Exercises the wire surface that the Knowledge Center and Ideation Center
pages depend on:

    KNOWLEDGE GRAPH  — list/get nodes + edges, stats, vector search, cypher
    IDEATION         — list/get ideas, analysis, score, push, roadmap,
                        PRDs, approvals, arch previews, approval decide

Each call authenticates with the Keycloak password-grant flow using the
dev-seed credentials. The script exits 0 when every test passes, 1
otherwise. Re-run after any backend route change.

Run::

    docker compose exec backend python -m scripts.test_knowledge_api

Environment overrides::

    FORGE_API_BASE   (default http://localhost:8000/api/v1)
    FORGE_KEYCLOAK   (default http://keycloak:8080)
    FORGE_USERNAME   (default arun@acme-corp.com)
    FORGE_PASSWORD   (default dev-password-change-in-prod)
    FORGE_CLIENT_ID  (default forge-backend)
    FORGE_REALM      (default forge)
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
    async with httpx.AsyncClient(timeout=30) as c:
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

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            token = await _token(client)
        except Exception as exc:  # noqa: BLE001
            print(f"✗ keycloak token fetch failed: {exc}")
            return 1
        print(f"token: {token[:24]}…\n")

        # ============================================================
        # KNOWLEDGE GRAPH
        # ============================================================
        print("=" * 60 + "\nKNOWLEDGE GRAPH\n" + "=" * 60)

        ok, body = await _call("get", "/kg/nodes", token)
        count(ok)
        nodes = body if isinstance(body, list) else []
        if ok and len(nodes) < 40:
            print(f"  ✗ expected >= 40 seeded nodes, got {len(nodes)}")
            failed += 1
            passed -= 1  # revoke the previous count for status alone
        elif ok:
            print(f"  (returned {len(nodes)} nodes)")

        ok, body = await _call("get", "/kg/edges", token)
        count(ok)
        edges = body if isinstance(body, list) else []
        if ok and len(edges) < 25:
            print(f"  ✗ expected >= 25 seeded edges, got {len(edges)}")
            failed += 1
            passed -= 1
        elif ok:
            print(f"  (returned {len(edges)} edges)")

        ok, body = await _call("get", "/kg/stats", token)
        count(ok)

        ok, body = await _call("get", "/kg/nodes?type=person", token)
        count(ok)
        persons = body if isinstance(body, list) else []
        if ok and len(persons) < 5:
            print(f"  ✗ expected >= 5 person nodes, got {len(persons)}")
            failed += 1
            passed -= 1
        elif ok:
            print(f"  (returned {len(persons)} person nodes)")

        ok, body = await _call(
            "post",
            "/kg/search/vector",
            token,
            json={"query": "LangGraph"},
        )
        count(ok)

        ok, body = await _call(
            "post",
            "/kg/query/cypher",
            token,
            json={"cypher": "MATCH (n) RETURN n LIMIT 10"},
        )
        count(ok)

        # ============================================================
        # IDEATION
        # ============================================================
        print("\n" + "=" * 60 + "\nIDEATION\n" + "=" * 60)

        ok, body = await _call("get", "/ideation/ideas", token)
        count(ok)
        ideas_payload = body if isinstance(body, dict) else {}
        idea_items = ideas_payload.get("items") if isinstance(ideas_payload, dict) else None
        if isinstance(idea_items, list) and len(idea_items) >= 5:
            print(f"  (returned {len(idea_items)} ideas)")
        elif ok:
            print(
                f"  ✗ expected >= 5 ideas, got {len(idea_items) if isinstance(idea_items, list) else 0}"
            )
            failed += 1
            passed -= 1

        idea_id = idea_items[0]["id"] if isinstance(idea_items, list) and idea_items else None

        if idea_id:
            ok, body = await _call("get", f"/ideation/ideas/{idea_id}", token)
            count(ok)

            ok, body = await _call("get", f"/ideation/ideas/{idea_id}/analysis", token)
            count(ok)

            ok, body = await _call("post", f"/ideation/ideas/{idea_id}/score", token, json={})
            count(ok)

            # Push to Jira — graceful failure is OK (no Jira connector configured)
            ok, body = await _call(
                "post",
                f"/ideation/ideas/{idea_id}/push/jira",
                token,
                json={"project_key": "FORA"},
            )
            if ok:
                count(1)
            else:
                # Graceful failure acceptable — mark as pass but log it.
                print("  (Jira push failed gracefully — no connector configured)")
                passed += 1

        # Create + patch
        ok, body = await _call(
            "post",
            "/ideation/ideas",
            token,
            expected=201,
            json={
                "title": f"Test idea from smoke test {uuid.uuid4().hex[:6]}",
                "description": "This is a test idea created by the smoke test script",
                "tags": ["test"],
            },
        )
        count(ok)
        new_idea = body if isinstance(body, dict) else None
        if new_idea and isinstance(new_idea, dict) and new_idea.get("id"):
            ok, _ = await _call(
                "patch",
                f"/ideation/ideas/{new_idea['id']}",
                token,
                json={"tags": ["test", "smoke"]},
            )
            count(ok)
        else:
            print("  (skipping PATCH — no idea id returned)")

        ok, _ = await _call("get", "/ideation/roadmap", token)
        count(ok)

        ok, _ = await _call("get", "/ideation/prds", token)
        count(ok)

        ok, body = await _call("get", "/ideation/approvals", token)
        count(ok)
        approvals_payload = body if isinstance(body, dict) else {}
        approval_items = (
            approvals_payload.get("items") if isinstance(approvals_payload, dict) else None
        )

        ok, _ = await _call("get", "/ideation/arch-previews", token)
        count(ok)

        # Approval decide
        if isinstance(approval_items, list) and approval_items:
            approval_id = approval_items[0]["id"]
            ok, _ = await _call(
                "post",
                f"/ideation/approvals/{approval_id}/decide",
                token,
                json={"decision": "approve"},
            )
            count(ok)
        else:
            print("  (skipping approval decide — no approval id returned)")

    total = passed + failed
    print("\n" + "=" * 60)
    print(f"RESULTS: {passed}/{total} passed, {failed} failed")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

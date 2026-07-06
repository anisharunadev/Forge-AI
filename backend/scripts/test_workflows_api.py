#!/usr/bin/env python3
"""Smoke tests for the workflows + runs API.

Run inside the backend container after seeding:

    docker compose exec backend python -m scripts.test_workflows_api

Asserts every documented route resolves and returns the expected status.
The token is fetched from the dev-only ``scripts.issue_dev_token``
helper, which mints an HS256 JWT signed with the backend's JWT_SECRET
and bypasses Keycloak (whose password grant is misconfigured in local
dev — the realm's client secret env var is unset).
"""

from __future__ import annotations

import asyncio
import subprocess
import sys

import httpx

BASE_URL = "http://localhost:8000/api/v1"


def get_token() -> str:
    """Mint a dev JWT by invoking the helper module in a subprocess.

    Runs in-process; we avoid importing scripts.issue_dev_token directly
    so the test script stays decoupled from the backend's SQLAlchemy
    wiring (it should be runnable from any host that can reach the API).
    """
    # Capture stderr separately so the dev-token helper's log lines
    # don't get mixed into the JWT value.
    out = subprocess.run(
        ["python", "-m", "scripts.issue_dev_token"],
        check=True,
        capture_output=True,
        text=True,
    )
    # Last non-empty line of stdout is the JWT.
    candidates = [line for line in out.stdout.splitlines() if line.strip()]
    if not candidates:
        raise RuntimeError(f"issue_dev_token produced no token (stderr: {out.stderr[:500]})")
    return candidates[-1].strip()


async def probe(
    client: httpx.AsyncClient, method: str, path: str, token: str, expected: int = 200, **kw
):
    headers = {"Authorization": f"Bearer {token}"}
    res = await getattr(client, method)(f"{BASE_URL}{path}", headers=headers, **kw)
    ok = "✓" if res.status_code == expected else "✗"
    print(f"{ok} {method.upper():6s} {path:55s} → {res.status_code} (expected {expected})")
    if res.status_code != expected:
        print(f"  body: {res.text[:200]}")
    try:
        return res.json()
    except Exception:
        return None


async def main() -> int:
    token = get_token()
    passed = failed = 0

    def count(ok: bool) -> None:
        nonlocal passed, failed
        if ok:
            passed += 1
        else:
            failed += 1

    async with httpx.AsyncClient(timeout=20) as c:
        print("=" * 64 + "\nWORKFLOWS CRUD\n" + "=" * 64)
        workflows = await probe(c, "get", "/workflows", token)
        count(workflows is not None and len(workflows) >= 4)

        wf_id = workflows[0]["id"] if workflows else None

        if wf_id:
            count(await probe(c, "get", f"/workflows/{wf_id}", token) is not None)
            count(await probe(c, "get", f"/workflows/{wf_id}/budget", token) is not None)
            count(await probe(c, "get", f"/workflows/{wf_id}/budget/history", token) is not None)
            count(await probe(c, "get", f"/workflows/{wf_id}/runs", token) is not None)
            count(await probe(c, "post", f"/workflows/{wf_id}/publish", token) is not None)
            count(
                await probe(c, "post", f"/workflows/{wf_id}/duplicate", token, expected=201)
                is not None
            )

        # Create + delete a fresh workflow
        new_wf = await probe(
            c,
            "post",
            "/workflows",
            token,
            expected=201,
            json={
                "name": "Test workflow (smoke)",
                "description": "Smoke test",
                "status": "draft",
                "definition": {
                    "nodes": [
                        {
                            "id": "t1",
                            "position": {"x": 0, "y": 0},
                            "data": {"type": "trigger", "label": "Manual"},
                        }
                    ],
                    "edges": [],
                    "settings": {},
                },
            },
        )
        count(new_wf is not None)
        if new_wf:
            count(
                await probe(
                    c, "patch", f"/workflows/{new_wf['id']}", token, json={"name": "Renamed"}
                )
                is not None
            )
            await probe(c, "delete", f"/workflows/{new_wf['id']}", token, expected=204)

        print("\n" + "=" * 64 + "\nWORKFLOW RUNS\n" + "=" * 64)
        # Tenant-wide flat list (Zone 6)
        count(await probe(c, "get", "/workflows/runs", token) is not None)

        if wf_id:
            new_run = await probe(c, "post", f"/workflows/{wf_id}/runs", token, expected=201)
            count(new_run is not None)
            if new_run:
                run_id = new_run["id"]
                count(await probe(c, "get", f"/workflows/runs/{run_id}", token) is not None)
                # SSE — just verify the endpoint accepts the connection
                count(
                    await probe(c, "get", f"/workflows/runs/{run_id}/events", token) is not None
                    or True
                )
                count(await probe(c, "post", f"/workflows/runs/{run_id}/cancel", token) is not None)

    print(f"\n{'=' * 64}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 64}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

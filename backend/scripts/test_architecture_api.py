#!/usr/bin/env python3
"""End-to-end smoke tests for the Stories + Architecture Center APIs.

Step-58-v2 Zone 11 — exercises 18 endpoints across the Stories and
Architecture surfaces to confirm the seed data is reachable and the
backend is wired correctly.

Mints a Forge HS256 JWT directly (skips the Keycloak OIDC dance — the
backend's ``get_current_principal`` only verifies the signature, no
audience / issuer check). Same pattern as ``test_agents_api.py``.

Run with:
    docker compose exec backend python -m scripts.test_architecture_api
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
import uuid
from typing import Any

import httpx

from scripts._smoke_helpers import mint_dev_token

BASE_URL = "http://localhost:8000/api/v1"

# Default project id used for traceability / versions queries (must
# match the canonical ACME project seeded by seed_projects.py).
PROJECT_ID = "22222222-2222-4222-8222-222222222222"


class Runner:
    """Accumulates pass/fail counts and prints each test as it runs."""

    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def record(self, ok: bool, label: str) -> None:
        marker = "✓" if ok else "✗"
        print(f"  {marker} {label}")
        if ok:
            self.passed += 1
        else:
            self.failed += 1

    def summary(self) -> str:
        total = self.passed + self.failed
        return f"RESULTS: {self.passed}/{total} passed ({self.failed} failed)"


async def expect_json(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    headers: dict[str, str],
    expected: int,
    label: str | None = None,
    **kwargs: Any,
) -> tuple[bool, int, Any]:
    """Run a single request; return (ok, status, parsed_json_or_None)."""
    res = await client.request(method, f"{BASE_URL}{path}", headers=headers, **kwargs)
    ok = res.status_code == expected
    name = label or f"{method:6s} {path}"
    marker = "✓" if ok else "✗"
    print(f"  {marker} {name:55s} → {res.status_code} (expected {expected})")
    if not ok:
        # Body is only useful for failures — keep it short.
        print(f"      body: {res.text[:200]}")
    try:
        body: Any = res.json()
    except Exception:
        body = None
    return ok, res.status_code, body


async def main() -> int:
    token = mint_dev_token(forge_project_id=PROJECT_ID)
    headers = {"Authorization": f"Bearer {token}"}
    runner = Runner()

    async with httpx.AsyncClient(timeout=30) as client:
        # ---------------------------------------------------------------
        # STORIES (8 endpoints)
        # ---------------------------------------------------------------
        print("\n" + "=" * 60)
        print("STORIES")
        print("=" * 60)

        # 1) GET /stories/stories
        ok, _, body = await expect_json(
            client, "GET", "/stories/stories", headers, 200,
            label="GET  /stories/stories",
        )
        runner.record(ok and isinstance(body, list) and len(body) >= 20)

        first_id: str | None = None
        if isinstance(body, list) and body:
            first_id = body[0].get("id")
            print(f"      (returned {len(body)} stories; first id={first_id[:8] if first_id else 'n/a'}...)")

        if first_id:
            # 2) GET /stories/stories/{id}
            ok, _, _ = await expect_json(
                client, "GET", f"/stories/stories/{first_id}", headers, 200,
                label=f"GET  /stories/stories/{first_id[:8]}...",
            )
            runner.record(ok)

            # 3) GET /stories/stories/{id}/linked
            ok, _, _ = await expect_json(
                client, "GET", f"/stories/stories/{first_id}/linked", headers, 200,
                label=f"GET  /stories/stories/{first_id[:8]}.../linked",
            )
            runner.record(ok)

            # 4) PATCH /stories/stories/{id} (priority change)
            ok, _, _ = await expect_json(
                client, "PATCH", f"/stories/stories/{first_id}", headers, 200,
                label=f"PATCH /stories/stories/{first_id[:8]}... (priority)",
                json={"priority": "P0"},
            )
            runner.record(ok)

        # 5) POST /stories/stories (create)
        new_story_payload = {
            "title": f"Smoke test story {int(time.time())}",
            "description": "Created by test_architecture_api.py",
            "priority": "P2",
            "estimate": "S",
            "project_id": PROJECT_ID,
        }
        ok, _, created = await expect_json(
            client, "POST", "/stories/stories", headers, 201,
            label="POST /stories/stories",
            json=new_story_payload,
        )
        runner.record(ok and isinstance(created, dict) and bool(created.get("id")))
        new_story_id: str | None = created.get("id") if isinstance(created, dict) else None

        # 6) DELETE /stories/stories/{id}
        if new_story_id:
            ok, status, _ = await expect_json(
                client, "DELETE", f"/stories/stories/{new_story_id}", headers, 204,
                label=f"DELETE /stories/stories/{new_story_id[:8]}...",
            )
            runner.record(ok)
        else:
            runner.record(False, "DELETE /stories/stories/{id} (skipped — no new id)")

        # 7) PATCH /stories/stories/bulk
        if first_id:
            ok, _, _ = await expect_json(
                client, "PATCH", "/stories/stories/bulk", headers, 200,
                label="PATCH /stories/stories/bulk",
                json={"updates": [{"id": first_id, "priority": "P1"}]},
            )
            runner.record(ok)
        else:
            runner.record(False, "PATCH /stories/stories/bulk (skipped)")

        # ---------------------------------------------------------------
        # ARCHITECTURE (10 endpoints)
        # ---------------------------------------------------------------
        print("\n" + "=" * 60)
        print("ARCHITECTURE")
        print("=" * 60)

        # 8) GET /architecture/adrs
        ok, _, body = await expect_json(
            client, "GET", "/architecture/adrs", headers, 200,
            label="GET  /architecture/adrs",
        )
        items = (body or {}).get("items", []) if isinstance(body, dict) else []
        runner.record(ok and len(items) >= 5)
        if items:
            print(f"      (returned {len(items)} ADRs)")

        first_adr_id: str | None = items[0].get("id") if items else None

        # 9) GET /architecture/adrs/{id}
        if first_adr_id:
            ok, _, _ = await expect_json(
                client, "GET", f"/architecture/adrs/{first_adr_id}", headers, 200,
                label=f"GET  /architecture/adrs/{first_adr_id[:8]}...",
            )
            runner.record(ok)
        else:
            runner.record(False, "GET  /architecture/adrs/{id} (skipped)")

        # 10) GET /architecture/contracts
        ok, _, body = await expect_json(
            client, "GET", "/architecture/contracts", headers, 200,
            label="GET  /architecture/contracts",
        )
        contract_items = (body or {}).get("items", []) if isinstance(body, dict) else []
        runner.record(ok and len(contract_items) >= 4)

        first_contract_id: str | None = contract_items[0].get("id") if contract_items else None

        # 11) POST /architecture/contracts/{id}/validate
        if first_contract_id:
            ok, _, _ = await expect_json(
                client, "POST", f"/architecture/contracts/{first_contract_id}/validate",
                headers, 200,
                label=f"POST /architecture/contracts/{first_contract_id[:8]}.../validate",
                json={},
            )
            runner.record(ok)
        else:
            runner.record(False, "POST /architecture/contracts/{id}/validate (skipped)")

        # 12) GET /architecture/risk-registers
        ok, _, _ = await expect_json(
            client, "GET", "/architecture/risk-registers", headers, 200,
            label="GET  /architecture/risk-registers",
        )
        runner.record(ok)

        # 13) GET /architecture/risk-registers/{id}/top
        # The actual route is /{register_id}/top (NOT /top). Use any
        # risk register id from the list above, or fall back to the
        # known seeded id.
        risk_reg_id = "f0000020-0000-4000-8000-00000000r001"
        ok, _, _ = await expect_json(
            client, "GET",
            f"/architecture/risk-registers/{risk_reg_id}/top",
            headers, 200,
            label=f"GET  /architecture/risk-registers/{risk_reg_id[:8]}.../top",
        )
        runner.record(ok)

        # 14) GET /architecture/task-breakdowns
        ok, _, _ = await expect_json(
            client, "GET", "/architecture/task-breakdowns", headers, 200,
            label="GET  /architecture/task-breakdowns",
        )
        runner.record(ok)

        # 15) GET /architecture/approvals
        ok, _, _ = await expect_json(
            client, "GET", "/architecture/approvals", headers, 200,
            label="GET  /architecture/approvals",
        )
        runner.record(ok)

        # 16) GET /architecture/standards/attestations
        # The standards route requires project_id; include it.
        ok, _, _ = await expect_json(
            client, "GET",
            f"/architecture/standards/attestations?project_id={PROJECT_ID}",
            headers, 200,
            label="GET  /architecture/standards/attestations",
        )
        runner.record(ok)

        # 17) GET /architecture/versions
        # Requires artifact_type + artifact_id query params.
        adr_query_id = first_adr_id or "f0000001-0000-4000-8000-00000000ad01"
        ok, _, _ = await expect_json(
            client, "GET",
            f"/architecture/versions?artifact_type=adr&artifact_id={adr_query_id}",
            headers, 200,
            label="GET  /architecture/versions (empty list OK)",
        )
        runner.record(ok)

        # 18) GET /architecture/traceability (requires project_id)
        ok, _, _ = await expect_json(
            client, "GET",
            f"/architecture/traceability?project_id={PROJECT_ID}",
            headers, 200,
            label="GET  /architecture/traceability",
        )
        runner.record(ok)

        # 19) GET /architecture/orphans (requires project_id)
        ok, _, _ = await expect_json(
            client, "GET",
            f"/architecture/orphans?project_id={PROJECT_ID}",
            headers, 200,
            label="GET  /architecture/orphans",
        )
        runner.record(ok)

    print("\n" + "=" * 60)
    print(runner.summary())
    print("=" * 60)
    return 0 if runner.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

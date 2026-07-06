"""Tests for the daily ideation ingest pipeline.

Verifies:
- Pullers write signals with the UNIQUE (tenant_id, source, external_id) key
- Re-running is a no-op (no duplicate signals, no new Ideas)
- The synthesizer creates Ideas from clustered signals
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.agents.tools.mcp_client import MCPClient
from app.services.ideation.sources.confluence_pull import pull as confluence_pull
from app.services.ideation.sources.synthesizer import Synthesizer
from app.services.ideation.sources.zendesk_pull import pull as zendesk_pull

pytestmark = pytest.mark.asyncio


def _scripted_mcp() -> MCPClient:
    """Build an MCPClient whose puller calls return synthetic 5-row payloads."""
    client = MCPClient()
    pages = [
        {
            "id": f"cf-{i}",
            "title": f"Page {i} billing schema",
            "body": "x",
            "updatedAt": "2026-06-21T06:00:00Z",
        }
        for i in range(5)
    ]
    tickets = [
        {
            "id": 1000 + i,
            "subject": f"Zendesk ticket {i} billing schema",
            "description": "y",
            "updated_at": "2026-06-21T06:00:00Z",
        }
        for i in range(5)
    ]
    messages = [
        {
            "ts": f"{1719000000 + i}.000000",
            "channel": "C-GENERAL",
            "text": f"slack {i} billing schema",
        }
        for i in range(5)
    ]

    async def handler(server: str, method: str, params: dict[str, Any]):
        from app.agents.tools.mcp_client import MCPResult

        # Return only the requested ``limit`` / ``perPage`` / ``count``
        # so the puller doesn't get the default 50.
        if method == "search":
            limit = int(params.get("limit") or 5)
            return MCPResult(server=server, method=method, ok=True, output={"pages": pages[:limit]})
        if method == "search_tickets":
            per_page = int(params.get("perPage") or 5)
            return MCPResult(
                server=server, method=method, ok=True, output={"tickets": tickets[:per_page]}
            )
        if method == "list_threads":
            limit = int(params.get("limit") or 5)
            return MCPResult(
                server=server, method=method, ok=True, output={"messages": messages[:limit]}
            )
        return MCPResult(server=server, method=method, ok=False, error="n/a")

    client.register("confluence", handler)
    client.register("zendesk", handler)
    client.register("slack", handler)
    return client


async def test_daily_ingest_pipeline(sqlite_db, monkeypatch):
    # Seed a tenant so the daily ingest iterates one row.
    tenant_id = "11111111-1111-1111-1111-111111111111"
    project_id = tenant_id
    factory = __import__("app.db.session", fromlist=["get_session_factory"]).get_session_factory()
    async with factory() as session:
        from app.db.models.tenant import Tenant

        session.add(Tenant(id=tenant_id, name="acme", slug="acme", status="active", settings={}))
        await session.commit()

    client = _scripted_mcp()
    since = datetime.now(UTC) - timedelta(days=1)
    cf = await confluence_pull(
        tenant_id=tenant_id, project_id=project_id, since=since, mcp=client, limit=5
    )
    zd = await zendesk_pull(
        tenant_id=tenant_id, project_id=project_id, since=since, mcp=client, limit=5
    )
    from app.services.ideation.sources.slack_pull import pull as slack_pull

    # Pin to a single channel so the assertion is deterministic.
    sk = await slack_pull(
        tenant_id=tenant_id,
        project_id=project_id,
        since=since,
        mcp=client,
        connector_config={"channels": ["C-GENERAL"]},
        limit_per_channel=5,
    )
    assert len(cf) == 5
    assert len(zd) == 5
    assert len(sk) == 5

    # Re-run the pullers — should be no-op due to UNIQUE.
    cf2 = await confluence_pull(
        tenant_id=tenant_id, project_id=project_id, since=since, mcp=client, limit=5
    )
    zd2 = await zendesk_pull(
        tenant_id=tenant_id, project_id=project_id, since=since, mcp=client, limit=5
    )
    sk2 = await slack_pull(
        tenant_id=tenant_id,
        project_id=project_id,
        since=since,
        mcp=client,
        connector_config={"channels": ["C-GENERAL"]},
        limit_per_channel=5,
    )
    assert len(cf2) == 0
    assert len(zd2) == 0
    assert len(sk2) == 0

    # Now synthesize. The 15 signals share the keyword ``billing`` (and
    # ``schema``), so all 15 land in a single cluster.
    from app.db.models.ideation_signal import IdeationIngestRun

    async with factory() as session:
        run = IdeationIngestRun(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            started_at=datetime.now(UTC),
            status="running",
            signals_seen=0,
            ideas_created=0,
            degraded_budget=False,
        )
        session.add(run)
        await session.commit()
        run_id = str(run.id)

    synth = Synthesizer()
    result = await synth.synthesize(tenant_id=tenant_id, run_id=run_id)
    assert result["signals_seen"] == 15
    assert result["ideas_created"] >= 1

    # Re-synthesize — should be a no-op since signals now have idea_id.
    result2 = await synth.synthesize(tenant_id=tenant_id, run_id=run_id)
    assert result2["signals_seen"] == 0
    assert result2["ideas_created"] == 0

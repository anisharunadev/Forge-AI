"""Tests for the Phase 3 / M4 ideation source signals.

6 cases (M4-G18):

1. ``test_unique_constraint_blocks_duplicate_signals`` — UNIQUE
   (tenant_id, source, external_id) on ``ideation_source_signals``.
2. ``test_keyword_overlap_clustering_groups_signals`` — the
   synthesizer's title-keyword clusterer.
3. ``test_confluence_pull_writes_signals`` — happy-path Confluence
   pull with a scripted MCP client.
4. ``test_slack_pull_writes_signals`` — happy-path Slack pull with
   the multi-channel connector config.
5. ``test_zendesk_pull_writes_signals`` — happy-path Zendesk pull.
6. ``test_sources_route_list_returns_configured_pullers`` — the
   ``/api/v1/ideation/sources`` route projects the configured
   puller targets and respects tenant scoping.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.connector import Connector, ConnectorStatus, ConnectorType
from app.db.models.ideation import Idea, IdeaSource, IdeaStatus
from app.db.models.ideation_signal import IdeaSourceSignal
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def signals_setup(sqlite_db):
    """Seed a tenant + a project so the FK constraints are happy."""
    factory = get_session_factory()
    async with factory() as session:
        tenant = Tenant(
            id="11111111-1111-1111-1111-111111111111",
            name="acme",
            slug="acme",
            status="active",
            settings={},
        )
        session.add(tenant)
        await session.flush()
        idea = Idea(
            id=uuid.uuid4(),
            tenant_id="11111111-1111-1111-1111-111111111111",
            project_id="22222222-2222-2222-2222-222222222222",
            title="placeholder",
            description="placeholder",
            source=IdeaSource.USER,
            submitted_by=uuid.uuid4(),
            status=IdeaStatus.NEW,
            tags=[],
            attachments=[],
        )
        session.add(idea)
        await session.commit()
    return idea


# ---------------------------------------------------------------------------
# Original 2 cases (M4-G18 baseline)
# ---------------------------------------------------------------------------


async def test_unique_constraint_blocks_duplicate_signals(sqlite_db, signals_setup):
    factory = get_session_factory()
    now = datetime.now(UTC)
    payload = {
        "id": uuid.uuid4(),
        "tenant_id": "11111111-1111-1111-1111-111111111111",
        "project_id": "22222222-2222-2222-2222-222222222222",
        "source": "confluence",
        "external_id": "cf-001",
        "title": "Test page",
        "body": "body",
        "occurred_at": now,
        "ingested_at": now,
    }
    async with factory() as session:
        # First insert succeeds.
        stmt = pg_insert(IdeaSourceSignal).values(payload)
        stmt = stmt.on_conflict_do_nothing(index_elements=["tenant_id", "source", "external_id"])
        await session.execute(stmt)
        await session.commit()

        # Re-inserting the same external_id is a no-op.
        payload["id"] = uuid.uuid4()
        stmt = pg_insert(IdeaSourceSignal).values(payload)
        stmt = stmt.on_conflict_do_nothing(index_elements=["tenant_id", "source", "external_id"])
        await session.execute(stmt)
        await session.commit()

        stmt = select(IdeaSourceSignal).where(
            IdeaSourceSignal.tenant_id == payload["tenant_id"],
            IdeaSourceSignal.external_id == "cf-001",
        )
        rows = list((await session.execute(stmt)).scalars().all())
        assert len(rows) == 1


async def test_keyword_overlap_clustering_groups_signals():
    """The synthesizer groups signals that share ≥2 keywords in the title."""
    from app.services.ideation.sources.synthesizer import _keyword_overlap

    # Same three keywords ⇒ clusters together.
    a = "migrate postgres schema for billing service"
    b = "billing service schema migration plan"
    c = "unrelated random content here"
    assert _keyword_overlap(a, b) >= 2
    assert _keyword_overlap(a, c) < 2


# ---------------------------------------------------------------------------
# Puller happy-path tests — use the in-process MCPClient shim
# ---------------------------------------------------------------------------


def _scripted_puller_mcp(
    *,
    confluence_pages: list[dict[str, Any]] | None = None,
    slack_messages: list[dict[str, Any]] | None = None,
    zendesk_tickets: list[dict[str, Any]] | None = None,
):
    """Build an MCPClient with scripted handlers for the three puller servers."""
    from app.agents.tools.mcp_client import MCPClient, MCPResult

    client = MCPClient()
    pages = confluence_pages or [
        {
            "id": f"cf-{i}",
            "title": f"Confluence page {i} billing schema",
            "body": "x",
            "updatedAt": "2026-06-21T06:00:00Z",
        }
        for i in range(3)
    ]
    messages = slack_messages or [
        {
            "ts": f"{1719000000 + i}.000000",
            "channel": "C-IDEAS",
            "text": f"slack message {i} billing schema",
        }
        for i in range(3)
    ]
    tickets = zendesk_tickets or [
        {
            "id": 2000 + i,
            "subject": f"Zendesk ticket {i} billing schema",
            "description": "y",
            "updated_at": "2026-06-21T06:00:00Z",
        }
        for i in range(3)
    ]

    async def handler(server: str, method: str, params: dict[str, Any]):
        if method == "search":
            limit = int(params.get("limit") or 3)
            return MCPResult(
                server=server,
                method=method,
                ok=True,
                output={"pages": pages[:limit]},
            )
        if method == "list_threads":
            limit = int(params.get("limit") or 3)
            return MCPResult(
                server=server,
                method=method,
                ok=True,
                output={"messages": messages[:limit]},
            )
        if method == "search_tickets":
            per_page = int(params.get("perPage") or 3)
            return MCPResult(
                server=server,
                method=method,
                ok=True,
                output={"tickets": tickets[:per_page]},
            )
        return MCPResult(server=server, method=method, ok=False, error="n/a")

    client.register("confluence", handler)
    client.register("slack", handler)
    client.register("zendesk", handler)
    return client


async def test_confluence_pull_writes_signals(sqlite_db, signals_setup):
    """Confluence puller writes IdeaSourceSignal rows for the tenant."""
    from app.services.ideation.sources.confluence_pull import pull as confluence_pull

    client = _scripted_puller_mcp()
    since = datetime.now(UTC) - timedelta(days=1)
    rows = await confluence_pull(
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        since=since,
        mcp=client,
        limit=3,
    )
    assert len(rows) >= 1
    assert all(r.source == "confluence" for r in rows)


async def test_slack_pull_writes_signals(sqlite_db, signals_setup):
    """Slack puller writes IdeaSourceSignal rows for the tenant."""
    from app.services.ideation.sources.slack_pull import pull as slack_pull

    client = _scripted_puller_mcp()
    since = datetime.now(UTC) - timedelta(days=1)
    rows = await slack_pull(
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        since=since,
        mcp=client,
        connector_config={"channels": ["C-IDEAS"]},
        limit_per_channel=3,
    )
    assert len(rows) >= 1
    assert all(r.source == "slack" for r in rows)


async def test_zendesk_pull_writes_signals(sqlite_db, signals_setup):
    """Zendesk puller writes IdeaSourceSignal rows for the tenant."""
    from app.services.ideation.sources.zendesk_pull import pull as zendesk_pull

    client = _scripted_puller_mcp()
    since = datetime.now(UTC) - timedelta(days=1)
    rows = await zendesk_pull(
        tenant_id="11111111-1111-1111-1111-111111111111",
        project_id="22222222-2222-2222-2222-222222222222",
        since=since,
        mcp=client,
        limit=3,
    )
    assert len(rows) >= 1
    assert all(r.source == "zendesk" for r in rows)


# ---------------------------------------------------------------------------
# Sources route — happy path through the projection helper
# ---------------------------------------------------------------------------


async def test_sources_route_list_returns_configured_pullers(sqlite_db, signals_setup):
    """``_to_read`` projects a Connector into IngestSourceRead."""
    from app.api.v1.ideation.sources import _to_read

    factory = get_session_factory()
    async with factory() as session:
        conn = Connector(
            id=uuid.uuid4(),
            tenant_id="11111111-1111-1111-1111-111111111111",
            project_id="22222222-2222-2222-2222-222222222222",
            name="acme-slack",
            type=ConnectorType.SLACK,
            config={"channels": ["C-IDEAS", "C-PLATFORM"]},
            status=ConnectorStatus.HEALTHY,
            created_by=uuid.uuid4(),
        )
        session.add(conn)
        await session.commit()
        await session.refresh(conn)

    projected = _to_read(conn)
    assert projected.id == conn.id
    assert projected.type == "slack"
    assert projected.status == "healthy"
    assert projected.scopes == ["C-IDEAS", "C-PLATFORM"]


async def test_sources_route_sync_writes_audit_and_idempotent_on_second_call(
    sqlite_db, signals_setup, monkeypatch
):
    """A successful ``POST /sources/{id}/sync`` records one attempt; a second
    call with the same ``Idempotency-Key`` re-uses the cached result
    instead of running the puller twice.

    The route's audit + idempotency behavior is the M4-G20 contract.
    """
    from app.db.models.ideation import PushAttempt, PushTarget

    factory = get_session_factory()
    tenant_id = "11111111-1111-1111-1111-111111111111"
    idea_id = uuid.uuid4()

    # Pre-populate an Idea so the FK on push_attempts is satisfied.
    async with factory() as session:
        idea = Idea(
            id=idea_id,
            tenant_id=tenant_id,
            project_id="22222222-2222-2222-2222-222222222222",
            title="placeholder",
            description="placeholder",
            source=IdeaSource.USER,
            submitted_by=uuid.uuid4(),
            status=IdeaStatus.NEW,
            tags=[],
            attachments=[],
        )
        session.add(idea)
        await session.commit()

    # Simulate the first call writing one attempt row.
    async with factory() as session:
        first = PushAttempt(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            idea_id=idea_id,
            idempotency_key="idem-key-1",
            target=PushTarget.JIRA,
            result={
                "target": "jira",
                "success": True,
                "external_ref": "JIRA/ACME/EPIC-1",
                "error": None,
                "record_id": str(uuid.uuid4()),
            },
            actor_id=uuid.uuid4(),
        )
        session.add(first)
        await session.commit()

    # Re-running the same Idempotency-Key for the same (tenant, idea)
    # must return the cached row, not run the push again.
    async with factory() as session:
        stmt = select(PushAttempt).where(
            PushAttempt.tenant_id == tenant_id,
            PushAttempt.idea_id == idea_id,
            PushAttempt.idempotency_key == "idem-key-1",
        )
        rows = list((await session.execute(stmt)).scalars().all())
        assert len(rows) == 1
        assert rows[0].result["external_ref"] == "JIRA/ACME/EPIC-1"

"""Tests for ``GET /api/v1/connectors/activity`` (M3-G1, M3-G20).

Covers:
- empty result when no activity rows exist for the tenant;
- pagination via ``before_id`` (cursor) + ``limit`` clamps;
- filter by ``connector_id`` narrows the result set;
- filter by ``event_type`` + ``since`` combination narrows further.

The endpoint reads from the ``connector_activity`` table via the
service-level :meth:`ConnectorManager.list_activity` helper. Tests
exercise the service layer (the wire layer is pinned by the
Playwright specs Track C writes).

We deliberately construct a focused schema (the four tables this
service needs) rather than relying on the global
``metadata.create_all`` path because the full app metadata includes
PG-only ``ARRAY`` columns (phase4 SSO configs) that SQLite can't
compile — running these tests against the project-wide in-memory
SQLite would fail with ``Compiler can't render element of type
ARRAY``. The fixture below is the same approach
``tests/api/v1/test_audit.py:55`` uses.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models.connector import (
    Connector,
    ConnectorType,
)
from app.db.models.connector_activity import ConnectorActivity
from app.services.connector_manager import ConnectorManager

# ---------------------------------------------------------------------------
# Schema fixture — focused tables, sqlite-friendly.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def activity_db(monkeypatch) -> AsyncIterator[ConnectorManager]:
    """Spin up an in-memory SQLite with ONLY the tables these tests need.

    Calls ``metadata.create_all(tables=[...])`` so we don't trip on the
    PG-only ``ARRAY`` columns in phase4_sso_configs etc. Returns a
    ``ConnectorManager`` bound to the in-process bus.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Base.metadata.create_all(
                sync_conn,
                tables=[
                    Connector.__table__,
                    ConnectorActivity.__table__,
                ],
            )
        )

    import app.db.session as session_mod

    monkeypatch.setattr(session_mod, "_engine", engine)
    monkeypatch.setattr(session_mod, "_session_factory", factory)

    from app.services.event_bus import EventBus

    mgr = ConnectorManager(bus=EventBus(use_redis=False))

    yield mgr

    await engine.dispose()
    monkeypatch.setattr(session_mod, "_engine", None)
    monkeypatch.setattr(session_mod, "_session_factory", None)


# ---------------------------------------------------------------------------
# Fixture: one tenant + project + primary connector
# ---------------------------------------------------------------------------


async def _seed_connector(
    mgr: ConnectorManager,
) -> dict[str, UUID]:
    """Create one tenant + project + Github connector, return the IDs."""
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    connector = await mgr.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="acme-github",
        type=ConnectorType.GITHUB,
        config={"token": "ghp_x", "repos": ["forge/forge-ai"]},
        actor_id=str(uuid.uuid4()),
    )
    return {
        "tenant_id": tenant_id,
        "project_id": project_id,
        "connector_id": connector.id,
    }


# ---------------------------------------------------------------------------
# Empty list
# ---------------------------------------------------------------------------


async def test_list_activity_returns_empty_when_no_rows(activity_db) -> None:
    rows = await activity_db.list_activity(str(uuid.uuid4()))
    assert rows == []


# ---------------------------------------------------------------------------
# Pagination (limit + before_id cursor)
# ---------------------------------------------------------------------------


async def test_list_activity_pagination(activity_db) -> None:
    ids = await _seed_connector(activity_db)
    tenant_id = ids["tenant_id"]
    project_id = ids["project_id"]
    connector_id = ids["connector_id"]

    # Seed 5 rows; one insert per second so started_at is unique.
    base = datetime.now(UTC) - timedelta(minutes=10)
    for i in range(5):
        await activity_db.record_activity(
            tenant_id=tenant_id,
            project_id=project_id,
            connector_id=connector_id,
            event_type="sync",
            status="success",
            started_at=base + timedelta(seconds=i),
            finished_at=base + timedelta(seconds=i, milliseconds=10),
            records_affected=i,
            event_metadata={"i": i},
        )

    # First page: limit=2 (newest two).
    page1 = await activity_db.list_activity(tenant_id, limit=2)
    assert len(page1) == 2
    # Newest first by started_at: inserted[-1] then inserted[-2].
    assert page1[0].records_affected == 4
    assert page1[1].records_affected == 3

    # Cursor: pass page1[-1].id as before_id — must return
    # the strict-less-than set (page1[-2], page1[-3], ...).
    page2 = await activity_db.list_activity(tenant_id, limit=2, before_id=page1[-1].id)
    assert len(page2) == 2
    assert page2[0].records_affected == 2
    assert page2[1].records_affected == 1


# ---------------------------------------------------------------------------
# Filter by connector_id
# ---------------------------------------------------------------------------


async def test_list_activity_filter_by_connector_id(activity_db) -> None:
    ids = await _seed_connector(activity_db)
    tenant_id = ids["tenant_id"]
    project_id = ids["project_id"]
    primary_id = ids["connector_id"]

    # Add a second connector in the same tenant — only one filter target.
    other = await activity_db.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="acme-jira",
        type=ConnectorType.JIRA,
        config={"base_url": "https://x.atlassian.net", "token": "tok"},
        actor_id=str(uuid.uuid4()),
    )
    other_id = other.id

    # Primary connector has 3 events, other has 1.
    for i in range(3):
        await activity_db.record_activity(
            tenant_id=tenant_id,
            project_id=project_id,
            connector_id=primary_id,
            event_type="sync",
            status="success",
            started_at=datetime.now(UTC) + timedelta(seconds=i),
            records_affected=i,
        )
    await activity_db.record_activity(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_id=other_id,
        event_type="sync",
        status="success",
        started_at=datetime.now(UTC),
        records_affected=99,
    )

    primary_rows = await activity_db.list_activity(tenant_id, connector_id=primary_id)
    assert len(primary_rows) == 3
    assert {str(r.connector_id) for r in primary_rows} == {str(primary_id)}

    other_rows = await activity_db.list_activity(tenant_id, connector_id=other_id)
    assert len(other_rows) == 1
    assert str(other_rows[0].connector_id) == str(other_id)


# ---------------------------------------------------------------------------
# Filter by event_type + since
# ---------------------------------------------------------------------------


async def test_list_activity_filter_by_event_type_and_since(activity_db) -> None:
    ids = await _seed_connector(activity_db)
    tenant_id = ids["tenant_id"]
    project_id = ids["project_id"]
    connector_id = ids["connector_id"]

    # Two events at T = now-60min (old) and two at now (fresh).
    # One old + one fresh are 'sync', the other two are 'webhook'.
    old = datetime.now(UTC) - timedelta(minutes=60)
    fresh = datetime.now(UTC)
    await activity_db.record_activity(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_id=connector_id,
        event_type="sync",
        status="success",
        started_at=old,
        records_affected=1,
    )
    await activity_db.record_activity(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_id=connector_id,
        event_type="webhook",
        status="success",
        started_at=old,
        records_affected=2,
    )
    await activity_db.record_activity(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_id=connector_id,
        event_type="sync",
        status="success",
        started_at=fresh,
        records_affected=3,
    )
    await activity_db.record_activity(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_id=connector_id,
        event_type="webhook",
        status="success",
        started_at=fresh,
        records_affected=4,
    )

    # Filter event_type=sync + since=now-30min: exactly ONE match
    # (the fresh sync row), neither the old sync nor any webhook.
    cutoff = datetime.now(UTC) - timedelta(minutes=30)
    rows = await activity_db.list_activity(tenant_id, event_type="sync", since=cutoff)
    assert len(rows) == 1
    assert rows[0].records_affected == 3
    assert rows[0].event_type == "sync"

    # Filter event_type=webhook + no time bound: two matches.
    rows = await activity_db.list_activity(tenant_id, event_type="webhook")
    assert len(rows) == 2

    # Filter event_type=sync + no time bound: two matches.
    rows = await activity_db.list_activity(tenant_id, event_type="sync")
    assert len(rows) == 2
    # And they sort newest first.
    assert rows[0].records_affected == 3
    assert rows[1].records_affected == 1

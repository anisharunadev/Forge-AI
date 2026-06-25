"""Tests for ``ConnectorLifecycle`` (Pillar 1 — Phase 4).

Covers:
- ``install`` creates a Connector + runs ``test_connection`` +
  records audit.
- ``rotate`` updates ``Connector.config`` + invalidates MCP
  registration (bus event) + re-tests.
- ``test`` calls ``ConnectorManager.test_connection`` + writes a
  ``ConnectorHealthHistory`` row.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.db.models.audit import AuditEvent
from app.db.models.connector import (
    Connector,
    ConnectorHealthHistory,
    ConnectorStatus,
    ConnectorType,
)
from app.db.session import get_session_factory
from app.services.connector_manager import ConnectorManager, TestResult
from app.services.connectors.lifecycle import ConnectorLifecycle
from app.services.event_bus import EventType


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _StubManager:
    """In-memory ConnectorManager substitute.

    Captures calls so the lifecycle assertions can assert against the
    recorded arguments. Returns ``ok=True`` probe results so the
    health-check history path is exercised.
    """

    def __init__(self) -> None:
        self.created: list[dict] = []
        self.updated: list[dict] = []
        self.tested: list[str] = []
        self._connectors: dict[str, Connector] = {}

    async def create_connector(self, **kw) -> Connector:
        connector = Connector(
            id=uuid.uuid4(),
            tenant_id=str(kw["tenant_id"]),
            project_id=str(kw["project_id"]),
            name=kw["name"],
            type=kw["type"],
            config=dict(kw["config"]),
            status=ConnectorStatus.PENDING,
            created_by=str(kw["actor_id"]),
        )
        self.created.append(kw)
        self._connectors[str(connector.id)] = connector
        return connector

    async def get_connector(self, connector_id, *, tenant_id=None) -> Connector:
        row = self._connectors.get(str(connector_id))
        if row is None:
            raise LookupError(f"Connector {connector_id} not found")
        if tenant_id is not None and str(row.tenant_id) != str(tenant_id):
            raise PermissionError(f"Connector {connector_id} not in tenant {tenant_id}")
        return row

    async def update_connector(self, connector_id, **kw) -> Connector:
        row = self._connectors.get(str(connector_id))
        if row is None:
            raise LookupError(f"Connector {connector_id} not found")
        if "config" in kw and kw["config"] is not None:
            row.config = kw["config"]
        if "name" in kw and kw["name"] is not None:
            row.name = kw["name"]
        self.updated.append({"id": str(connector_id), **kw})
        return row

    async def test_connection(self, connector_id, *, tenant_id=None) -> TestResult:
        self.tested.append(str(connector_id))
        return TestResult(
            connector_id=uuid.UUID(str(connector_id)),
            ok=True,
            latency_ms=1.23,
            detail="reachable",
            checked_at=datetime.now(timezone.utc),
        )


@pytest.fixture
def stub_manager() -> _StubManager:
    return _StubManager()


@pytest.fixture
def lifecycle(stub_manager, event_bus):
    # Use a deterministic bus so the test can assert on published events.
    return ConnectorLifecycle(manager=stub_manager, bus=event_bus)


# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------


async def test_install_creates_connector_runs_probe_and_records_audit(
    sqlite_db, lifecycle, stub_manager, event_bus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    connector = await lifecycle.install(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_type=ConnectorType.JIRA,
        name="forge-jira",
        config={"base_url": "https://x.atlassian.net", "api_token": "tok"},
        actor_id=actor_id,
    )

    assert connector.id is not None
    assert len(stub_manager.created) == 1
    # The lifecycle service probes the freshly-installed connector.
    assert stub_manager.tested == [str(connector.id)]

    # Audit row written.
    factory = get_session_factory()
    async with factory() as session:
        from sqlalchemy import select

        stmt = select(AuditEvent).where(
            AuditEvent.tenant_id == tenant_id,
            AuditEvent.action == "connector.install",
        )
        rows = list((await session.execute(stmt)).scalars().all())
    assert len(rows) == 1
    assert rows[0].target_id == str(connector.id)
    assert rows[0].payload["type"] == "jira"
    assert rows[0].payload["ok"] is True


# ---------------------------------------------------------------------------
# rotate
# ---------------------------------------------------------------------------


async def test_rotate_updates_config_emits_bus_event_and_reprobes(
    sqlite_db, lifecycle, stub_manager, event_bus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    # Seed an existing connector.
    connector = await lifecycle.install(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_type=ConnectorType.JIRA,
        name="forge-jira",
        config={"api_token": "old-token"},
        actor_id=actor_id,
    )

    # Track bus events on the in-memory bus.
    seen: list[tuple[EventType, dict]] = []

    async def _capture(event):
        seen.append((event.event_type, dict(event.payload)))

    event_bus.subscribe(EventType.CONNECTOR_SYNCING, _capture)

    rotated = await lifecycle.rotate(
        connector_id=connector.id,
        new_credentials={"api_token": "new-token"},
        tenant_id=tenant_id,
        actor_id=actor_id,
    )

    # Config merged (old + new keys).
    assert rotated.config.get("api_token") == "new-token"

    # The rotate call updates the connector row.
    assert any(
        update.get("id") == str(connector.id) and update.get("config") is not None
        for update in stub_manager.updated
    )

    # Bus event with event=credentials_rotated fired.
    assert any(
        et == EventType.CONNECTOR_SYNCING and payload.get("event") == "credentials_rotated"
        for et, payload in seen
    )

    # Re-probed: two probes total (install + rotate).
    assert stub_manager.tested.count(str(connector.id)) == 2


# ---------------------------------------------------------------------------
# test
# ---------------------------------------------------------------------------


async def test_test_writes_health_history_row(sqlite_db, lifecycle, stub_manager):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    connector = await lifecycle.install(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_type=ConnectorType.GITHUB,
        name="forge-github",
        config={"token": "ghp_x"},
        actor_id=actor_id,
    )

    # Reset probe counter and run a standalone test.
    stub_manager.tested.clear()
    result = await lifecycle.test(
        connector_id=connector.id,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )

    assert result.ok is True
    assert stub_manager.tested == [str(connector.id)]

    # Health-history row was written.
    factory = get_session_factory()
    async with factory() as session:
        from sqlalchemy import select

        stmt = select(ConnectorHealthHistory).where(
            ConnectorHealthHistory.connector_id == str(connector.id)
        )
        rows = list((await session.execute(stmt)).scalars().all())
    assert len(rows) >= 1
    assert rows[-1].ok is True
    assert str(rows[-1].tenant_id) == tenant_id
    assert str(rows[-1].project_id) == project_id

    # Audit row with action=connector.test.
    async with factory() as session:
        from sqlalchemy import select as _select

        stmt = _select(AuditEvent).where(
            AuditEvent.action == "connector.test",
            AuditEvent.target_id == str(connector.id),
        )
        audit_rows = list((await session.execute(stmt)).scalars().all())
    assert len(audit_rows) == 1

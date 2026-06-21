"""TestConnectorManager — create, list, sync, quarantine, history."""

from __future__ import annotations

import uuid
from typing import AsyncIterator

import pytest

from app.db.models.connector import ConnectorStatus, ConnectorType
from app.services.connector_manager import ConnectorManager


@pytest.fixture
async def mgr(sqlite_db) -> AsyncIterator[ConnectorManager]:
    # Override the bus so we can assert events were published.
    from app.services.event_bus import EventBus

    bus = EventBus(use_redis=False)
    yield ConnectorManager(bus=bus)


async def test_create_connector_emits_event(mgr, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    received: list[tuple[str, dict]] = []

    async def handler(event) -> None:
        received.append((event.event_type.value, event.payload))

    mgr._bus.subscribe_all(handler)

    connector = await mgr.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="primary-github",
        type=ConnectorType.GITHUB,
        config={"token": "ghp_x", "repos": ["forge/forge-ai"]},
        actor_id=actor_id,
    )
    assert connector.id is not None
    assert connector.status == ConnectorStatus.PENDING
    assert str(connector.tenant_id) == tenant_id

    event_types = {r[0] for r in received}
    assert "connector.syncing" in event_types


async def test_list_and_get(mgr, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    a = await mgr.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="gh",
        type=ConnectorType.GITHUB,
        config={},
        actor_id=actor_id,
    )
    b = await mgr.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="jira",
        type=ConnectorType.JIRA,
        config={},
        actor_id=actor_id,
    )

    rows = await mgr.list_connectors(tenant_id, project_id=project_id)
    names = {r.name for r in rows}
    assert {"gh", "jira"}.issubset(names)

    fetched = await mgr.get_connector(a.id)
    assert fetched.id == a.id

    fetched2 = await mgr.get_connector(b.id, tenant_id=tenant_id)
    assert fetched2.id == b.id


async def test_sync_history_and_state_transitions(mgr, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    connector = await mgr.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="slack",
        type=ConnectorType.SLACK,
        config={"bot_token": "x", "default_channel": "#dev"},
        actor_id=actor_id,
    )
    history = await mgr.trigger_sync(connector.id, actor_id=actor_id)
    assert history.items_synced >= 1
    assert history.finished_at is not None

    after = await mgr.get_connector(connector.id)
    assert after.status == ConnectorStatus.HEALTHY
    assert after.last_sync_at is not None

    rows = await mgr.get_sync_history(connector.id, limit=5)
    assert len(rows) >= 1
    assert rows[0].status.value == "success"


async def test_quarantine_is_soft_delete(mgr, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    connector = await mgr.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="figma",
        type=ConnectorType.FIGMA,
        config={"token": "x", "file_keys": []},
        actor_id=actor_id,
    )
    quarantined = await mgr.delete_connector(connector.id, actor_id=actor_id)
    assert quarantined.status == ConnectorStatus.QUARANTINED

    fetched = await mgr.get_connector(connector.id)
    assert fetched.status == ConnectorStatus.QUARANTINED


async def test_test_connection(mgr, sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    connector = await mgr.create_connector(
        tenant_id=tenant_id,
        project_id=project_id,
        name="sonarqube",
        type=ConnectorType.SONARQUBE,
        config={"base_url": "http://localhost", "token": "x"},
        actor_id=actor_id,
    )
    result = await mgr.test_connection(connector.id, tenant_id=tenant_id)
    assert result.connector_id == connector.id
    assert result.ok is True
    assert result.checked_at is not None

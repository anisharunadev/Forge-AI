"""Tests for the TS → Python connector-event bus bridge (Phase 1).

Exercises the FastAPI router at ``POST /api/v1/connector-events/observed``:

- A well-formed envelope with ``jira.issue.observed`` produces a
  Python in-process bus event of type ``CONNECTOR_EVENT_OBSERVED``.
- A well-formed envelope with ``jira.issue.ingested`` produces a
  ``CONNECTOR_EVENT_INGESTED`` event.
- An envelope with an unknown ``event_type`` returns HTTP 400.
- A ``jira.transition.applied`` envelope is re-emitted as
  ``CONNECTOR_EVENT_OBSERVED`` (consumer is the same shape).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.v1.connector_events import router as connector_events_router
from app.services.connector_ingestion.bus_bridge import (
    ALLOWED_EVENT_TYPES,
    publish_connector_event,
)
from app.services.event_bus import EventBus, EventType


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(connector_events_router, prefix="/api/v1")
    return app


@pytest.fixture
async def mem_bus():
    bus = EventBus(use_redis=False)
    yield bus


@pytest.fixture(autouse=True)
def _patch_bus(monkeypatch, mem_bus):
    # The bridge uses the module-level ``default_bus`` singleton; for
    # the in-process test we substitute the in-memory bus.
    from app.services.connector_ingestion import bus_bridge as bridge_mod

    monkeypatch.setattr(bridge_mod, "default_bus", mem_bus)
    yield


async def test_observed_event_publishes_observed(sqlite_db, mem_bus):
    app = _build_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/connector-events/observed",
            json={
                "event_type": "jira.issue.observed",
                "tenant_id": str(uuid.uuid4()),
                "project_id": str(uuid.uuid4()),
                "payload": {
                    "issue": {"key": "FORA-1", "fields": {"summary": "x", "status": "To Do"}}
                },
            },
        )
    assert resp.status_code == 202
    body = resp.json()
    assert body["ok"] is True
    assert body["published_as"] == EventType.CONNECTOR_EVENT_OBSERVED.value
    assert "event_id" in body


async def test_ingested_event_publishes_ingested(sqlite_db, mem_bus):
    app = _build_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/connector-events/observed",
            json={
                "event_type": "jira.issue.ingested",
                "tenant_id": str(uuid.uuid4()),
                "project_id": str(uuid.uuid4()),
                "payload": {"key": "FORA-2"},
            },
        )
    assert resp.status_code == 202
    body = resp.json()
    assert body["published_as"] == EventType.CONNECTOR_EVENT_INGESTED.value


async def test_transition_publishes_observed(sqlite_db, mem_bus):
    app = _build_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/connector-events/observed",
            json={
                "event_type": "jira.transition.applied",
                "tenant_id": str(uuid.uuid4()),
                "project_id": str(uuid.uuid4()),
                "payload": {
                    "issue": {"key": "FORA-3"},
                    "to": {"name": "Done"},
                },
            },
        )
    assert resp.status_code == 202
    body = resp.json()
    assert body["published_as"] == EventType.CONNECTOR_EVENT_OBSERVED.value


async def test_unknown_event_type_rejected(sqlite_db):
    app = _build_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/connector-events/observed",
            json={
                "event_type": "nonsense.event",
                "tenant_id": str(uuid.uuid4()),
                "payload": {},
            },
        )
    assert resp.status_code == 400
    assert "unknown_event_type" in resp.json()["detail"]


async def test_closed_set_matches_plan():
    # Snapshot check: if a new TS event is added, this test catches the
    # bridge falling out of sync.
    assert ALLOWED_EVENT_TYPES == frozenset(
        {
            "jira.issue.observed",
            "jira.transition.applied",
            "jira.issue.ingested",
        }
    )


async def test_publish_helper_emits_event(sqlite_db, mem_bus):
    # Direct call to the bridge service — useful when other modules
    # want to publish without going through HTTP.
    from app.services.connector_ingestion.bus_bridge import ConnectorEventEnvelope

    received: list[Any] = []

    async def _capture(event) -> None:
        received.append(event)

    mem_bus.subscribe(EventType.CONNECTOR_EVENT_OBSERVED, _capture)

    envelope = ConnectorEventEnvelope(
        event_type="jira.issue.observed",
        tenant_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        payload={"issue": {"key": "FORA-7", "fields": {"summary": "x"}}},
    )
    result = await publish_connector_event(envelope)
    assert result["ok"] is True
    assert len(received) == 1
    assert received[0].payload["issue"]["key"] == "FORA-7"

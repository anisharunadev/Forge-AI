"""Tests for ``JiraIngestionService`` (Pillar 1 — Phase 1).

Covers the bidirectional sync half of the Jira bridge:

- A synthetic ``CONNECTOR_EVENT_OBSERVED`` with an issue payload
  upserts an ``Idea`` row keyed by ``external_key``.
- A second publish of the same key is a no-op.
- A ``transition.applied`` payload updates ``Idea.status`` via the
  Jira → IdeaStatus mapping.
- The consumer is wired to the bus ``EventType.CONNECTOR_EVENT_OBSERVED``
  (subscribed in ``__init__``).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models.ideation import Idea, IdeaStatus
from app.db.session import get_session_factory
from app.services.connector_ingestion.jira_consumer import JiraIngestionService
from app.services.event_bus import Event, EventBus, EventType


@pytest.fixture
async def mem_bus():
    bus = EventBus(use_redis=False)
    yield bus


async def _publish_issue_observed(
    bus: EventBus, *, tenant_id: str, project_id: str, key: str, status: str = "To Do"
) -> Event:
    payload = {
        "kind": "issue.observed",
        "issue": {
            "key": key,
            "fields": {
                "summary": f"Issue {key}",
                "description": f"Body for {key}",
                "status": status,
            },
        },
    }
    return await bus.publish(
        EventType.CONNECTOR_EVENT_OBSERVED,
        payload,
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=None,
    )


async def _publish_transition(
    bus: EventBus,
    *,
    tenant_id: str,
    project_id: str,
    key: str,
    to_status: str,
) -> Event:
    payload = {
        "kind": "transition.applied",
        "issue": {"key": key},
        "to": {"name": to_status},
    }
    return await bus.publish(
        EventType.CONNECTOR_EVENT_OBSERVED,
        payload,
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=None,
    )


async def test_observed_event_upserts_idea(sqlite_db, mem_bus):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    consumer = JiraIngestionService(bus=mem_bus)

    await _publish_issue_observed(
        mem_bus, tenant_id=tenant_id, project_id=project_id, key="FORA-1234"
    )

    # Allow in-process handlers to drain (they run synchronously inside
    # ``publish`` but ``_dispatch`` uses ``await`` — there is no actual
    # event loop yield, so a direct DB read is safe).
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Idea).where(Idea.tenant_id == tenant_id, Idea.external_key == "FORA-1234")
        rows = list((await session.execute(stmt)).scalars().all())
        assert len(rows) == 1
        row = rows[0]
        assert row.title == "Issue FORA-1234"
        assert row.status == IdeaStatus.NEW  # "To Do" → NEW
        # Consumer instance retained.
        assert isinstance(consumer, JiraIngestionService)


async def test_republish_is_noop(sqlite_db, mem_bus):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    JiraIngestionService(bus=mem_bus)
    await _publish_issue_observed(
        mem_bus, tenant_id=tenant_id, project_id=project_id, key="FORA-1234"
    )
    await _publish_issue_observed(
        mem_bus, tenant_id=tenant_id, project_id=project_id, key="FORA-1234"
    )
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Idea).where(Idea.tenant_id == tenant_id, Idea.external_key == "FORA-1234")
        rows = list((await session.execute(stmt)).scalars().all())
        assert len(rows) == 1


async def test_transition_event_updates_status(sqlite_db, mem_bus):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    JiraIngestionService(bus=mem_bus)
    await _publish_issue_observed(mem_bus, tenant_id=tenant_id, project_id=project_id, key="FORA-9")
    await _publish_transition(
        mem_bus,
        tenant_id=tenant_id,
        project_id=project_id,
        key="FORA-9",
        to_status="In Progress",
    )
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Idea).where(Idea.tenant_id == tenant_id, Idea.external_key == "FORA-9")
        rows = list((await session.execute(stmt)).scalars().all())
        assert len(rows) == 1
        assert rows[0].status == IdeaStatus.ANALYZING  # "In Progress" → ANALYZING


async def test_transition_done_moves_to_in_roadmap(sqlite_db, mem_bus):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    JiraIngestionService(bus=mem_bus)
    await _publish_issue_observed(
        mem_bus, tenant_id=tenant_id, project_id=project_id, key="FORA-10"
    )
    await _publish_transition(
        mem_bus,
        tenant_id=tenant_id,
        project_id=project_id,
        key="FORA-10",
        to_status="Done",
    )
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Idea).where(Idea.tenant_id == tenant_id, Idea.external_key == "FORA-10")
        row = (await session.execute(stmt)).scalars().first()
        assert row is not None
        assert row.status == IdeaStatus.IN_ROADMAP

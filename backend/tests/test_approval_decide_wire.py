"""Tests for the Phase-2 PM validation wire on ``approval_queue.decide``.

Covers:

1. ``decide(APPROVE)`` publishes ``APPROVAL_GRANTED`` on the bus.
2. ``decide(DENY)`` publishes ``APPROVAL_DENIED`` on the bus.
3. The status transitions are correct (APPROVED / DENIED / REQUEST_CHANGES).
4. The subscriber wires ``JiraCommenter.post`` for PM-role actors.

The subscriber wiring is exercised end-to-end: a real EventBus (in
memory) is used and ``register()`` is called; ``JiraCommenter.post``
is replaced with an AsyncMock so the test doesn't need a Jira
connector or MCP transport.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.db.models.ideation import (
    ApprovalDecision,
    ApprovalItem,
    ApprovalItemStatus,
    ApprovalItemType,
    Idea,
    IdeaSource,
    IdeaStatus,
)
from app.db.session import get_session_factory
from app.services.event_bus import EventBus, EventType
from app.services.ideation.approval_queue import ApprovalQueueService
from app.services.ideation.jira_status_subscribers import register as register_subs


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_idea(sqlite_db, *, tenant_id: str, project_id: str) -> Idea:
    factory = get_session_factory()
    async with factory() as session:
        idea = Idea(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            project_id=project_id,
            title="Improve signup",
            description="Reduce time-to-first-screen.",
            source=IdeaSource.USER,
            status=IdeaStatus.SCORED,
            submitted_by=uuid.uuid4(),
            tags=[],
            attachments=[],
            external_key="FORA-9001",
        )
        session.add(idea)
        await session.commit()
        await session.refresh(idea)
    return idea


async def _seed_approval(
    sqlite_db,
    *,
    tenant_id: str,
    project_id: str,
    idea_id: uuid.UUID,
    actor_id: str,
) -> ApprovalItem:
    factory = get_session_factory()
    async with factory() as session:
        row = ApprovalItem(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            project_id=project_id,
            idea_id=idea_id,
            request_type=ApprovalItemType.ROADMAP,
            payload={"reason": "Initial"},
            status=ApprovalItemStatus.PENDING,
            requested_by=actor_id,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


def _capturing_handler(bus: EventBus) -> list[Any]:
    captured: list[Any] = []

    async def _h(evt: Any) -> None:
        captured.append(evt)

    bus.subscribe_all(_h)
    return captured


# ---------------------------------------------------------------------------
# decide() bus publication
# ---------------------------------------------------------------------------


@pytest.fixture
def fresh_bus():
    """Return an in-memory EventBus (not the global singleton).

    The test then wires the approval service + subscribers onto this
    bus so subscribers and the global module singleton don't bleed
    between tests.
    """
    return EventBus(use_redis=False)


async def test_decide_approve_publishes_approval_granted(
    sqlite_db, fresh_bus: EventBus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)
    approval = await _seed_approval(
        sqlite_db,
        tenant_id=tenant_id,
        project_id=project_id,
        idea_id=idea.id,
        actor_id=actor_id,
    )

    captured = _capturing_handler(fresh_bus)
    svc = ApprovalQueueService(bus=fresh_bus)

    decided = await svc.decide(
        approval.id,
        ApprovalDecision.APPROVE,
        reason="LGTM",
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert decided.status == ApprovalItemStatus.APPROVED

    granted = [e for e in captured if e.event_type == EventType.APPROVAL_GRANTED]
    assert len(granted) == 1
    evt = granted[0]
    assert evt.payload["approval_id"] == str(approval.id)
    assert evt.payload["decision"] == "approve"
    assert evt.tenant_id == tenant_id


async def test_decide_deny_publishes_approval_denied(
    sqlite_db, fresh_bus: EventBus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)
    approval = await _seed_approval(
        sqlite_db,
        tenant_id=tenant_id,
        project_id=project_id,
        idea_id=idea.id,
        actor_id=actor_id,
    )

    captured = _capturing_handler(fresh_bus)
    svc = ApprovalQueueService(bus=fresh_bus)

    decided = await svc.decide(
        approval.id,
        ApprovalDecision.DENY,
        reason="Out of scope",
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert decided.status == ApprovalItemStatus.DENIED

    denied = [e for e in captured if e.event_type == EventType.APPROVAL_DENIED]
    assert len(denied) == 1


async def test_decide_request_changes_publishes_artifact_updated(
    sqlite_db, fresh_bus: EventBus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)
    approval = await _seed_approval(
        sqlite_db,
        tenant_id=tenant_id,
        project_id=project_id,
        idea_id=idea.id,
        actor_id=actor_id,
    )

    captured = _capturing_handler(fresh_bus)
    svc = ApprovalQueueService(bus=fresh_bus)

    decided = await svc.decide(
        approval.id,
        ApprovalDecision.REQUEST_CHANGES,
        reason="Need more rigor.",
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert decided.status == ApprovalItemStatus.REQUEST_CHANGES

    # REQUEST_CHANGES emits ARTIFACT_UPDATED (no Jira comment path).
    artifacts = [e for e in captured if e.event_type == EventType.ARTIFACT_UPDATED]
    assert len(artifacts) == 1


# ---------------------------------------------------------------------------
# Subscriber wires JiraCommenter.post
# ---------------------------------------------------------------------------


async def test_subscriber_invokes_jira_commenter_for_approval_granted(
    sqlite_db, fresh_bus: EventBus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)
    approval = await _seed_approval(
        sqlite_db,
        tenant_id=tenant_id,
        project_id=project_id,
        idea_id=idea.id,
        actor_id=actor_id,
    )

    # Wire subscribers onto the fresh bus.
    register_subs(fresh_bus)

    import asyncio

    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        svc = ApprovalQueueService(bus=fresh_bus)
        await svc.decide(
            approval.id,
            ApprovalDecision.APPROVE,
            reason="Ship it",
            tenant_id=tenant_id,
            actor_id=actor_id,
        )
        # Allow the asyncio.create_task coroutine to run. We loop a
        # few times because the task awaits the bus dispatch AND the
        # mocked commenter's AsyncMock await.
        for _ in range(20):
            if mock_post.await_count >= 1:
                break
            await asyncio.sleep(0.05)

        assert mock_post.await_count >= 1
        # Find the call matching our approval grant.
        matched = [
            c for c in mock_post.await_args_list
            if c.kwargs.get("stage") == "approval" and c.kwargs.get("outcome") == "granted"
        ]
        assert matched, "expected an approval/granted post call"
        call = matched[0]
        assert call.kwargs["issue_key"] == "FORA-9001"
        assert str(call.kwargs["actor_id"]) == actor_id
        assert str(call.kwargs["tenant_id"]) == tenant_id
        assert str(call.kwargs["project_id"]) == project_id


async def test_subscriber_invokes_jira_commenter_for_approval_denied(
    sqlite_db, fresh_bus: EventBus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(sqlite_db, tenant_id=tenant_id, project_id=project_id)
    approval = await _seed_approval(
        sqlite_db,
        tenant_id=tenant_id,
        project_id=project_id,
        idea_id=idea.id,
        actor_id=actor_id,
    )

    register_subs(fresh_bus)

    import asyncio

    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        svc = ApprovalQueueService(bus=fresh_bus)
        await svc.decide(
            approval.id,
            ApprovalDecision.DENY,
            reason="Nope",
            tenant_id=tenant_id,
            actor_id=actor_id,
        )
        for _ in range(20):
            if mock_post.await_count >= 1:
                break
            await asyncio.sleep(0.05)

        matched = [
            c for c in mock_post.await_args_list
            if c.kwargs.get("stage") == "approval" and c.kwargs.get("outcome") == "denied"
        ]
        assert matched, "expected an approval/denied post call"

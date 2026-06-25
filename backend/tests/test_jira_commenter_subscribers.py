"""Tests for ``jira_status_subscribers`` (Pillar 1 — Phase 2).

Covers the wiring between the event bus and ``JiraCommenter.post``:

- ``APPROVAL_GRANTED`` → ``stage="approval"``, ``outcome="granted"``.
- ``APPROVAL_DENIED``  → ``stage="approval"``, ``outcome="denied"``.
- ``AGENT_RUN_COMPLETED`` (``status="done"``) → ``stage="sdlc"``, ``outcome="done"``.
- ``ARTIFACT_UPDATED`` (``outcome="validator_pass"``) → ``stage="validator"``, ``outcome="pass"``.
- ``ARTIFACT_UPDATED`` (``outcome="validator_fail"``) → ``stage="validator"``, ``outcome="fail"``.

Each test publishes an event on a fresh ``EventBus`` (no Redis),
subscribes via ``register(...)``, and asserts on a mocked
``JiraCommenter.post``.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.services.event_bus import EventBus, EventType
from app.services.ideation.jira_status_subscribers import register as register_subs


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _wait_for_tasks() -> None:
    """Yield to the loop so ``asyncio.create_task`` coroutines run.

    The subscribers fire-and-forget via ``asyncio.create_task`` so the
    test must give the loop a chance to schedule them. Two sleeps is
    enough for a single-level fan-out; we don't await all tasks because
    the task list is a module-level set we don't expose.
    """
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(asyncio.sleep(0))
    finally:
        loop.close()


async def _drain() -> None:
    # Two ticks is enough — the dispatcher uses asyncio.create_task
    # with no further awaits beyond the commenter's own RPC.
    await asyncio.sleep(0)
    await asyncio.sleep(0)


# ---------------------------------------------------------------------------
# Approval flows
# ---------------------------------------------------------------------------


async def test_approval_granted_subscriber_posts_approval_granted():
    bus = EventBus(use_redis=False)
    register_subs(bus)
    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        tenant_id = str(uuid.uuid4())
        project_id = str(uuid.uuid4())
        actor_id = str(uuid.uuid4())
        await bus.publish(
            EventType.APPROVAL_GRANTED,
            {
                "domain": "ideation",
                "approval_id": str(uuid.uuid4()),
                "decision": "approve",
                "external_key": "FORA-100",
                "idea_id": str(uuid.uuid4()),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        await _drain()

    matched = [
        c for c in mock_post.await_args_list
        if c.kwargs.get("stage") == "approval"
        and c.kwargs.get("outcome") == "granted"
    ]
    assert matched, "expected approval/granted post"
    call = matched[0]
    assert call.kwargs["issue_key"] == "FORA-100"
    assert call.kwargs["actor_id"] == actor_id
    assert call.kwargs["tenant_id"] == tenant_id


async def test_approval_denied_subscriber_posts_approval_denied():
    bus = EventBus(use_redis=False)
    register_subs(bus)
    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        tenant_id = str(uuid.uuid4())
        project_id = str(uuid.uuid4())
        await bus.publish(
            EventType.APPROVAL_DENIED,
            {
                "domain": "ideation",
                "approval_id": str(uuid.uuid4()),
                "decision": "deny",
                "external_key": "FORA-200",
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=str(uuid.uuid4()),
        )
        await _drain()

    matched = [
        c for c in mock_post.await_args_list
        if c.kwargs.get("stage") == "approval" and c.kwargs.get("outcome") == "denied"
    ]
    assert matched, "expected approval/denied post"


# ---------------------------------------------------------------------------
# SDLC run completion
# ---------------------------------------------------------------------------


async def test_agent_run_completed_done_posts_sdlc_done():
    bus = EventBus(use_redis=False)
    register_subs(bus)
    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        tenant_id = str(uuid.uuid4())
        project_id = str(uuid.uuid4())
        await bus.publish(
            EventType.AGENT_RUN_COMPLETED,
            {
                "domain": "sdlc_agent",
                "kind": "run_completed",
                "status": "done",
                "run_id": "run-1",
                "external_key": "FORA-300",
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=str(uuid.uuid4()),
        )
        await _drain()

    matched = [
        c for c in mock_post.await_args_list
        if c.kwargs.get("stage") == "sdlc" and c.kwargs.get("outcome") == "done"
    ]
    assert matched, "expected sdlc/done post"
    call = matched[0]
    assert call.kwargs["issue_key"] == "FORA-300"
    assert call.kwargs["forge_run_id"] == "run-1"


async def test_agent_run_completed_failed_does_not_post():
    """status != 'done' is filtered out so cancelled runs don't post."""
    bus = EventBus(use_redis=False)
    register_subs(bus)
    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        await bus.publish(
            EventType.AGENT_RUN_COMPLETED,
            {
                "domain": "sdlc_agent",
                "status": "failed",
                "run_id": "run-2",
                "external_key": "FORA-301",
            },
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            actor_id=str(uuid.uuid4()),
        )
        await _drain()

    sdlc_calls = [
        c for c in mock_post.await_args_list if c.kwargs.get("stage") == "sdlc"
    ]
    assert sdlc_calls == []


# ---------------------------------------------------------------------------
# Code validator
# ---------------------------------------------------------------------------


async def test_artifact_updated_validator_pass_posts_validator_pass():
    bus = EventBus(use_redis=False)
    register_subs(bus)
    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        await bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "code_validator",
                "kind": "validation_report",
                "outcome": "validator_pass",
                "run_id": "vrun-1",
                "external_key": "FORA-400",
            },
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            actor_id=str(uuid.uuid4()),
        )
        await _drain()

    matched = [
        c for c in mock_post.await_args_list
        if c.kwargs.get("stage") == "validator" and c.kwargs.get("outcome") == "pass"
    ]
    assert matched, "expected validator/pass post"


async def test_artifact_updated_validator_fail_posts_validator_fail():
    bus = EventBus(use_redis=False)
    register_subs(bus)
    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        await bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "code_validator",
                "kind": "validation_report",
                "outcome": "validator_fail",
                "run_id": "vrun-2",
                "external_key": "FORA-500",
            },
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            actor_id=str(uuid.uuid4()),
        )
        await _drain()

    matched = [
        c for c in mock_post.await_args_list
        if c.kwargs.get("stage") == "validator" and c.kwargs.get("outcome") == "fail"
    ]
    assert matched, "expected validator/fail post"


async def test_artifact_updated_unrelated_outcome_is_ignored():
    bus = EventBus(use_redis=False)
    register_subs(bus)
    with patch(
        "app.services.ideation.jira_status_subscribers._commenter.post",
        AsyncMock(return_value=True),
    ) as mock_post:
        await bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "approval_item",
                "approval_id": str(uuid.uuid4()),
                "assigned_to": str(uuid.uuid4()),
                "external_key": "FORA-600",
            },
            tenant_id=str(uuid.uuid4()),
            project_id=str(uuid.uuid4()),
            actor_id=str(uuid.uuid4()),
        )
        await _drain()

    # The unrelated ARTIFACT_UPDATED should not produce a validator post.
    validator_calls = [
        c for c in mock_post.await_args_list if c.kwargs.get("stage") == "validator"
    ]
    assert validator_calls == []

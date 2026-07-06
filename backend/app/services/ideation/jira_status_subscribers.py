"""Jira status comment subscribers (Pillar 1 — Phase 2).

Wires the existing Phase-1 :class:`~app.services.connector_ingestion.jira_commenter.JiraCommenter`
to the event bus so status updates post back to Jira automatically.

Why via the bus (not direct calls)?
-----------------------------------
The approval / validator / SDLC flows must NOT block on MCP latency.
``bus.subscribe(...)`` dispatches synchronously; this module therefore
wraps each handler in ``asyncio.create_task`` so the bus dispatch is
non-blocking and a slow Jira MCP call cannot stall the rest of the
system. Handler exceptions are caught and logged so a misbehaving
Jira connector never breaks the originating workflow.

What we subscribe to
--------------------
1. ``EventType.APPROVAL_GRANTED`` → ``stage="approval"``, ``outcome="granted"``.
2. ``EventType.APPROVAL_DENIED``  → ``stage="approval"``, ``outcome="denied"``.
3. ``EventType.AGENT_RUN_COMPLETED`` (payload ``status == "done"``)
   → ``stage="sdlc"``, ``outcome="done"``.
4. ``EventType.ARTIFACT_UPDATED`` (payload ``outcome in {"validator_pass", "validator_fail"}``)
   → ``stage="validator"``, ``outcome = pass | fail``.

Lifecycle
---------
The :func:`register` function is called from
``app.main.lifespan`` after the bus is started. Subscribers are
attached to the global ``bus`` singleton, so they survive across
requests for the life of the process.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.db.models.ideation import Idea
from app.db.session import get_session_factory
from app.services.connector_ingestion.jira_commenter import JiraCommenter
from app.services.event_bus import Event, EventBus, EventType
from app.services.event_bus import bus as default_bus

logger = get_logger(__name__)


# Module-level commenter — single shared instance is fine because
# ``JiraCommenter`` only holds an ``MCPClient`` reference and the
# underlying MCP client is async-safe.
_commenter = JiraCommenter()


# ---------------------------------------------------------------------------
# Issue-key resolution
# ---------------------------------------------------------------------------


async def _resolve_issue_key(
    *,
    tenant_id: UUID | str,
    idea_id: UUID | str | None,
    external_key: str | None,
    approval_id: UUID | str | None = None,
) -> str | None:
    """Return the Jira issue key to comment on, or None.

    Priority order:
    1. ``external_key`` from the event payload (cheapest path).
    2. Look up ``Idea.external_key`` by ``idea_id`` from payload.
    3. Look up ``ApprovalItem.idea_id`` by ``approval_id`` from payload,
       then ``Idea.external_key`` by that ``idea_id``.

    Returns ``None`` when none of the lookups yields a key — the
    caller then skips the comment (matches ``JiraCommenter.post``
    behavior for missing keys).
    """
    if external_key:
        return str(external_key)
    if idea_id is None and approval_id is not None:
        idea_id = await _resolve_idea_id_from_approval(tenant_id=tenant_id, approval_id=approval_id)
    if idea_id is None:
        return None
    factory = get_session_factory()
    async with factory() as session:
        idea = await session.get(Idea, str(idea_id))
        if idea is None:
            return None
        return idea.external_key


async def _resolve_idea_id_from_approval(
    *, tenant_id: UUID | str, approval_id: UUID | str
) -> UUID | str | None:
    """Map ``ApprovalItem.id`` → ``ApprovalItem.idea_id``.

    Used when the bus event carries only ``approval_id`` (the
    approval_queue service does NOT include ``idea_id`` in the
    payload, so the subscriber must bridge). Tenant-scoped lookup so
    a forged cross-tenant approval_id cannot leak the idea.
    """
    from sqlalchemy import select

    from app.db.models.ideation import ApprovalItem

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(ApprovalItem).where(
            ApprovalItem.tenant_id == str(tenant_id),
            ApprovalItem.id == str(approval_id),
        )
        row = (await session.execute(stmt)).scalars().first()
        if row is None:
            return None
        return row.idea_id


# ---------------------------------------------------------------------------
# Approval handlers
# ---------------------------------------------------------------------------


async def _comment_on_approval(event: Event, outcome: str) -> None:
    """Post an approval-stage comment. ``outcome`` is ``"granted" | "denied"``."""
    payload = event.payload or {}
    issue_key = await _resolve_issue_key(
        tenant_id=event.tenant_id,
        idea_id=payload.get("idea_id"),
        external_key=payload.get("external_key"),
        approval_id=payload.get("approval_id"),
    )
    if not issue_key:
        logger.info(
            "jira_status.no_issue_key",
            event_type=event.event_type.value,
            outcome=outcome,
            approval_id=payload.get("approval_id"),
        )
        return

    try:
        await _commenter.post(
            issue_key=issue_key,
            stage="approval",
            outcome=outcome,
            actor_id=event.actor_id or "system",
            report_link=payload.get("report_link"),
            tenant_id=event.tenant_id,
            project_id=event.project_id,
            forge_run_id=payload.get("approval_id"),
        )
    except Exception as exc:  # noqa: BLE001 — never break the originating flow
        logger.warning(
            "jira_status.approval_comment_failed",
            issue_key=issue_key,
            outcome=outcome,
            error=str(exc),
        )


# ---------------------------------------------------------------------------
# SDLC agent completion handler
# ---------------------------------------------------------------------------


async def _comment_on_run_complete(event: Event) -> None:
    """Post an sdlc-stage comment when a run finishes successfully."""
    payload = event.payload or {}
    if (payload.get("status") or "").lower() != "done":
        # Failed/cancelled runs intentionally don't post a "done" comment —
        # callers can subscribe separately if that becomes useful.
        return
    issue_key = await _resolve_issue_key(
        tenant_id=event.tenant_id,
        idea_id=payload.get("idea_id"),
        external_key=payload.get("external_key"),
    )
    if not issue_key:
        logger.info(
            "jira_status.no_issue_key",
            event_type=event.event_type.value,
            outcome="done",
            run_id=payload.get("run_id"),
        )
        return

    try:
        await _commenter.post(
            issue_key=issue_key,
            stage="sdlc",
            outcome="done",
            actor_id=event.actor_id or "system",
            report_link=payload.get("report_link"),
            tenant_id=event.tenant_id,
            project_id=event.project_id,
            forge_run_id=payload.get("run_id"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "jira_status.sdlc_comment_failed",
            issue_key=issue_key,
            error=str(exc),
        )


# ---------------------------------------------------------------------------
# Code-validator handler
# ---------------------------------------------------------------------------


_OUTCOME_TO_STAGE_OUTCOME: dict[str, tuple[str, str]] = {
    "validator_pass": ("validator", "pass"),
    "validator_fail": ("validator", "fail"),
}


async def _comment_on_validator(event: Event) -> None:
    """Post a validator-stage comment on PASS / FAIL."""
    payload = event.payload or {}
    raw_outcome = payload.get("outcome")
    if not raw_outcome:
        return
    mapped = _OUTCOME_TO_STAGE_OUTCOME.get(str(raw_outcome))
    if mapped is None:
        return
    stage, outcome = mapped

    issue_key = await _resolve_issue_key(
        tenant_id=event.tenant_id,
        idea_id=payload.get("idea_id"),
        external_key=payload.get("external_key"),
    )
    if not issue_key:
        logger.info(
            "jira_status.no_issue_key",
            event_type=event.event_type.value,
            outcome=outcome,
        )
        return

    try:
        await _commenter.post(
            issue_key=issue_key,
            stage=stage,
            outcome=outcome,
            actor_id=event.actor_id or "system",
            report_link=payload.get("report_link"),
            tenant_id=event.tenant_id,
            project_id=event.project_id,
            forge_run_id=payload.get("run_id"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "jira_status.validator_comment_failed",
            issue_key=issue_key,
            outcome=outcome,
            error=str(exc),
        )


# ---------------------------------------------------------------------------
# Subscriber factories — wrap each handler in asyncio.create_task
# ---------------------------------------------------------------------------


def _fire(coro: Any) -> asyncio.Task[Any] | None:
    """Schedule a coroutine on the running loop without blocking the bus.

    Returns the Task (so tests can await it) or None when there is no
    running loop. Exceptions inside ``coro`` are swallowed by the per-
    handler try/except so the bus never sees a failure. We hold a
    strong reference to the task via ``_background_tasks`` to avoid GC
    mid-flight.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    task = loop.create_task(coro)
    task.add_done_callback(_log_task_exception)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


_background_tasks: set[asyncio.Task[Any]] = set()


def _log_task_exception(task: asyncio.Task[Any]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.warning("jira_status.task_failed", error=str(exc))


async def _approval_granted(event: Event) -> None:
    await _comment_on_approval(event, "granted")


async def _approval_denied(event: Event) -> None:
    await _comment_on_approval(event, "denied")


async def _approval_granted_dispatch(event: Event) -> None:
    """Schedule the comment without blocking the bus dispatch.

    We return immediately so the event_bus._dispatch loop doesn't
    wait on Jira MCP latency. The Task reference is held in the
    module-level set so it isn't garbage-collected mid-flight.
    """
    _fire(_approval_granted(event))


async def _approval_denied_dispatch(event: Event) -> None:
    _fire(_approval_denied(event))


async def _run_complete_dispatch(event: Event) -> None:
    _fire(_comment_on_run_complete(event))


async def _validator_dispatch(event: Event) -> None:
    _fire(_comment_on_validator(event))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def register(bus: EventBus | None = None) -> None:
    """Attach the Jira-comment subscribers to the bus.

    Idempotent: calling more than once adds duplicate handlers and
    produces duplicate comments; ``app.main.lifespan`` calls this
    exactly once per process.
    """
    target = bus or default_bus
    target.subscribe(EventType.APPROVAL_GRANTED, _approval_granted_dispatch)
    target.subscribe(EventType.APPROVAL_DENIED, _approval_denied_dispatch)
    target.subscribe(EventType.AGENT_RUN_COMPLETED, _run_complete_dispatch)
    target.subscribe(EventType.ARTIFACT_UPDATED, _validator_dispatch)
    logger.info("jira_status.subscribers_registered")


__all__ = ["register"]

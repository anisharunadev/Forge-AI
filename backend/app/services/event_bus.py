"""Typed event bus (DL-027, M1 Substrate).

Every domain event flows through here. All events carry tenant_id +
project_id (Rule 2) and conform to a single schema:

    {event_id, event_type, occurred_at, tenant_id, project_id,
     actor_id, payload}

The bus is backed by Redis Pub/Sub in production, with an in-memory
fallback used by tests so the substrate can be exercised without a
running Redis.
"""

from __future__ import annotations

import asyncio
import enum
import json
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

try:
    import redis.asyncio as aioredis
except ImportError:  # pragma: no cover — redis is required at runtime
    aioredis = None  # type: ignore[assignment]

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EventType(enum.StrEnum):
    """Closed set of domain event types (DL-027).

    Adding a new event type? Add a Python enum member here FIRST, then
    update subscribers. The closed-set guard is what makes the bus
    'typed' rather than a string blob.
    """

    ARTIFACT_CREATED = "artifact.created"
    ARTIFACT_UPDATED = "artifact.updated"
    ARTIFACT_SUPERSEDED = "artifact.superseded"

    CONNECTOR_SYNCING = "connector.syncing"
    CONNECTOR_HEALTHY = "connector.healthy"
    CONNECTOR_STALE = "connector.stale"
    CONNECTOR_FAILED = "connector.failed"

    AGENT_RUN_STARTED = "agent.run.started"
    AGENT_RUN_COMPLETED = "agent.run.completed"
    AGENT_RUN_FAILED = "agent.run.failed"

    # F-301 / M6-G1 — Run-replay events. Emitted by
    # :meth:`SDLCRunManager.replay_run` whenever an operator replays
    # an existing run with the same goal/project/budget. Subscribers
    # (audit sink, run-dashboard WS feed) listen on this event so
    # the UI can render "Replayed from <src_run_id>" lineage.
    RUN_REPLAYED = "run.replayed"

    TERMINAL_COMMAND_EXECUTED = "terminal.command.executed"
    TERMINAL_SESSION_STARTED = "terminal.session.started"
    TERMINAL_SESSION_CLOSED = "terminal.session.closed"

    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_GRANTED = "approval.granted"
    APPROVAL_DENIED = "approval.denied"
    # M2 T-A7 — PITFALL-6 closure (Plan 01-04).  Emitted by the
    # approval-timeout scheduler job when an ApprovalRequest's
    # ``requested_at + timeout_hours`` has passed without a recorded
    # decision.  Subscribers (audit sink, run-dashboard WS feed)
    # listen on this event in addition to APPROVAL_DENIED so the
    # operator-facing 'Stale approval' badge can distinguish
    # 'human said no' from 'human never said anything'.
    APPROVAL_EXPIRED = "approval.expired"

    COST_INCURRED = "cost.incurred"
    POLICY_EVALUATED = "policy.evaluated"

    # F-829 — LiteLLM Integration Layer events
    LITELLM_KEY_MINTED = "litellm.key.minted"
    LITELLM_BUDGET_DECLARED = "litellm.budget.declared"
    LITELLM_CALL_COMPLETED = "litellm.call.completed"
    # F-829i — Guardrail violation ingest (Phase C compliance feed)
    COMPLIANCE_VIOLATION = "compliance.violation"

    # step-77 Phase 2 — Safety & Tooling (per docs/goals/step-77.md).
    # Each of the 5 features gets a slice of the ``LITELLM_<DOMAIN>_<VERB>``
    # namespace so subscribers can filter on the prefix. Verbs follow the
    # closed set: created, updated, archived, applied, blocked, masked,
    # redacted, invoked, registered, unregistered, refreshed, expired,
    # resolved, compared, status_changed, injected, dispatched, called,
    # max_iterations, auth_*. Naming stays lowercase.dot to match the
    # existing LITELLM_* convention (see lines 70-72).
    LITELLM_GUARDRAIL_REGISTERED = "litellm.guardrail.registered"
    LITELLM_GUARDRAIL_UPDATED = "litellm.guardrail.updated"
    LITELLM_GUARDRAIL_DELETED = "litellm.guardrail.deleted"
    LITELLM_GUARDRAIL_APPLIED = "litellm.guardrail.applied"
    LITELLM_GUARDRAIL_BLOCKED = "litellm.guardrail.blocked"
    LITELLM_GUARDRAIL_MASKED = "litellm.guardrail.masked"
    LITELLM_GUARDRAIL_REDACTED = "litellm.guardrail.redacted"

    LITELLM_POLICY_CREATED = "litellm.policy.created"
    LITELLM_POLICY_UPDATED = "litellm.policy.updated"
    LITELLM_POLICY_ARCHIVED = "litellm.policy.archived"
    LITELLM_POLICY_STATUS_CHANGED = "litellm.policy.status_changed"
    LITELLM_POLICY_RESOLVED = "litellm.policy.resolved"
    LITELLM_POLICY_COMPARED = "litellm.policy.compared"

    LITELLM_SKILL_CREATED = "litellm.skill.created"
    LITELLM_SKILL_UPDATED = "litellm.skill.updated"
    LITELLM_SKILL_ARCHIVED = "litellm.skill.archived"
    LITELLM_SKILL_INJECTED = "litellm.skill.injected"

    LITELLM_MCP_SERVER_REGISTERED = "litellm.mcp.server_registered"
    LITELLM_MCP_SERVER_UNREGISTERED = "litellm.mcp.server_unregistered"
    LITELLM_MCP_AUTH_REFRESHED = "litellm.mcp.auth_refreshed"
    LITELLM_MCP_AUTH_EXPIRED = "litellm.mcp.auth_expired"
    LITELLM_MCP_TOOL_CALLED = "litellm.mcp.tool_called"
    LITELLM_MCP_TOOL_DISPATCHED = "litellm.mcp.tool_dispatched"

    LITELLM_TOOL_INVOKED = "litellm.tool.invoked"
    LITELLM_TOOL_OVERRIDDEN = "litellm.tool.overridden"
    LITELLM_TOOL_ARCHIVED = "litellm.tool.archived"

    LITELLM_CHAT_MAX_ITERATIONS = "litellm.chat.max_iterations"

    # F-800 — Co-pilot domain events (Plan 1). Only the events that
    # require in-process or cross-process fanout live here; the rest of
    # the audit trail is captured as ``audit_events`` rows by
    # :func:`audit_service.record`.
    COPILOT_CONVERSATION_CREATED = "copilot.conversation.created"
    COPILOT_MESSAGE_RECORDED = "copilot.message.recorded"
    COPILOT_TOOL_EXECUTED = "copilot.tool.executed"
    COPILOT_COST_INCURRED = "copilot.cost.incurred"
    COPILOT_BUDGET_BLOCKED = "copilot.budget.blocked"

    # F-503 / F-829 — Workflow executor + lifecycle events. These flow
    # through the bus during run execution and feed the SSE run-events
    # stream (`/api/v1/workflows/runs/{run_id}/events`).
    WORKFLOW_CREATED = "workflow.created"
    WORKFLOW_UPDATED = "workflow.updated"
    WORKFLOW_DELETED = "workflow.deleted"
    WORKFLOW_RUN_STARTED = "workflow.run.started"
    WORKFLOW_STEP_STARTED = "workflow.step.started"
    WORKFLOW_STEP_COMPLETED = "workflow.step.completed"
    WORKFLOW_STEP_FAILED = "workflow.step.failed"
    WORKFLOW_RUN_PAUSED = "workflow.run.paused"
    WORKFLOW_RUN_RESUMED = "workflow.run.resumed"
    WORKFLOW_RUN_COMPLETED = "workflow.run.completed"
    WORKFLOW_RUN_FAILED = "workflow.run.failed"
    WORKFLOW_RUN_CANCELLED = "workflow.run.cancelled"

    # F-002-LESSON — Signals that surface a LessonCandidate (Step-64
    # Sub-step B). These flow into ``LessonService`` which decides
    # whether to mint a candidate row (or merely log it to audit).
    RUN_ROLLOBACK = "run.rollback"
    DEPLOYMENT_REVERTED = "deployment.reverted"
    METRIC_DEGRADED = "metric.degraded"
    RUN_BAD_OUTCOME = "run.bad_outcome"

    # F-507 / M9-G2 — emitted after Day-One Bootstrap completes and the
    # sample seed (1 connector + 1 ADR + 1 idea) has been loaded into the
    # freshly-onboarded tenant/project so the dashboard isn't empty.
    BOOTSTRAP_SAMPLE_DATA_LOADED = "bootstrap.sample_data_loaded"


@dataclass
class Event:
    """The canonical event shape (Rule 2 — tenant + project always present)."""

    event_type: EventType
    tenant_id: UUID | str
    project_id: UUID | str | None
    payload: dict[str, Any]
    actor_id: UUID | str | None = None
    event_id: UUID = field(default_factory=uuid.uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["event_type"] = self.event_type.value
        d["event_id"] = str(self.event_id)
        d["tenant_id"] = str(self.tenant_id)
        if self.project_id is not None:
            d["project_id"] = str(self.project_id)
        d["actor_id"] = str(self.actor_id) if self.actor_id else None
        d["occurred_at"] = self.occurred_at.isoformat()
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str)


Handler = Callable[[Event], Awaitable[None]]


class EventBus:
    """Async pub/sub.

    In-memory mode (`use_redis=False`) is used by tests; production
    uses Redis Pub/Sub with one channel per event type so subscribers
    can filter without parsing every payload.
    """

    def __init__(self, use_redis: bool = True) -> None:
        self._use_redis = use_redis and aioredis is not None
        self._redis: aioredis.Redis | None = None
        self._typed_handlers: dict[EventType, list[Handler]] = defaultdict(list)
        self._all_handlers: list[Handler] = []
        self._tasks: list[asyncio.Task[None]] = []
        self._started = False

    async def start(self) -> None:
        """Open the Redis subscription loop. Idempotent."""
        if self._started:
            return
        if self._use_redis:
            self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)
            for et in EventType:
                task = asyncio.create_task(self._redis_loop(et))
                self._tasks.append(task)
        self._started = True
        logger.info("event_bus.started", backend="redis" if self._use_redis else "memory")

    async def stop(self) -> None:
        """Cancel background tasks and close Redis."""
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._tasks.clear()
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None
        self._started = False

    def subscribe(self, event_type: EventType, handler: Handler) -> None:
        """Register a handler for a specific event type."""
        self._typed_handlers[event_type].append(handler)

    def subscribe_all(self, handler: Handler) -> None:
        """Register a handler that sees every event."""
        self._all_handlers.append(handler)

    async def publish(
        self,
        event_type: EventType,
        payload: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None = None,
    ) -> Event:
        """Publish an event.

        Validates that tenant_id is set (Rule 2) and dispatches to
        in-process handlers synchronously, then fans out via Redis
        for cross-process subscribers.
        """
        if tenant_id is None or tenant_id == "":
            raise ValueError("EventBus.publish requires tenant_id (Rule 2)")
        event = Event(
            event_type=event_type,
            tenant_id=tenant_id,
            project_id=project_id,
            payload=payload,
            actor_id=actor_id,
        )
        await self._dispatch(event)
        if self._use_redis and self._redis is not None:
            channel = settings.redis_event_channel_prefix + event_type.value
            await self._redis.publish(channel, event.to_json())
        return event

    async def _dispatch(self, event: Event) -> None:
        """Fan out to in-process handlers."""
        handlers: Iterable[Handler] = list(self._typed_handlers.get(event.event_type, []))
        handlers = list(handlers) + list(self._all_handlers)
        for h in handlers:
            try:
                await h(event)
            except Exception as exc:  # noqa: BLE001 — handler errors must not break the bus
                logger.error(
                    "event_bus.handler_error",
                    event_type=event.event_type.value,
                    handler=getattr(h, "__name__", repr(h)),
                    error=str(exc),
                )

    async def _redis_loop(self, event_type: EventType) -> None:
        """Background task: subscribe to one Redis channel and dispatch."""
        assert self._redis is not None
        pubsub = self._redis.pubsub()
        channel = settings.redis_event_channel_prefix + event_type.value
        await pubsub.subscribe(channel)
        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                    evt = Event(
                        event_type=EventType(data["event_type"]),
                        tenant_id=data["tenant_id"],
                        project_id=data.get("project_id"),
                        payload=data.get("payload", {}),
                        actor_id=data.get("actor_id"),
                        event_id=UUID(data["event_id"]),
                        occurred_at=datetime.fromisoformat(data["occurred_at"]),
                    )
                    await self._dispatch(evt)
                except Exception as exc:  # noqa: BLE001
                    logger.error("event_bus.deserialize_error", error=str(exc))
        except asyncio.CancelledError:  # graceful shutdown
            pass
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()


# Module-level singleton — wired by app.main lifespan.
bus = EventBus()


__all__ = ["Event", "EventBus", "EventType", "bus"]

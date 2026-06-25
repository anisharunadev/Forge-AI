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
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Iterable
from uuid import UUID

try:
    import redis.asyncio as aioredis
except ImportError:  # pragma: no cover — redis is required at runtime
    aioredis = None  # type: ignore[assignment]

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EventType(str, enum.Enum):
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

    TERMINAL_COMMAND_EXECUTED = "terminal.command.executed"
    TERMINAL_SESSION_STARTED = "terminal.session.started"
    TERMINAL_SESSION_CLOSED = "terminal.session.closed"

    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_GRANTED = "approval.granted"
    APPROVAL_DENIED = "approval.denied"

    COST_INCURRED = "cost.incurred"
    POLICY_EVALUATED = "policy.evaluated"

    # F-829 — LiteLLM Integration Layer events
    LITELLM_KEY_MINTED = "litellm.key.minted"
    LITELLM_BUDGET_DECLARED = "litellm.budget.declared"
    LITELLM_CALL_COMPLETED = "litellm.call.completed"
    # F-829i — Guardrail violation ingest (Phase C compliance feed)
    COMPLIANCE_VIOLATION = "compliance.violation"

    # F-800 — Co-pilot domain events (Plan 1). Only the events that
    # require in-process or cross-process fanout live here; the rest of
    # the audit trail is captured as ``audit_events`` rows by
    # :func:`audit_service.record`.
    COPILOT_CONVERSATION_CREATED = "copilot.conversation.created"
    COPILOT_MESSAGE_RECORDED = "copilot.message.recorded"
    COPILOT_TOOL_EXECUTED = "copilot.tool.executed"
    COPILOT_COST_INCURRED = "copilot.cost.incurred"
    COPILOT_BUDGET_BLOCKED = "copilot.budget.blocked"


@dataclass
class Event:
    """The canonical event shape (Rule 2 — tenant + project always present)."""

    event_type: EventType
    tenant_id: UUID | str
    project_id: UUID | str | None
    payload: dict[str, Any]
    actor_id: UUID | str | None = None
    event_id: UUID = field(default_factory=uuid.uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

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

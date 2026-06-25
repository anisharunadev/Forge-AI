"""TS → Python bus bridge for connector events (Pillar 1 — Phase 1).

The TypeScript ``packages/connector-events`` package emits a closed
family of events (``jira.issue.observed``, ``jira.transition.applied``,
``jira.issue.ingested``, …). Those events are produced in the Next.js
process and need to land on the Python in-process ``event_bus`` so
backend services (``JiraIngestionService``) can subscribe.

The bridge is a thin FastAPI router. TS POSTs a JSON envelope; the
router validates against ``ConnectorEventEnvelope`` and re-publishes
on the bus as either ``EventType.CONNECTOR_EVENT_OBSERVED`` (default)
or ``EventType.CONNECTOR_EVENT_INGESTED`` (post-process ack). Audit
is written on every receipt (Rule 6).

Note: This module owns the event-shape contract. The HTTP layer lives
in ``app/api/v1/connector_events.py`` and is a 1-line pass-through.

TODO(frontend agent): the TS consumer that POSTs to this endpoint is
out of scope for this executor (TS/Next.js files are owned by the
frontend agent). When the TS side is wired, it MUST only emit event
types from the closed set in ``ALLOWED_EVENT_TYPES``.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.services.audit_service import audit_service
from app.services.event_bus import EventType, bus as default_bus

logger = get_logger(__name__)


# Closed set mirrors the TS ``packages/connector-events`` Jira family.
# Keep in sync with the TS side; mismatch is a contract violation.
ALLOWED_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "jira.issue.observed",
        "jira.transition.applied",
        "jira.issue.ingested",
    }
)


class ConnectorEventEnvelope(BaseModel, extra="forbid"):
    """Typed Pydantic shape for the bridge payload (Rule 4 — typed artifacts).

    The TS-side producer is the single source of truth for the
    wire-format. This model is the Python validator; new fields are
    explicitly rejected (``extra='forbid'``) so a TS contract change
    surfaces here rather than silently passing.
    """

    event_type: str
    tenant_id: str
    project_id: str | None = None
    actor_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: str | None = None


async def publish_connector_event(envelope: ConnectorEventEnvelope) -> dict[str, Any]:
    """Validate + re-publish a TS-side connector event on the Python bus.

    Returns a small ``{"ok": true, "event_id": …, "published_as": …}``
    payload so the TS caller can confirm the bridge round-trip.
    """
    if envelope.event_type not in ALLOWED_EVENT_TYPES:
        await audit_service.record(
            tenant_id=envelope.tenant_id,
            project_id=envelope.project_id,
            actor_id=envelope.actor_id,
            action="connector.event.rejected",
            target_type="connector_event",
            target_id=envelope.event_type,
            payload={"reason": "unknown_event_type"},
        )
        return {"ok": False, "error": f"unknown_event_type:{envelope.event_type}"}

    # Map TS event_type → Python EventType. Two TS events map to
    # ``CONNECTOR_EVENT_OBSERVED`` (the consumer is the same shape);
    # ``jira.issue.ingested`` maps to ``CONNECTOR_EVENT_INGESTED``
    # (an informational ack emitted by the post-ingest path).
    if envelope.event_type == "jira.issue.ingested":
        python_event_type = EventType.CONNECTOR_EVENT_INGESTED
    else:
        python_event_type = EventType.CONNECTOR_EVENT_OBSERVED

    payload = dict(envelope.payload or {})
    payload.setdefault("kind", envelope.event_type)
    payload.setdefault("source_event_type", envelope.event_type)

    event = await default_bus.publish(
        python_event_type,
        payload,
        tenant_id=envelope.tenant_id,
        project_id=envelope.project_id,
        actor_id=envelope.actor_id,
    )

    await audit_service.record(
        tenant_id=envelope.tenant_id,
        project_id=envelope.project_id,
        actor_id=envelope.actor_id,
        action="connector.event.received",
        target_type="connector_event",
        target_id=envelope.event_type,
        payload={"event_id": str(event.event_id), "published_as": python_event_type.value},
    )
    return {
        "ok": True,
        "event_id": str(event.event_id),
        "published_as": python_event_type.value,
    }


__all__ = [
    "ALLOWED_EVENT_TYPES",
    "ConnectorEventEnvelope",
    "publish_connector_event",
]

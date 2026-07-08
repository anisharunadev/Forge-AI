"""Connector failure-mode primitives (DL-027).

Connectors cycle through a deterministic state machine. Invalid
transitions are rejected, and every transition emits an event so
the rest of the system can react (cost ledger, alert bus, etc.).
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import UTC
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

logger = get_logger(__name__)


class ConnectorState(enum.StrEnum):
    """Connector lifecycle states."""

    PENDING = "pending"
    SYNCING = "syncing"
    HEALTHY = "healthy"
    STALE = "stale"
    QUARANTINED = "quarantined"
    FAILED = "failed"


# Allowed transitions (M1 spec).
_VALID_TRANSITIONS: dict[ConnectorState, set[ConnectorState]] = {
    ConnectorState.PENDING: {ConnectorState.SYNCING},
    ConnectorState.SYNCING: {ConnectorState.HEALTHY, ConnectorState.FAILED},
    ConnectorState.HEALTHY: {ConnectorState.STALE, ConnectorState.SYNCING},
    ConnectorState.STALE: {ConnectorState.SYNCING, ConnectorState.FAILED},
    ConnectorState.FAILED: {ConnectorState.QUARANTINED},
    ConnectorState.QUARANTINED: {ConnectorState.PENDING},
}


_EVENT_FOR_STATE: dict[ConnectorState, EventType] = {
    ConnectorState.SYNCING: EventType.CONNECTOR_SYNCING,
    ConnectorState.HEALTHY: EventType.CONNECTOR_HEALTHY,
    ConnectorState.STALE: EventType.CONNECTOR_STALE,
    ConnectorState.FAILED: EventType.CONNECTOR_FAILED,
}


@dataclass(frozen=True)
class ConnectorTransition:
    connector_id: str
    from_state: ConnectorState
    to_state: ConnectorState
    reason: str
    occurred_at: str  # ISO-8601


class InvalidTransitionError(RuntimeError):
    """Raised when a state transition violates the connector state machine."""


class ConnectorStateMachine:
    """Enforces the connector state machine and emits events."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    def can_transition(self, from_state: ConnectorState, to_state: ConnectorState) -> bool:
        return to_state in _VALID_TRANSITIONS.get(from_state, set())

    async def transition(
        self,
        connector_id: str,
        from_state: ConnectorState,
        to_state: ConnectorState,
        reason: str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None = None,
    ) -> ConnectorTransition:
        """Apply a state transition or raise InvalidTransitionError."""
        if not self.can_transition(from_state, to_state):
            raise InvalidTransitionError(
                f"connector {connector_id}: {from_state.value} -> {to_state.value} is not allowed"
            )
        from datetime import datetime

        transition = ConnectorTransition(
            connector_id=connector_id,
            from_state=from_state,
            to_state=to_state,
            reason=reason,
            occurred_at=datetime.now(UTC).isoformat(),
        )
        event_type = _EVENT_FOR_STATE.get(to_state)
        if event_type is not None:
            await self._bus.publish(
                event_type,
                {
                    "connector_id": connector_id,
                    "from_state": from_state.value,
                    "to_state": to_state.value,
                    "reason": reason,
                },
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )
        logger.info(
            "connector.transition",
            connector_id=connector_id,
            from_state=from_state.value,
            to_state=to_state.value,
            reason=reason,
        )
        return transition


connector_state_machine = ConnectorStateMachine()


__all__ = [
    "ConnectorState",
    "ConnectorStateMachine",
    "ConnectorTransition",
    "InvalidTransitionError",
    "connector_state_machine",
]

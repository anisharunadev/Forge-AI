"""Terminal audit (F-406).

Every command and every session lifecycle event is written to a
dedicated audit table so terminal activity is searchable independent
of the generic AuditEvent stream.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.db.models.audit import AuditEvent
from app.db.session import get_session_factory
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


@dataclass(frozen=True)
class TerminalAuditRecord:
    session_id: str
    command: str
    output_hash: str
    cost_estimate_usd: float
    duration_ms: int
    occurred_at: datetime


class TerminalAudit:
    """Terminal-specific audit logger."""

    @staticmethod
    def _hash_output(output: bytes | str) -> str:
        data = output if isinstance(output, bytes) else output.encode("utf-8")
        return hashlib.sha256(data).hexdigest()

    async def record_command(
        self,
        *,
        session_id: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        command: str,
        output: bytes | str,
        cost_estimate: float,
        duration_ms: int,
    ) -> TerminalAuditRecord:
        """Persist one command + a SHA-256 of its output for forensic replay."""
        output_hash = self._hash_output(output)
        occurred = datetime.now(timezone.utc)
        factory = get_session_factory()
        async with factory() as session:
            session.add(
                AuditEvent(
                    tenant_id=str(tenant_id),
                    project_id=str(project_id) if project_id else "00000000-0000-0000-0000-000000000000",
                    actor_id=str(actor_id) if actor_id else None,
                    action="terminal.command",
                    target_type="terminal_session",
                    target_id=session_id,
                    payload={
                        "command": command,
                        "output_hash": output_hash,
                        "cost_estimate_usd": cost_estimate,
                        "duration_ms": duration_ms,
                    },
                    occurred_at=occurred,
                )
            )
            await session.commit()
        await bus.publish(
            EventType.TERMINAL_COMMAND_EXECUTED,
            {
                "session_id": session_id,
                "command": command,
                "output_hash": output_hash,
                "cost_estimate_usd": cost_estimate,
                "duration_ms": duration_ms,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return TerminalAuditRecord(
            session_id=session_id,
            command=command,
            output_hash=output_hash,
            cost_estimate_usd=cost_estimate,
            duration_ms=duration_ms,
            occurred_at=occurred,
        )

    async def record_session_lifecycle(
        self,
        *,
        session_id: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        event: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Emit terminal.session.{started|closed} for downstream consumers."""
        factory = get_session_factory()
        async with factory() as session:
            session.add(
                AuditEvent(
                    tenant_id=str(tenant_id),
                    project_id=str(project_id) if project_id else "00000000-0000-0000-0000-000000000000",
                    actor_id=str(actor_id) if actor_id else None,
                    action=f"terminal.session.{event}",
                    target_type="terminal_session",
                    target_id=session_id,
                    payload=payload or {},
                    occurred_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()
        bus_event = (
            EventType.TERMINAL_SESSION_STARTED
            if event == "started"
            else EventType.TERMINAL_SESSION_CLOSED
        )
        await bus.publish(
            bus_event,
            {"session_id": session_id, **(payload or {})},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )


terminal_audit = TerminalAudit()


__all__ = ["TerminalAudit", "TerminalAuditRecord", "terminal_audit"]

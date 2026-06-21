"""Audit service — writes AuditEvent rows from any call site.

The decorator in `app.core.audit` is the endpoint-level hook; this
service is the call-site hook for non-endpoint code (services, jobs).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.db.models.audit import AuditEvent
from app.db.session import get_session_factory


class AuditService:
    """Single entry-point for writing AuditEvents."""

    async def record(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        action: str,
        target_type: str,
        target_id: str,
        payload: dict[str, Any] | None = None,
        occurred_at: datetime | None = None,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            session.add(
                AuditEvent(
                    tenant_id=str(tenant_id),
                    project_id=str(project_id) if project_id else "00000000-0000-0000-0000-000000000000",
                    actor_id=str(actor_id) if actor_id else None,
                    action=action,
                    target_type=target_type,
                    target_id=target_id,
                    payload=payload or {},
                    occurred_at=occurred_at or datetime.now(timezone.utc),
                )
            )
            await session.commit()


audit_service = AuditService()


__all__ = ["AuditService", "audit_service"]

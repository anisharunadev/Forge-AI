"""AuditEvent — append-only (Rule 6).

DB-level immutability is enforced by triggers (see alembic migration
0002_audit_immutability.py). SQLAlchemy layer raises on UPDATE/DELETE.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, String, event
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, UUIDPrimaryKeyMixin
from app.core.logging import get_logger

logger = get_logger(__name__)


class AuditEvent(Base, UUIDPrimaryKeyMixin):
    """Immutable audit record.

    `actor_id` may be NULL for system actions (a connector sync).
    `payload` is opaque JSON; downstream services project it as needed.
    """

    __tablename__ = "audit_events"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )


# SQLAlchemy ORM-level immutability: any UPDATE or DELETE attempt is
# rejected at the application boundary so we get a clean stacktrace.
@event.listens_for(AuditEvent, "before_update", propagate=True)
@event.listens_for(AuditEvent, "before_delete", propagate=True)
def _reject_mutation(_mapper: Any, _connection: Any, _target: Any) -> None:  # type: ignore[no-untyped-def]
    logger.error("audit.immutability_violation")
    raise RuntimeError(
        "AuditEvent is append-only; UPDATE/DELETE forbidden (Rule 6, DB trigger backup)"
    )


__all__ = ["AuditEvent"]

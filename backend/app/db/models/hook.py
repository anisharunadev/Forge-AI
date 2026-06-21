"""Hook — event-driven automation script (F-017)."""

from __future__ import annotations

import enum
from uuid import UUID

from sqlalchemy import Boolean, Enum as SAEnum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, TimestampMixin, UUIDPrimaryKeyMixin


class HookPhase(str, enum.Enum):
    """When a hook fires relative to the originating event."""

    PRE = "pre"
    POST = "post"
    ERROR = "error"


class Hook(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A scripted action bound to a domain event.

    `event_type` is a dotted path matching EventType values
    (e.g. "artifact.created", "connector.failed"). `action` selects
    the runtime behaviour (currently "shell" executes `script` via
    subprocess). `run_order` controls execution order within a phase
    (lower runs first).
    """

    __tablename__ = "hooks"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    phase: Mapped[HookPhase] = mapped_column(
        SAEnum(HookPhase, name="hook_phase"), nullable=False, default=HookPhase.POST
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, default="shell")
    script: Mapped[str] = mapped_column(Text, nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    run_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)

    __table_args__ = (
        Index("ix_hooks_tenant_event_enabled", "tenant_id", "event_type", "enabled"),
    )


__all__ = ["Hook", "HookPhase"]

"""Command-run ledger (direct ``forge-cmd-*`` invocations).

Distinct from ``workflow_runs`` (which tracks multi-step workflows) and
``ingestion_runs`` (which tracks connector pulls). ``command_run`` is
the audit log for one-shot command invocations — e.g. ``forge-ideate-crystallize``
or ``forge-dev-migrate``. The acme-corp demo seeds 50 historical runs.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Float, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    ARRAY,
    GUID,
    JSONB,
    Base,
    TenantScopedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class CommandRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"


class CommandRun(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """One direct invocation of a forge command."""

    __tablename__ = "command_runs"

    run_key: Mapped[str] = mapped_column(String(200), nullable=False)
    command_name: Mapped[str] = mapped_column(String(120), nullable=False)
    invoked_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    status: Mapped[CommandRunStatus] = mapped_column(
        SAEnum(CommandRunStatus, name="command_run_status"),
        nullable=False,
        default=CommandRunStatus.QUEUED,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    output: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifacts_produced: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=list
    )

    __table_args__ = (
        Index("uq_command_runs_tenant_key", "tenant_id", "run_key", unique=True),
        Index("ix_command_runs_tenant_command", "tenant_id", "command_name"),
        Index("ix_command_runs_tenant_status_started", "tenant_id", "status", "started_at"),
    )


__all__ = [
    "CommandRun",
    "CommandRunStatus",
]

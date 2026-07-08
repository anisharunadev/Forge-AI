"""Observability ledger (pulse events + metric snapshots).

``PulseEvent`` is the canonical append-only stream of "what just
happened" — agent runs, approvals, conflicts, IDE events, terminal
events. ``MetricSnapshot`` is a periodic point-in-time aggregate used
for TTTD dashboards and other trend lines.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Float, Index, String, Text
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


class PulseEventKind(StrEnum):
    AGENT_RUN = "agent_run"
    APPROVAL = "approval"
    CONFLICT = "conflict"
    IDE_EVENT = "ide_event"
    TERMINAL_EVENT = "terminal_event"
    INGESTION = "ingestion"
    SEED = "seed"
    COMMAND = "command"


class PulseEvent(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """A single event in the project's pulse stream."""

    __tablename__ = "pulse_events"

    event_key: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[PulseEventKind] = mapped_column(
        SAEnum(PulseEventKind, name="pulse_event_kind"),
        nullable=False,
    )
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)

    __table_args__ = (
        Index("uq_pulse_events_tenant_key", "tenant_id", "event_key", unique=True),
        Index("ix_pulse_events_tenant_kind_occurred", "tenant_id", "kind", "occurred_at"),
        Index("ix_pulse_events_tenant_target", "tenant_id", "target_type", "target_id"),
    )


class MetricSnapshot(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """Periodic point-in-time metric (e.g. monthly TTTD baseline)."""

    __tablename__ = "metric_snapshots"

    metric_key: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    dimensions: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "uq_metric_snapshots_tenant_metric_time",
            "tenant_id",
            "metric_key",
            "snapshot_at",
            unique=True,
        ),
        Index("ix_metric_snapshots_tenant_metric", "tenant_id", "metric_key"),
    )


__all__ = [
    "MetricSnapshot",
    "PulseEvent",
    "PulseEventKind",
]

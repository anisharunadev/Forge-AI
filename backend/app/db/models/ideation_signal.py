"""Phase 3 ideation signal ORM models.

Two new tables land in this module:
- ``IdeaSourceSignal`` — raw signals ingested from Confluence,
  Zendesk, Slack by the daily ingest job. UNIQUE on
  ``(tenant_id, source, external_id)`` so pullers use
  ``INSERT ... ON CONFLICT DO NOTHING`` for idempotent ingest.
- ``IdeationIngestRun`` — one row per daily ingest run; the dashboard
  indicator reads from here.

Both tables carry tenant_id (Rule 2). Signals also carry project_id
because they originate from a project's connector pool; runs are
tenant-scoped because a single run covers all projects in the tenant.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, TimestampMixin, UUIDPrimaryKeyMixin


# ---------------------------------------------------------------------------
# Enums (string-backed; the closed-set is mirrored by the migration's
# CHECK constraint pattern via application-layer validation).
# ---------------------------------------------------------------------------


# Closed-set of source system identifiers; matches the three MCP servers
# wired in Phase 3 (Confluence, Zendesk, Slack). Adding a fourth? Extend
# this tuple and update the synthesizer's switch.
SOURCE_NAMES: tuple[str, ...] = ("confluence", "zendesk", "slack")


# Closed-set of run statuses; matches ``ideation_ingest_runs.status``.
RUN_STATUSES: tuple[str, ...] = ("running", "success", "partial", "failed")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class IdeaSourceSignal(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A raw external signal awaiting synthesis into an Idea.

    Lifecycle:
    1. Source puller writes rows via ``INSERT ... ON CONFLICT DO NOTHING``.
    2. Synthesizer reads rows where ``idea_id IS NULL``, clusters them,
       and updates ``idea_id`` after creating an Idea.
    """

    __tablename__ = "ideation_source_signals"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    idea_id: Mapped[UUID | None] = mapped_column(
        GUID(),
        ForeignKey("ideas.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index(
            "uq_ideation_source_signals_tenant_source_external",
            "tenant_id",
            "source",
            "external_id",
            unique=True,
        ),
        Index(
            "ix_ideation_source_signals_tenant_source",
            "tenant_id",
            "source",
        ),
        Index("ix_ideation_source_signals_idea_id", "idea_id"),
        Index(
            "ix_ideation_source_signals_tenant_idea_id",
            "tenant_id",
            "idea_id",
        ),
    )


class IdeationIngestRun(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Status row for one daily ideation ingest run."""

    __tablename__ = "ideation_ingest_runs"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    signals_seen: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    ideas_created: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="running"
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    degraded_budget: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    __table_args__ = (
        Index(
            "ix_ideation_ingest_runs_tenant_started",
            "tenant_id",
            "started_at",
        ),
    )


__all__ = [
    "IdeaSourceSignal",
    "IdeationIngestRun",
    "SOURCE_NAMES",
    "RUN_STATUSES",
]
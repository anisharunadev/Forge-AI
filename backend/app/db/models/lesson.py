"""F-002-LESSON — Lessons Learned feedback loop (Step-64 Sub-step B).

A ``LessonCandidate`` is auto-generated when an SDLC run / workflow
run fails (or is explicitly tagged bad-outcome). A Steward reviews
candidates monthly; approving promotes the lesson into a
``Template`` (F-002) and writes an audit row (Rule 6).

No schema-level mutation of :class:`Template` is required — the
approval flow inserts a new template and supersedes nothing (the
approval itself is the audit trail; curators compose later).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, UUIDPrimaryKeyMixin


class LessonStatus(str, Enum):
    """Lifecycle of a LessonCandidate."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class LessonSource(str, Enum):
    """Which signal produced the candidate.

    Stored as a free-form ``source_event`` on the row, but the closed
    set here drives the UI filter chips and the digest summary.
    """

    RUN_FAILED = "run.failed"
    WORKFLOW_FAILED = "workflow.failed"
    ROLLBACK = "rollback"
    BAD_OUTCOME_TAG = "bad_outcome.tag"
    METRIC_DEGRADE = "metric.degraded"
    DEPLOYMENT_ALERT = "deployment.alert"


class LessonCandidate(Base, UUIDPrimaryKeyMixin):
    """A pending lesson surfaced from a negative run outcome."""

    __tablename__ = "lesson_candidates"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    # Run / workflow / deployment the lesson was derived from. Optional
    # because some lessons come from external signals (e.g. rollback
    # without a tracked run id).
    run_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    source_event: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[LessonStatus] = mapped_column(
        SAEnum(LessonStatus, name="lesson_status"),
        nullable=False,
        default=LessonStatus.PENDING,
    )

    # The proposed body — title + markdown. The Steward can edit before
    # approving; ``promoted_template_id`` is set when approved.
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_skill_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Provenance — where the signal came from, what evidence we have.
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    promoted_template_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("templates.id", ondelete="SET NULL"), nullable=True
    )
    decided_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_lesson_candidates_tenant_project", "tenant_id", "project_id"),
        Index("ix_lessons_tenant_status", "tenant_id", "status"),
        Index("ix_lessons_tenant_created", "tenant_id", "created_at"),
    )


__all__ = ["LessonCandidate", "LessonStatus", "LessonSource"]

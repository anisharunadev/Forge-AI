"""LessonCandidate wire schemas (F-002-LESSON / Step-64 Sub-step B).

The Candidate is one of three lifecycle postures:

* ``PENDING`` — surfaces in the steward review queue
* ``APPROVED`` — promoted into a ``Template`` (F-002); ``promoted_template_id`` set
* ``REJECTED`` — curator declined; ``review_notes`` explains why

Decision flow:

1. Steward opens ``GET /api/v1/lessons?status=pending`` and sees the queue.
2. ``POST /api/v1/lessons/{id}/approve`` flips status → APPROVED and inserts
   a ``Template`` (Rule 4 typed artifact) with the lesson body as content.
3. ``POST /api/v1/lessons/{id}/reject`` flips status → REJECTED with notes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel


LessonStatusWire = Literal["pending", "approved", "rejected"]

# Re-expose the enum as a string literal so the TS side stays in lock-step.
LessonSourceWire = Literal[
    "run.failed",
    "workflow.failed",
    "rollback",
    "bad_outcome.tag",
    "metric.degraded",
    "deployment.alert",
]


class LessonEvidenceRef(ForgeBaseModel):
    """One piece of supporting signal — an audit row, a command_run, etc."""

    ref_type: Literal["audit_event", "command_run", "validation_report", "deployment"]
    ref_id: str
    summary: str = ""


class LessonCandidateWire(ForgeBaseModel):
    """Outward shape for the steward review queue."""

    id: UUID
    tenant_id: UUID
    project_id: UUID | None = None
    run_id: UUID | None = None
    source_event: LessonSourceWire
    title: str
    body: str
    proposed_skill_name: str | None = None
    evidence: list[LessonEvidenceRef] = Field(default_factory=list)
    status: LessonStatusWire = "pending"
    promoted_template_id: UUID | None = None
    decided_by: UUID | None = None
    decided_at: datetime | None = None
    review_notes: str | None = None
    created_at: datetime
    schema_version: int = 1


class LessonCandidateListResponse(ForgeBaseModel):
    items: list[LessonCandidateWire]
    total: int
    pending_count: int
    approved_count: int
    rejected_count: int


class LessonDecideRequest(ForgeBaseModel):
    """Shared body for approve / reject."""

    editor_id: UUID
    review_notes: str = ""
    # On approve, the steward can override the title/body before insertion.
    title_override: str | None = None
    body_override: str | None = None
    proposed_skill_name_override: str | None = None


class LessonDecisionResult(ForgeBaseModel):
    candidate: LessonCandidateWire
    promoted_template_id: UUID | None = None
    promoted_skill_name: str | None = None


class MonthlyDigest(ForgeBaseModel):
    """Summary the steward sees once a month in their inbox."""

    tenant_id: UUID
    period_start: datetime
    period_end: datetime
    pending: list[LessonCandidateWire]
    approved: list[LessonCandidateWire]
    rejected: list[LessonCandidateWire]
    by_source: dict[str, int] = Field(default_factory=dict)
    auto_promotable_skill: str | None = None
    notes: str = ""


__all__ = [
    "LessonCandidateListResponse",
    "LessonCandidateWire",
    "LessonDecideRequest",
    "LessonDecisionResult",
    "LessonEvidenceRef",
    "LessonSourceWire",
    "LessonStatusWire",
    "MonthlyDigest",
]

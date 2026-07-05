"""Ideation Center ORM models (F-201..F-213).

Stores the canonical ideation workflow artifacts:
- Idea (intake)
- IdeaAnalysis (LLM-produced analysis)
- OpportunityScore (RICE + custom dimensions)
- Roadmap (ranked, themed)
- PRD (typed artifact, versioned)
- ArchitecturePreview (typed artifact, versioned)
- OutputBundle (the final package handed off to delivery)
- ApprovalItem (human-in-the-loop queue entries)
- PushRecord (audit trail of every external-system push)
"""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class IdeaSource(str, enum.Enum):
    """How an idea entered the system."""

    USER = "user"
    COMMUNITY = "community"
    SIGNAL = "signal"
    ROADMAP = "roadmap"
    FEEDBACK = "feedback"


class IdeaStatus(str, enum.Enum):
    """Lifecycle of an Idea from intake to delivery."""

    NEW = "new"
    ANALYZING = "analyzing"
    SCORED = "scored"
    APPROVED = "approved"
    IN_ROADMAP = "in_roadmap"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class ScoreSource(str, enum.Enum):
    """Who/what produced a score."""

    AI = "ai"
    HUMAN = "human"
    HYBRID = "hybrid"


class RoadmapHorizon(str, enum.Enum):
    """Time horizon for a roadmap bucket."""

    NOW = "now"
    NEXT = "next"
    LATER = "later"
    FUTURE = "future"


class RoadmapStatus(str, enum.Enum):
    """Roadmap lifecycle."""

    DRAFT = "draft"
    PROPOSED = "proposed"
    APPROVED = "approved"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class PRDStatus(str, enum.Enum):
    """PRD lifecycle."""

    DRAFT = "draft"
    REVIEW = "review"
    APPROVED = "approved"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class ApprovalItemType(str, enum.Enum):
    """What kind of decision is queued for human review."""

    ROADMAP = "roadmap"
    PRD = "prd"
    ARCH_PREVIEW = "arch_preview"
    PUSH_TO_DELIVERY = "push_to_delivery"


class ApprovalItemStatus(str, enum.Enum):
    """State of a queued approval."""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    REQUEST_CHANGES = "request_changes"
    DELEGATED = "delegated"
    CANCELLED = "cancelled"


class ApprovalDecision(str, enum.Enum):
    """Decision verbs callers can submit."""

    APPROVE = "approve"
    DENY = "deny"
    REQUEST_CHANGES = "request_changes"


class WorkflowSessionStatus(str, enum.Enum):
    """Real-time ideation workflow status."""

    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class WorkflowStepStatus(str, enum.Enum):
    """Status of a single step within a workflow session."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class PushTarget(str, enum.Enum):
    """Where a push can go."""

    JIRA = "jira"
    CONFLUENCE = "confluence"
    ARCHITECTURE = "architecture"


class PushStatus(str, enum.Enum):
    """Push record lifecycle."""

    SUCCESS = "success"
    FAILED = "failed"
    PENDING = "pending"


# ---------------------------------------------------------------------------
# Idea
# ---------------------------------------------------------------------------


class Idea(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A raw idea submitted through intake (F-201).

    Carries tenant + project always; status drives downstream workflow.
    """

    __tablename__ = "ideas"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[IdeaSource] = mapped_column(
        SAEnum(IdeaSource, name="idea_source"),
        nullable=False,
        default=IdeaSource.USER,
    )
    submitted_by: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    status: Mapped[IdeaStatus] = mapped_column(
        SAEnum(IdeaStatus, name="idea_status"),
        nullable=False,
        default=IdeaStatus.NEW,
    )
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    attachments: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )

    __table_args__ = (
        Index("ix_ideas_tenant_project_status", "tenant_id", "project_id", "status"),
        Index("ix_ideas_tenant_submitted_by", "tenant_id", "submitted_by"),
    )


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


class IdeaAnalysis(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """LLM-produced analysis of an idea (F-202)."""

    __tablename__ = "idea_analyses"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    problem_statement: Mapped[str] = mapped_column(Text, nullable=False, default="")
    target_users: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    success_metrics: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    assumptions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    risks: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    related_artifacts: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    model_used: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index("ix_idea_analyses_idea", "idea_id"),
        Index("ix_idea_analyses_tenant_project", "tenant_id", "project_id"),
    )


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


class OpportunityScore(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """RICE + custom scoring on an idea (F-204)."""

    __tablename__ = "opportunity_scores"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    feasibility_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    risk_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    reach_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    total_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    scoring_rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    scored_by: Mapped[ScoreSource] = mapped_column(
        SAEnum(ScoreSource, name="score_source"),
        nullable=False,
        default=ScoreSource.AI,
    )
    scored_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index("ix_opportunity_scores_idea", "idea_id"),
        Index(
            "ix_opportunity_scores_tenant_project_total",
            "tenant_id",
            "project_id",
            "total_score",
        ),
    )


# ---------------------------------------------------------------------------
# Roadmap
# ---------------------------------------------------------------------------


class Roadmap(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A themed, ranked collection of ideas (F-205)."""

    __tablename__ = "roadmaps"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    horizon: Mapped[RoadmapHorizon] = mapped_column(
        SAEnum(RoadmapHorizon, name="roadmap_horizon"),
        nullable=False,
        default=RoadmapHorizon.NOW,
    )
    theme: Mapped[str] = mapped_column(String(200), nullable=False, default="general")
    status: Mapped[RoadmapStatus] = mapped_column(
        SAEnum(RoadmapStatus, name="roadmap_status"),
        nullable=False,
        default=RoadmapStatus.DRAFT,
    )
    items: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    generated_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    approved_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)

    __table_args__ = (
        Index("ix_roadmaps_tenant_project_status", "tenant_id", "project_id", "status"),
        Index("ix_roadmaps_tenant_horizon", "tenant_id", "horizon"),
    )


# ---------------------------------------------------------------------------
# PRD
# ---------------------------------------------------------------------------


class PRD(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Product Requirements Document (F-206) — typed artifact (Rule 4).

    PRDs are append-only: a new version supersedes the previous. The
    `content` JSONB contains the section dict (problem, goals, ...).
    """

    __tablename__ = "prds"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[PRDStatus] = mapped_column(
        SAEnum(PRDStatus, name="prd_status"),
        nullable=False,
        default=PRDStatus.DRAFT,
    )
    generated_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    reviewed_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    superseded_by_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)

    __table_args__ = (
        Index("ix_prds_idea", "idea_id"),
        Index("ix_prds_tenant_project_status", "tenant_id", "project_id", "status"),
    )


# ---------------------------------------------------------------------------
# Architecture Preview
# ---------------------------------------------------------------------------


class ArchitecturePreview(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Architecture preview for an idea (F-207) — typed artifact (Rule 4).

    Components / integrations / risks are JSONB-shaped for React-Flow
    visualization. Versioned; new versions supersede.
    """

    __tablename__ = "architecture_previews"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    components: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    integrations: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    data_flows: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    risks: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    generated_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    superseded_by_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)

    __table_args__ = (
        Index("ix_arch_previews_idea", "idea_id"),
        Index("ix_arch_previews_tenant_project", "tenant_id", "project_id"),
    )


# ---------------------------------------------------------------------------
# Output bundle + workflow
# ---------------------------------------------------------------------------


class OutputBundle(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """The packaged hand-off: Idea + everything derived (F-211)."""

    __tablename__ = "output_bundles"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bundle: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    storage_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)

    __table_args__ = (        Index("ix_output_bundles_tenant_project", "tenant_id", "project_id"),
        Index("ix_output_bundles_idea", "idea_id"),
    )


class WorkflowSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A long-lived realtime ideation workflow (F-210)."""

    __tablename__ = "workflow_sessions"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    status: Mapped[WorkflowSessionStatus] = mapped_column(
        SAEnum(WorkflowSessionStatus, name="workflow_session_status"),
        nullable=False,
        default=WorkflowSessionStatus.PENDING,
    )
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    current_step: Mapped[str | None] = mapped_column(String(120), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (        Index("ix_workflow_sessions_tenant_project", "tenant_id", "project_id"),
        Index("ix_workflow_sessions_tenant_status", "tenant_id", "status"),
        Index("ix_workflow_sessions_idea", "idea_id"),
    )


class WorkflowStep(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single step within a workflow session."""

    __tablename__ = "workflow_steps"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    session_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("workflow_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[WorkflowStepStatus] = mapped_column(
        SAEnum(WorkflowStepStatus, name="workflow_step_status"),
        nullable=False,
        default=WorkflowStepStatus.PENDING,
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_workflow_steps_session_position", "session_id", "position"),
    )


# ---------------------------------------------------------------------------
# Approval queue + push history
# ---------------------------------------------------------------------------


class ApprovalItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single human-approval row in the ideation approval queue (F-212)."""

    __tablename__ = "ideation_approval_items"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    request_type: Mapped[ApprovalItemType] = mapped_column(
        SAEnum(ApprovalItemType, name="approval_item_type"),
        nullable=False,
    )
    subject_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[ApprovalItemStatus] = mapped_column(
        SAEnum(ApprovalItemStatus, name="approval_item_status"),
        nullable=False,
        default=ApprovalItemStatus.PENDING,
    )
    requested_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    reviewer_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    decided_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 8 SC-8.2 - SLA window. NULL means "no expiry" until a
    # per-tenant default SLA is configured. The approval service
    # rejects decisions on items past this timestamp.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index(
            "ix_approval_items_tenant_reviewer_status",
            "tenant_id",
            "reviewer_id",
            "status",
        ),
        Index("ix_approval_items_idea_type", "idea_id", "request_type"),
        Index("ix_ideation_approval_items_tenant_project", "tenant_id", "project_id"),
        Index(
            "ix_approval_items_status_expires",
            "status",
            "expires_at",
        ),
    )


class PushRecord(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Audit trail of every external push (F-213)."""

    __tablename__ = "ideation_push_records"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target: Mapped[PushTarget] = mapped_column(
        SAEnum(PushTarget, name="push_target"),
        nullable=False,
    )
    external_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[PushStatus] = mapped_column(
        SAEnum(PushStatus, name="push_status"),
        nullable=False,
        default=PushStatus.PENDING,
    )
    actor_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_push_records_idea_target", "idea_id", "target"),
        Index("ix_push_records_tenant_status", "tenant_id", "status"),
        Index("ix_ideation_push_records_tenant_project", "tenant_id", "project_id"),
    )


class PushAttempt(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Idempotency cache for the push endpoints (M4-G5, G20).

    Every successful (or attempted) push with an ``Idempotency-Key``
    header writes one row here. The UNIQUE constraint on
    ``(tenant_id, idea_id, idempotency_key)`` is the contract — a
    second push with the same triple returns the cached result
    instead of re-executing the underlying delivery call.
    """

    __tablename__ = "ideation_push_attempts"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    idea_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    target: Mapped[PushTarget] = mapped_column(
        SAEnum(PushTarget, name="push_attempt_target"),
        nullable=False,
    )
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    actor_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)

    __table_args__ = (
        Index(
            "uq_push_attempts_tenant_idea_key",
            "tenant_id",
            "idea_id",
            "idempotency_key",
            unique=True,
        ),
        Index(
            "ix_push_attempts_tenant_key",
            "tenant_id",
            "idempotency_key",
        ),
    )


__all__ = [
    "ApprovalDecision",
    "ApprovalItem",
    "ApprovalItemStatus",
    "ApprovalItemType",
    "ArchitecturePreview",
    "Idea",
    "IdeaAnalysis",
    "IdeaSource",
    "IdeaStatus",
    "OpportunityScore",
    "OutputBundle",
    "PRD",
    "PRDStatus",
    "PushAttempt",
    "PushRecord",
    "PushStatus",
    "PushTarget",
    "Roadmap",
    "RoadmapHorizon",
    "RoadmapStatus",
    "ScoreSource",
    "WorkflowSession",
    "WorkflowSessionStatus",
    "WorkflowStep",
    "WorkflowStepStatus",
]

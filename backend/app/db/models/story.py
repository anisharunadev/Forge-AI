"""SQLAlchemy models for Stories / Sprints / Epics (step-58)."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    GUID,
    JSONB,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class StoryStatus(str, enum.Enum):
    BACKLOG = "BACKLOG"
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    IN_REVIEW = "IN_REVIEW"
    QA = "QA"
    DONE = "DONE"
    BLOCKED = "BLOCKED"


class StoryPriority(str, enum.Enum):
    P0 = "P0"
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class StoryEstimate(str, enum.Enum):
    XS = "XS"
    S = "S"
    M = "M"
    L = "L"
    XL = "XL"


class StorySource(str, enum.Enum):
    MANUAL = "MANUAL"
    JIRA = "JIRA"
    GITHUB = "GITHUB"
    LINEAR = "LINEAR"
    IDEATION = "IDEATION"
    PRD = "PRD"
    AUTO = "AUTO"


class JiraSyncStatus(str, enum.Enum):
    SYNCED = "SYNCED"
    PENDING = "PENDING"
    CONFLICT = "CONFLICT"
    FAILED = "FAILED"
    DISCONNECTED = "DISCONNECTED"


class SprintStatus(str, enum.Enum):
    PLANNING = "PLANNING"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"


class EpicStatus(str, enum.Enum):
    PLANNING = "PLANNING"
    IN_PROGRESS = "IN_PROGRESS"
    ON_TRACK = "ON_TRACK"
    AT_RISK = "AT_RISK"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"


class Story(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "stories"
    __table_args__ = (
        Index("ix_stories_tenant_project", "tenant_id", "project_id"),
        Index("ix_stories_sprint", "sprint_id"),
        Index("ix_stories_status", "status"),
    )

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    epic_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    sprint_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    acceptance_criteria: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, nullable=False
    )
    subtasks: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)

    status: Mapped[StoryStatus] = mapped_column(
        SAEnum(StoryStatus, name="story_status"),
        default=StoryStatus.BACKLOG,
        nullable=False,
    )
    priority: Mapped[StoryPriority] = mapped_column(
        SAEnum(StoryPriority, name="story_priority"),
        default=StoryPriority.P2,
        nullable=False,
    )
    estimate: Mapped[StoryEstimate] = mapped_column(
        SAEnum(StoryEstimate, name="story_estimate"),
        default=StoryEstimate.M,
        nullable=False,
    )
    labels: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    assignee_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    reporter_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)

    jira_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    jira_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    jira_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    jira_sync_status: Mapped[JiraSyncStatus] = mapped_column(
        SAEnum(JiraSyncStatus, name="story_jira_sync_status"),
        default=JiraSyncStatus.DISCONNECTED,
        nullable=False,
    )

    active_run_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    last_run_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    source: Mapped[StorySource] = mapped_column(
        SAEnum(StorySource, name="story_source"),
        default=StorySource.MANUAL,
        nullable=False,
    )
    source_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    linked_items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)


class Sprint(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "sprints"
    __table_args__ = (Index("ix_sprints_tenant_project", "tenant_id", "project_id"),)

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[SprintStatus] = mapped_column(
        SAEnum(SprintStatus, name="sprint_status"),
        default=SprintStatus.PLANNING,
        nullable=False,
    )
    story_ids: Mapped[list[UUID]] = mapped_column(JSONB, default=list, nullable=False)
    total_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Epic(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "epics"
    __table_args__ = (Index("ix_epics_tenant_project", "tenant_id", "project_id"),)

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[EpicStatus] = mapped_column(
        SAEnum(EpicStatus, name="epic_status"),
        default=EpicStatus.PLANNING,
        nullable=False,
    )
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    target_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    story_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_story_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class StoryComment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "story_comments"
    __table_args__ = (Index("ix_story_comments_story", "story_id"),)

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    story_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("stories.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[list[UUID]] = mapped_column(JSONB, default=list, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


__all__ = [
    "Story",
    "Sprint",
    "Epic",
    "StoryComment",
    "StoryStatus",
    "StoryPriority",
    "StoryEstimate",
    "StorySource",
    "JiraSyncStatus",
    "SprintStatus",
    "EpicStatus",
]

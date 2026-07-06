"""Pydantic schemas for Stories / Sprints / Epics (step-58 — Phase 7)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Stories
# ---------------------------------------------------------------------------

StoryStatus = Literal["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "QA", "DONE", "BLOCKED"]
StoryPriority = Literal["P0", "P1", "P2", "P3"]
StoryEstimate = Literal["XS", "S", "M", "L", "XL"]
StorySource = Literal["MANUAL", "JIRA", "GITHUB", "LINEAR", "IDEATION", "PRD", "AUTO"]
StoryJiraSyncStatus = Literal["SYNCED", "PENDING", "CONFLICT", "FAILED", "DISCONNECTED"]


class AcceptanceCriterion(BaseModel):
    id: str
    text: str
    done: bool = False


class Subtask(BaseModel):
    id: str
    title: str
    done: bool = False
    estimate: StoryEstimate | None = None


class LinkedItem(BaseModel):
    type: Literal["prd", "adr", "idea", "epic", "run", "comment", "task", "subtask"]
    id: str
    title: str


class StoryBase(BaseModel):
    title: str
    description: str | None = None
    status: StoryStatus = "BACKLOG"
    priority: StoryPriority = "P2"
    estimate: StoryEstimate = "M"
    labels: list[str] = Field(default_factory=list)
    epic_id: UUID | None = None
    sprint_id: UUID | None = None
    assignee_id: UUID | None = None
    acceptance_criteria: list[AcceptanceCriterion] = Field(default_factory=list)
    subtasks: list[Subtask] = Field(default_factory=list)
    linked_items: list[LinkedItem] = Field(default_factory=list)


class StoryCreate(StoryBase):
    reporter_id: UUID | None = None
    project_id: UUID | None = None
    source: StorySource = "MANUAL"
    source_id: str | None = None


class StoryUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: StoryStatus | None = None
    priority: StoryPriority | None = None
    estimate: StoryEstimate | None = None
    labels: list[str] | None = None
    epic_id: UUID | None = None
    sprint_id: UUID | None = None
    assignee_id: UUID | None = None
    acceptance_criteria: list[AcceptanceCriterion] | None = None
    subtasks: list[Subtask] | None = None


class StoryRead(StoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    tenant_id: UUID
    project_id: UUID
    reporter_id: UUID
    jira_key: str | None = None
    jira_url: str | None = None
    jira_synced_at: datetime | None = None
    jira_sync_status: StoryJiraSyncStatus = "disconnected"
    active_run_id: UUID | None = None
    last_run_id: UUID | None = None
    run_count: int = 0
    source: StorySource = "MANUAL"
    source_id: str | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class StoryBulkUpdate(BaseModel):
    updates: list[dict[str, Any]]  # [{id, ...StoryUpdate fields}]


class StoryLinkedRead(BaseModel):
    prds: list[dict[str, str]] = Field(default_factory=list)
    adrs: list[dict[str, str]] = Field(default_factory=list)
    ideas: list[dict[str, str]] = Field(default_factory=list)
    epics: list[dict[str, str]] = Field(default_factory=list)
    runs: list[dict[str, str]] = Field(default_factory=list)


class LinkToJiraInput(BaseModel):
    jira_key: str


class StartImplementationResponse(BaseModel):
    story_id: UUID
    run_id: UUID
    session_id: str
    context: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


class CommentCreate(BaseModel):
    body: str
    mentions: list[UUID] = Field(default_factory=list)


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    tenant_id: UUID
    story_id: UUID
    author_id: UUID
    author_name: str
    author_avatar_url: str | None = None
    body: str
    mentions: list[UUID] = Field(default_factory=list)
    created_at: datetime
    edited_at: datetime | None = None


# ---------------------------------------------------------------------------
# Sprints
# ---------------------------------------------------------------------------

SprintStatus = Literal["planning", "active", "completed"]


class SprintCreate(BaseModel):
    project_id: UUID
    name: str
    goal: str | None = None
    start_date: datetime
    end_date: datetime


class SprintRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    tenant_id: UUID
    project_id: UUID
    name: str
    goal: str | None = None
    start_date: datetime
    end_date: datetime
    status: SprintStatus
    story_ids: list[UUID] = Field(default_factory=list)
    total_points: int = 0
    completed_points: int = 0
    created_at: datetime


# ---------------------------------------------------------------------------
# Epics
# ---------------------------------------------------------------------------

EpicStatus = Literal["PLANNING", "IN_PROGRESS", "ON_TRACK", "AT_RISK", "BLOCKED", "COMPLETED"]


class EpicRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    tenant_id: UUID
    project_id: UUID
    title: str
    description: str | None = None
    status: EpicStatus
    start_date: datetime | None = None
    target_date: datetime | None = None
    progress: float = 0
    story_count: int = 0
    completed_story_count: int = 0
    created_at: datetime


__all__ = [
    "AcceptanceCriterion",
    "Subtask",
    "LinkedItem",
    "StoryBase",
    "StoryCreate",
    "StoryUpdate",
    "StoryRead",
    "StoryBulkUpdate",
    "StoryLinkedRead",
    "LinkToJiraInput",
    "StartImplementationResponse",
    "CommentCreate",
    "CommentRead",
    "SprintCreate",
    "SprintRead",
    "EpicRead",
]

"""Pydantic v2 schemas for Ideation Center (F-201..F-213).

Request / response models for every ideation endpoint, mapped 1:1 to
ORM models where appropriate. Pydantic v2 only.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.ideation import (
    ApprovalDecision,
    ApprovalItemStatus,
    ApprovalItemType,
    IdeaSource,
    IdeaStatus,
    PRDStatus,
    PushStatus,
    PushTarget,
    RoadmapHorizon,
    RoadmapStatus,
    ScoreSource,
    WorkflowSessionStatus,
    WorkflowStepStatus,
)
from app.schemas.common import ForgeBaseModel, TenantScopedModel

# ---------------------------------------------------------------------------
# Idea intake
# ---------------------------------------------------------------------------


class IdeaCreate(ForgeBaseModel):
    title: str = Field(..., min_length=3, max_length=256)
    description: str = Field(..., min_length=10, max_length=20_000)
    source: IdeaSource = IdeaSource.USER
    tags: list[str] = Field(default_factory=list, max_length=32)
    attachments: list[dict[str, Any]] = Field(default_factory=list, max_length=64)


class IdeaUpdate(ForgeBaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=256)
    description: str | None = Field(default=None, min_length=10, max_length=20_000)
    tags: list[str] | None = Field(default=None, max_length=32)
    attachments: list[dict[str, Any]] | None = Field(default=None, max_length=64)
    status: IdeaStatus | None = None


class IdeaRead(TenantScopedModel):
    id: UUID
    title: str
    description: str
    source: IdeaSource
    submitted_by: UUID
    status: IdeaStatus
    tags: list[str] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class IdeaListResponse(ForgeBaseModel):
    items: list[IdeaRead] = Field(default_factory=list)
    total: int = 0


class IdeaValidationResult(ForgeBaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


class IdeaAnalysisRead(TenantScopedModel):
    id: UUID
    idea_id: UUID
    summary: str
    problem_statement: str
    target_users: list[str] = Field(default_factory=list)
    success_metrics: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    related_artifacts: list[dict[str, Any]] = Field(default_factory=list)
    model_used: str | None = None
    cost_usd: float = 0.0
    analyzed_at: datetime


class IdeaEnhanceRequest(ForgeBaseModel):
    editor_note: str = Field(..., min_length=1, max_length=2000)


class EntityExtraction(ForgeBaseModel):
    people: list[str] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    dates: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)


class IdeaArtifactAttach(ForgeBaseModel):
    artifact_id: UUID


# ---------------------------------------------------------------------------
# Impact graph
# ---------------------------------------------------------------------------


class ImpactGraphNode(ForgeBaseModel):
    id: str
    kind: str
    label: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ImpactGraphEdge(ForgeBaseModel):
    id: str
    source: str
    target: str
    kind: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ImpactGraph(ForgeBaseModel):
    idea_id: UUID
    nodes: list[ImpactGraphNode] = Field(default_factory=list)
    edges: list[ImpactGraphEdge] = Field(default_factory=list)
    generated_at: datetime
    summary: str | None = None


class ImpactComparisonEntry(ForgeBaseModel):
    idea_id: UUID
    affected_services: int = 0
    affected_dependencies: int = 0
    recommended_tests: int = 0
    total_impact_score: float = 0.0


class ImpactComparison(ForgeBaseModel):
    entries: list[ImpactComparisonEntry] = Field(default_factory=list)
    compared_at: datetime


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


class OpportunityScoreRead(TenantScopedModel):
    id: UUID
    idea_id: UUID
    value_score: float
    feasibility_score: float
    risk_score: float
    reach_score: float
    total_score: float
    scoring_rationale: str
    scored_by: ScoreSource
    scored_at: datetime


class HumanScoreOverride(ForgeBaseModel):
    value_score: float = Field(..., ge=0.0, le=10.0)
    feasibility_score: float = Field(..., ge=0.0, le=10.0)
    risk_score: float = Field(..., ge=0.0, le=10.0)
    reach_score: float = Field(..., ge=0.0, le=10.0)
    reason: str = Field(..., min_length=1, max_length=2_000)


# ---------------------------------------------------------------------------
# Roadmap
# ---------------------------------------------------------------------------


class RoadmapItem(ForgeBaseModel):
    idea_id: UUID
    position: int = 0
    theme: str = "general"
    total_score: float = 0.0
    note: str | None = None


class RoadmapCreate(ForgeBaseModel):
    project_id: UUID
    name: str = Field(..., min_length=3, max_length=256)
    horizon: RoadmapHorizon = RoadmapHorizon.NOW
    theme: str = Field(default="general", min_length=1, max_length=200)
    top_n: int = Field(default=10, ge=1, le=100)


class RoadmapUpdate(ForgeBaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=256)
    theme: str | None = Field(default=None, min_length=1, max_length=200)
    items: list[RoadmapItem] | None = None


class RoadmapRead(TenantScopedModel):
    id: UUID
    name: str
    horizon: RoadmapHorizon
    theme: str
    status: RoadmapStatus
    items: list[dict[str, Any]] = Field(default_factory=list)
    generated_by: UUID
    approved_by: UUID | None = None


class RoadmapListResponse(ForgeBaseModel):
    items: list[RoadmapRead] = Field(default_factory=list)
    total: int = 0


class RoadmapAddItem(ForgeBaseModel):
    idea_id: UUID
    position: int | None = None
    note: str | None = None


class RoadmapRemoveItem(ForgeBaseModel):
    idea_id: UUID


# ---------------------------------------------------------------------------
# PRD
# ---------------------------------------------------------------------------


class PRDGenerateRequest(ForgeBaseModel):
    template: str = Field(default="bmad", min_length=1, max_length=64)


class PRDRead(TenantScopedModel):
    id: UUID
    idea_id: UUID
    version: int
    content: dict[str, Any] = Field(default_factory=dict)
    status: PRDStatus
    generated_by: UUID
    reviewed_by: UUID | None = None
    superseded_by_id: UUID | None = None


class PRDSectionUpdate(ForgeBaseModel):
    content: Any


# ---------------------------------------------------------------------------
# Architecture preview
# ---------------------------------------------------------------------------


class ArchPreviewComponent(ForgeBaseModel):
    id: str
    name: str
    kind: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ArchPreviewIntegration(ForgeBaseModel):
    from_component: str
    to_component: str
    kind: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ArchPreviewRead(TenantScopedModel):
    id: UUID
    idea_id: UUID
    version: int
    components: list[dict[str, Any]] = Field(default_factory=list)
    integrations: list[dict[str, Any]] = Field(default_factory=list)
    data_flows: list[dict[str, Any]] = Field(default_factory=list)
    risks: list[dict[str, Any]] = Field(default_factory=list)
    generated_by: UUID
    superseded_by_id: UUID | None = None


# ---------------------------------------------------------------------------
# Agent selection
# ---------------------------------------------------------------------------


class AgentAssignmentStep(ForgeBaseModel):
    phase: str
    agent_id: UUID
    agent_name: str | None = None
    rationale: str


class AgentAssignmentPlan(ForgeBaseModel):
    idea_id: UUID
    steps: list[AgentAssignmentStep] = Field(default_factory=list)
    generated_at: datetime


# ---------------------------------------------------------------------------
# Realtime workflow
# ---------------------------------------------------------------------------


class WorkflowStepRead(ForgeBaseModel):
    id: UUID
    name: str
    position: int
    status: WorkflowStepStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class WorkflowSessionRead(TenantScopedModel):
    id: UUID
    idea_id: UUID
    user_id: UUID
    status: WorkflowSessionStatus
    current_step: str | None = None
    state: dict[str, Any] = Field(default_factory=dict)
    completed_at: datetime | None = None
    steps: list[WorkflowStepRead] = Field(default_factory=list)


class WorkflowStartRequest(ForgeBaseModel):
    user_id: UUID | None = None


class WorkflowIntervention(ForgeBaseModel):
    action: str = Field(..., min_length=1, max_length=32)
    step: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Output bundle
# ---------------------------------------------------------------------------


class OutputBundleRead(TenantScopedModel):
    id: UUID
    idea_id: UUID
    bundle: dict[str, Any] = Field(default_factory=dict)
    storage_ref: str | None = None


class OutputBundleExportFormat(StrEnum):
    """Supported export formats."""

    ZIP = "zip"
    TAR = "tar"
    JSON = "json"
    PDF = "pdf"


# ---------------------------------------------------------------------------
# Approval queue
# ---------------------------------------------------------------------------


class ApprovalItemCreate(ForgeBaseModel):
    idea_id: UUID
    request_type: ApprovalItemType
    subject_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class ApprovalItemRead(TenantScopedModel):
    id: UUID
    idea_id: UUID
    request_type: ApprovalItemType
    subject_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    status: ApprovalItemStatus
    requested_by: UUID
    reviewer_id: UUID | None = None
    decided_by: UUID | None = None
    decided_at: datetime | None = None
    reason: str | None = None


class ApprovalQueueResponse(ForgeBaseModel):
    items: list[ApprovalItemRead] = Field(default_factory=list)
    total: int = 0


class ApprovalDecisionRequest(ForgeBaseModel):
    decision: ApprovalDecision
    reason: str | None = Field(default=None, max_length=2_000)


class ApprovalAssignRequest(ForgeBaseModel):
    reviewer_id: UUID


class ApprovalDelegateRequest(ForgeBaseModel):
    new_reviewer_id: UUID


# ---------------------------------------------------------------------------
# Push to delivery
# ---------------------------------------------------------------------------


class PushToJiraRequest(ForgeBaseModel):
    project_key: str = Field(..., min_length=1, max_length=32)


class PushToConfluenceRequest(ForgeBaseModel):
    space_key: str = Field(..., min_length=1, max_length=64)


class PushAllRequest(ForgeBaseModel):
    jira_project: str | None = Field(default=None, max_length=32)
    confluence_space: str | None = Field(default=None, max_length=64)
    architecture: bool = True


class PushResult(ForgeBaseModel):
    target: PushTarget
    success: bool
    external_ref: str | None = None
    error: str | None = None
    record_id: UUID


class PushRecordRead(TenantScopedModel):
    id: UUID
    idea_id: UUID
    target: PushTarget
    external_ref: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    status: PushStatus
    actor_id: UUID
    error: str | None = None


class PushHistoryResponse(ForgeBaseModel):
    items: list[PushRecordRead] = Field(default_factory=list)
    total: int = 0


# ---------------------------------------------------------------------------
# Knowledge graph integration
# ---------------------------------------------------------------------------


class IdeaGraphRead(ForgeBaseModel):
    project_id: UUID
    nodes: list[ImpactGraphNode] = Field(default_factory=list)
    edges: list[ImpactGraphEdge] = Field(default_factory=list)
    generated_at: datetime


__all__ = [
    "AgentAssignmentPlan",
    "AgentAssignmentStep",
    "ApprovalAssignRequest",
    "ApprovalDecisionRequest",
    "ApprovalDelegateRequest",
    "ApprovalItemCreate",
    "ApprovalItemRead",
    "ApprovalQueueResponse",
    "ArchPreviewComponent",
    "ArchPreviewIntegration",
    "ArchPreviewRead",
    "EntityExtraction",
    "HumanScoreOverride",
    "IdeaArtifactAttach",
    "IdeaCreate",
    "IdeaGraphRead",
    "IdeaListResponse",
    "IdeaRead",
    "IdeaUpdate",
    "IdeaValidationResult",
    "IdeaAnalysisRead",
    "ImpactComparison",
    "ImpactComparisonEntry",
    "ImpactGraph",
    "ImpactGraphEdge",
    "ImpactGraphNode",
    "OpportunityScoreRead",
    "OutputBundleExportFormat",
    "OutputBundleRead",
    "PRDGenerateRequest",
    "PRDRead",
    "PRDSectionUpdate",
    "PushAllRequest",
    "PushHistoryResponse",
    "PushRecordRead",
    "PushResult",
    "PushToConfluenceRequest",
    "PushToJiraRequest",
    "RoadmapAddItem",
    "RoadmapCreate",
    "RoadmapItem",
    "RoadmapListResponse",
    "RoadmapRead",
    "RoadmapRemoveItem",
    "RoadmapUpdate",
    "WorkflowIntervention",
    "WorkflowSessionRead",
    "WorkflowStartRequest",
    "WorkflowStepRead",
]

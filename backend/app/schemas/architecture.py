"""Schemas for the Architecture Accelerator (F-301 + F-302 + F-303)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel

# ---------------------------------------------------------------------------
# ADR
# ---------------------------------------------------------------------------


class ADRCreateRequest(ForgeBaseModel):
    """Inputs for generating a new ADR (F-301)."""

    project_id: UUID
    title: str = Field(..., min_length=1, max_length=500)
    problem: str = Field(..., min_length=1)
    forces: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    related_adrs: list[str] = Field(default_factory=list)
    related_artifacts: list[str] = Field(default_factory=list)


class ADRSpec(ForgeBaseModel):
    title: str
    status: str
    context: str
    decision: str
    consequences: dict[str, Any] = Field(default_factory=dict)
    alternatives: list[dict[str, Any]] = Field(default_factory=list)
    related_adrs: list[str] = Field(default_factory=list)


class ADRResponse(ForgeBaseModel):
    id: UUID
    number: int
    title: str
    status: str
    context: str
    decision: str
    consequences: dict[str, Any] = Field(default_factory=dict)
    alternatives: list[dict[str, Any]] = Field(default_factory=list)
    related_adrs: list[str] = Field(default_factory=list)
    generated_by: str | None = None
    reviewed_by: str | None = None
    approved_by: UUID | None = None
    approved_at: datetime | None = None
    tenant_id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class ADRListResponse(ForgeBaseModel):
    items: list[ADRResponse]
    total: int = 0


class ADRSupersedeRequest(ForgeBaseModel):
    new_adr_id: UUID


class ADRLinksResponse(ForgeBaseModel):
    """Linked-count metadata for an ADR (Day-1 mock removal).

    Counts are derived from existing FK relationships in the ADR's
    project scope (tenant_id + project_id). Used by the Architecture
    Center `ADRWithMeta` projection to replace the previous mock
    `linkedTaskCount` / `linkedRiskCount` / `linkedApiCount` fields.
    """

    adr_id: UUID
    task_breakdown_count: int = 0
    risk_count: int = 0
    api_contract_count: int = 0


# ---------------------------------------------------------------------------
# API Contract
# ---------------------------------------------------------------------------


class APIContractCreateRequest(ForgeBaseModel):
    project_id: UUID
    description: str = Field(..., min_length=1)
    contract_type: str = Field(default="openapi", pattern="^(openapi|graphql|grpc)$")
    name: str | None = Field(default=None, max_length=200)


class APIContractResponse(ForgeBaseModel):
    id: UUID
    name: str
    version: str
    spec_type: str
    spec_content: dict[str, Any] = Field(default_factory=dict)
    status: str
    source_artifact_id: UUID | None = None
    generated_by: str | None = None
    approved_by: UUID | None = None
    tenant_id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class APIContractListResponse(ForgeBaseModel):
    items: list[APIContractResponse]
    total: int = 0


class APIContractValidationResponse(ForgeBaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Task Breakdown
# ---------------------------------------------------------------------------


class Task(ForgeBaseModel):
    id: str
    title: str
    description: str = ""
    estimate_hours: float = 0.0
    dependencies: list[str] = Field(default_factory=list)
    skills_required: list[str] = Field(default_factory=list)
    agents_suggested: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    status: str = "todo"


class TaskBreakdownResponse(ForgeBaseModel):
    id: UUID
    name: str
    parent_artifact_type: str
    parent_artifact_id: UUID
    tasks: list[Task] = Field(default_factory=list)
    total_estimate_hours: float = 0.0
    status: str
    generated_by: str | None = None
    tenant_id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class TaskBreakdownListResponse(ForgeBaseModel):
    items: list[TaskBreakdownResponse]
    total: int = 0


class TaskBreakdownCreateRequest(ForgeBaseModel):
    project_id: UUID
    source_type: str = Field(..., pattern="^(adr|api_contract|risk_register)$")
    source_id: UUID
    source_artifact_id: UUID | None = None


class TaskUpdateRequest(ForgeBaseModel):
    title: str | None = None
    description: str | None = None
    estimate_hours: float | None = Field(default=None, ge=0)
    dependencies: list[str] | None = None
    skills_required: list[str] | None = None
    agents_suggested: list[str] | None = None
    acceptance_criteria: list[str] | None = None
    status: str | None = None


# ---------------------------------------------------------------------------
# Risk Register (F-304)
# ---------------------------------------------------------------------------


RISK_CATEGORIES = {"technical", "security", "operational", "business", "compliance"}
RISK_STATUSES = {"open", "mitigating", "closed", "accepted"}


class RiskCreate(ForgeBaseModel):
    """Payload for adding a risk to a register."""

    title: str = Field(..., min_length=1, max_length=500)
    category: str = Field(..., pattern="^(technical|security|operational|business|compliance)$")
    likelihood: int = Field(..., ge=1, le=5)
    impact: int = Field(..., ge=1, le=5)
    mitigation: str = Field(default="")
    owner: str = Field(default="")
    status: str = Field(default="open", pattern="^(open|mitigating|closed|accepted)$")


class RiskResponse(ForgeBaseModel):
    id: str
    title: str
    category: str
    likelihood: int
    impact: int
    score: int
    mitigation: str = ""
    owner: str = ""
    status: str = "open"


class RiskUpdateRequest(ForgeBaseModel):
    """Partial update for a single risk inside a register."""

    title: str | None = Field(default=None, min_length=1, max_length=500)
    category: str | None = Field(
        default=None,
        pattern="^(technical|security|operational|business|compliance)$",
    )
    likelihood: int | None = Field(default=None, ge=1, le=5)
    impact: int | None = Field(default=None, ge=1, le=5)
    mitigation: str | None = None
    owner: str | None = None
    status: str | None = Field(
        default=None,
        pattern="^(open|mitigating|closed|accepted)$",
    )


class RiskRegisterCreateRequest(ForgeBaseModel):
    """Body for POST /risk-registers — derive a register from a source artifact."""

    source_type: str = Field(..., pattern="^(adr|breakdown|idea)$")
    source_id: UUID
    project_id: UUID | None = None
    name: str | None = Field(default=None, max_length=200)


class RiskRegisterResponse(ForgeBaseModel):
    id: UUID
    name: str
    risks: list[RiskResponse] = Field(default_factory=list)
    mitigation_strategy: str = ""
    status: str
    generated_by: str | None = None
    approved_by: UUID | None = None
    tenant_id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class RiskRegisterListResponse(ForgeBaseModel):
    items: list[RiskRegisterResponse]
    total: int = 0


# ---------------------------------------------------------------------------
# Architecture Approval Workflow (F-305)
# ---------------------------------------------------------------------------


APPROVAL_DECISIONS = {"approve", "deny"}


class ArchitectureApprovalRequest(ForgeBaseModel):
    """Body for POST /approvals — request review of an artifact."""

    artifact_type: str = Field(
        ...,
        pattern="^(adr|api_contract|task_breakdown|risk_register)$",
    )
    artifact_id: UUID
    project_id: UUID | None = None


class ArchitectureApprovalReviewer(ForgeBaseModel):
    role: str
    status: str = "pending"  # pending | approved | denied
    decided_by: str | None = None
    decided_at: datetime | None = None
    reason: str | None = None


class ArchitectureApprovalResponse(ForgeBaseModel):
    id: UUID
    artifact_type: str
    artifact_id: UUID
    requested_by: str
    required_reviewers: list[str] = Field(default_factory=list)
    reviewers: list[ArchitectureApprovalReviewer] = Field(default_factory=list)
    status: str
    decided_by: UUID | None = None
    decided_at: datetime | None = None
    reason: str | None = None
    tenant_id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class ArchitectureApprovalListResponse(ForgeBaseModel):
    items: list[ArchitectureApprovalResponse]
    total: int = 0


class ArchitectureApprovalDecisionRequest(ForgeBaseModel):
    decision: str = Field(..., pattern="^(approve|deny)$")
    reason: str = Field(default="", max_length=2000)
    reviewer_role: str | None = Field(
        default=None,
        description="Role to act as (forge-architect / forge-security). "
        "Defaults to the first pending reviewer if omitted.",
    )


__all__ = [
    "ADRCreateRequest",
    "ADRLinksResponse",
    "ADRListResponse",
    "ADRResponse",
    "ADRSupersedeRequest",
    "APIContractCreateRequest",
    "APIContractListResponse",
    "APIContractResponse",
    "APIContractValidationResponse",
    "ArchitectureApprovalDecisionRequest",
    "ArchitectureApprovalListResponse",
    "ArchitectureApprovalRequest",
    "ArchitectureApprovalResponse",
    "ArchitectureApprovalReviewer",
    "RiskCreate",
    "RiskRegisterCreateRequest",
    "RiskRegisterListResponse",
    "RiskRegisterResponse",
    "RiskResponse",
    "RiskUpdateRequest",
    "Task",
    "TaskBreakdownCreateRequest",
    "TaskBreakdownListResponse",
    "TaskBreakdownResponse",
    "TaskUpdateRequest",
    "ADRSpec",
]


# ---------------------------------------------------------------------------
# F-308 — Standards Attestation
# ---------------------------------------------------------------------------


class StandardCheckResponse(ForgeBaseModel):
    """One org-standard applicability + compliance check."""

    standard_id: UUID
    standard_name: str
    applicable: bool
    passed: bool
    reason: str = ""


class AttestationResponse(ForgeBaseModel):
    id: UUID
    artifact_type: str
    artifact_id: UUID
    tenant_id: UUID
    project_id: UUID
    attestor_id: UUID
    status: str
    checks: list[StandardCheckResponse] = Field(default_factory=list)
    reason: str | None = None
    attested_at: datetime
    revoked_at: datetime | None = None
    revoker_id: UUID | None = None
    revocation_reason: str | None = None


class AttestationListResponse(ForgeBaseModel):
    items: list[AttestationResponse]
    total: int = 0


class AttestationRequest(ForgeBaseModel):
    artifact_type: str = Field(..., min_length=1, max_length=64)
    artifact_id: UUID


class AttestationRevokeRequest(ForgeBaseModel):
    reason: str = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# F-309 — Context-Aware Generation
# ---------------------------------------------------------------------------


class GenerationContext(ForgeBaseModel):
    """Aggregated context used to ground a generation call."""

    standards: list[dict[str, Any]] = Field(default_factory=list)
    templates: list[dict[str, Any]] = Field(default_factory=list)
    prior_adrs: list[dict[str, Any]] = Field(default_factory=list)
    project_context: dict[str, Any] = Field(default_factory=dict)
    risk_register: list[dict[str, Any]] = Field(default_factory=list)


class ContextRef(ForgeBaseModel):
    """One provenance pointer for a generation."""

    context_type: str
    ref_id: str
    label: str = ""


class ContextUsageResponse(ForgeBaseModel):
    artifact_id: UUID
    artifact_type: str
    references: list[ContextRef] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# F-310 — Acceptance Criteria
# ---------------------------------------------------------------------------


class AcceptanceCriterion(ForgeBaseModel):
    id: str
    given: str
    when: str
    then: str
    priority: str = "medium"


class AcceptanceCriteriaResponse(ForgeBaseModel):
    id: UUID
    source_artifact_type: str
    source_artifact_id: UUID
    criteria: list[AcceptanceCriterion] = Field(default_factory=list)
    test_links: dict[str, str] = Field(default_factory=dict)
    tenant_id: UUID
    project_id: UUID
    created_at: datetime


class AcceptanceCriteriaGenerateRequest(ForgeBaseModel):
    artifact_type: str = Field(
        ...,
        pattern="^(adr|api_contract|task_breakdown)$",
    )
    artifact_id: UUID


class AcceptanceLinkTestRequest(ForgeBaseModel):
    test_id: str = Field(..., min_length=1)


class CoverageByArtifact(ForgeBaseModel):
    artifact_type: str
    artifact_id: UUID
    total_criteria: int = 0
    criteria_with_tests: int = 0
    coverage_pct: float = 0.0


class CoverageReportResponse(ForgeBaseModel):
    project_id: UUID
    total_criteria: int = 0
    criteria_with_tests: int = 0
    coverage_pct: float = 0.0
    by_artifact: list[CoverageByArtifact] = Field(default_factory=list)


class ValidationResultResponse(ForgeBaseModel):
    criteria_id: UUID
    code_artifact_id: UUID
    passed: bool
    matched_steps: list[str] = Field(default_factory=list)
    missing_steps: list[str] = Field(default_factory=list)
    notes: str = ""


# ---------------------------------------------------------------------------
# F-306 — Traceability Matrix
# ---------------------------------------------------------------------------


class TraceabilityNode(ForgeBaseModel):
    """One node in the traceability graph."""

    id: str
    artifact_type: str
    artifact_id: UUID | None = None
    label: str = ""
    layer: str = ""


class TraceabilityEdge(ForgeBaseModel):
    """One directed edge in the traceability graph."""

    source: str
    target: str
    relationship: str = "traces_to"


class TraceabilityMatrixResponse(ForgeBaseModel):
    tenant_id: UUID
    project_id: UUID
    nodes: list[TraceabilityNode] = Field(default_factory=list)
    edges: list[TraceabilityEdge] = Field(default_factory=list)
    stats: dict[str, Any] = Field(default_factory=dict)


class LineageGraphResponse(ForgeBaseModel):
    artifact_type: str
    artifact_id: UUID
    direction: str = "both"
    nodes: list[TraceabilityNode] = Field(default_factory=list)
    edges: list[TraceabilityEdge] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# F-307 — Architecture Versioning
# ---------------------------------------------------------------------------


class ArchitectureVersionResponse(ForgeBaseModel):
    id: UUID
    artifact_type: str
    artifact_id: UUID
    version_number: int
    content_hash: str
    snapshot_reason: str
    actor_id: UUID | None
    created_at: datetime
    tenant_id: UUID
    project_id: UUID


class ArchitectureVersionListResponse(ForgeBaseModel):
    items: list[ArchitectureVersionResponse] = Field(default_factory=list)
    total: int = 0


class ArchitectureDiffResponse(ForgeBaseModel):
    added: list[Any] = Field(default_factory=list)
    removed: list[Any] = Field(default_factory=list)
    modified: list[Any] = Field(default_factory=list)


# Re-export TenantScopedModel to keep the public surface explicit for
# downstream consumers that import the schema module directly.
_ = TenantScopedModel

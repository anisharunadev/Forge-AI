"""MigrationPlan typed artifact schema (F-601).

The Refactor Agent produces a ``MigrationPlan`` as its primary typed
artifact (Rule 4). It is the canonical output of the sub-graph and
gets persisted through the F-010 artifact registry.

This module is the Pydantic v2 schema definition; the runtime node
constructs :class:`MigrationPlan` instances and the schema is what
the F-010 registry stores and the API surfaces.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import ConfigDict, Field, model_validator

from app.schemas.common import ForgeBaseModel


class MigrationPhaseStatus(str, Enum):
    """Lifecycle state of a single :class:`MigrationPhase`."""

    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    BLOCKED = "blocked"
    DEFERRED = "deferred"


class MigrationPhase(ForgeBaseModel):
    """A single phase of a phased migration plan.

    Each phase is independently shippable: it has a clear scope, a set
    of files/services it touches, an effort estimate, and explicit
    prerequisites so downstream agents (e.g. F-401 implementation)
    can plan sprint-sized work against it.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    order: int = Field(..., ge=0, le=1_000)
    name: str = Field(..., min_length=3, max_length=200)
    description: str = Field(..., min_length=10, max_length=10_000)
    status: MigrationPhaseStatus = MigrationPhaseStatus.PLANNED

    # Files / services in scope.
    scope_files: list[str] = Field(default_factory=list, max_length=10_000)
    scope_services: list[str] = Field(default_factory=list, max_length=1_000)

    # Effort / cost estimates (sprint-sized).
    estimated_effort_days: float = Field(..., ge=0.0, le=10_000.0)
    estimated_cost_usd: float = Field(default=0.0, ge=0.0)

    # Dependencies on earlier phases.
    prerequisites: list[str] = Field(default_factory=list, max_length=500)

    # Acceptance criteria for this phase.
    acceptance_criteria: list[str] = Field(default_factory=list, max_length=100)

    # Migration strategy at this phase (strangler, big-bang, parallel, ...).
    strategy: str = Field(default="strangler", min_length=1, max_length=64)

    metadata: dict[str, Any] = Field(default_factory=dict)


class RiskItem(ForgeBaseModel):
    """A single risk entry in the migration risk register."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str = Field(..., min_length=3, max_length=200)
    description: str = Field(..., min_length=10, max_length=10_000)

    # Likelihood / impact in [0.0, 1.0].
    likelihood: float = Field(..., ge=0.0, le=1.0)
    impact: float = Field(..., ge=0.0, le=1.0)

    # Severity score = likelihood * impact, stored for sorting.
    # Auto-computed when not provided so callers can pass L+I only.
    severity: float = Field(default=0.0, ge=0.0, le=1.0)

    # Mitigation plan + owner.
    mitigation: str = Field(default="", max_length=10_000)
    owner: str | None = None

    # Optional link back to a phase that mitigates this risk.
    mitigated_by_phase_id: str | None = None

    tags: list[str] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def _compute_severity(self) -> RiskItem:
        """Auto-compute severity = likelihood * impact when caller didn't set it."""
        if not self.severity:
            object.__setattr__(self, "severity", self.likelihood * self.impact)
        return self


class SourceInventory(ForgeBaseModel):
    """Typed inventory of the source repository/system to refactor."""

    model_config = ConfigDict(extra="forbid")

    language: str = Field(..., min_length=1, max_length=64)
    framework: str | None = Field(default=None, max_length=128)
    total_files: int = Field(default=0, ge=0)
    total_lines_of_code: int = Field(default=0, ge=0)
    components: list[dict[str, Any]] = Field(default_factory=list, max_length=10_000)
    external_dependencies: list[str] = Field(default_factory=list, max_length=10_000)
    data_stores: list[str] = Field(default_factory=list, max_length=1_000)
    apis: list[dict[str, Any]] = Field(default_factory=list, max_length=10_000)
    repository_url: str | None = None

    # AWS Transform job that produced this inventory, if any.
    aws_transform_job_id: str | None = None
    inventory_generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class TargetArchitecture(ForgeBaseModel):
    """Typed description of the target architecture for migration."""

    model_config = ConfigDict(extra="forbid")

    target_language: str = Field(..., min_length=1, max_length=64)
    target_framework: str | None = Field(default=None, max_length=128)
    target_cloud: str = Field(default="aws", min_length=1, max_length=64)
    components: list[dict[str, Any]] = Field(default_factory=list, max_length=10_000)
    integrations: list[dict[str, Any]] = Field(default_factory=list, max_length=10_000)
    data_stores: list[dict[str, Any]] = Field(default_factory=list, max_length=1_000)
    diagrams: list[str] = Field(default_factory=list, max_length=100)


class EffortEstimate(ForgeBaseModel):
    """Aggregate effort estimate across the whole migration."""

    model_config = ConfigDict(extra="forbid")

    total_effort_days: float = Field(..., ge=0.0)
    total_cost_usd: float = Field(default=0.0, ge=0.0)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    assumptions: list[str] = Field(default_factory=list, max_length=100)


class MigrationPlan(ForgeBaseModel):
    """The typed migration-plan artifact produced by the Refactor Agent.

    This is the canonical output of the F-601 sub-graph. It is
    persisted via the F-010 artifact registry under the type
    ``migration_plan`` and surfaces in the Refactor Center UI.

    Rule 2 compliance: every instance carries ``tenant_id`` and
    ``project_id`` so the artifact is correctly scoped across the
    multi-tenant registry.
    """

    model_config = ConfigDict(extra="forbid")

    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    project_id: UUID

    source_inventory: SourceInventory
    target_architecture: TargetArchitecture

    phased_plan: list[MigrationPhase] = Field(..., min_length=1, max_length=100)
    risk_register: list[RiskItem] = Field(default_factory=list, max_length=500)

    effort_estimate: EffortEstimate
    dependencies: list[str] = Field(default_factory=list, max_length=500)

    generated_by: str = "refactor_agent"
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    metadata: dict[str, Any] = Field(default_factory=dict)

    def severity_sorted_risks(self) -> list[RiskItem]:
        """Return risks ordered by descending severity."""
        return sorted(self.risk_register, key=lambda r: r.severity, reverse=True)

    def phase_ids(self) -> list[str]:
        """Return the ordered list of phase ids."""
        return [p.id for p in self.phased_plan]

    def to_payload(self) -> dict[str, Any]:
        """Dump to a JSON-safe dict for the artifact registry."""
        return self.model_dump(mode="json")


__all__ = [
    "MigrationPhase",
    "MigrationPhaseStatus",
    "RiskItem",
    "SourceInventory",
    "TargetArchitecture",
    "EffortEstimate",
    "MigrationPlan",
]

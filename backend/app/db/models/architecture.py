"""Architecture Accelerator models (F-301 + F-302 + F-303).

Five tables backing the Architecture Accelerator:
- ADR (Architecture Decision Records, MADR format)
- APIContract (OpenAPI / GraphQL / gRPC specs)
- TaskBreakdown (decomposed implementation tasks)
- RiskRegister (project risk ledger)
- ArchitectureApproval (human gate for promotion)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
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


class ADR(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """Architecture Decision Record (MADR format)."""

    __tablename__ = "architecture_adrs"

    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="proposed")
    context: Mapped[str] = mapped_column(Text, nullable=False, default="")
    decision: Mapped[str] = mapped_column(Text, nullable=False, default="")
    consequences: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    alternatives: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    related_adrs: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    generated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    component: Mapped[str | None] = mapped_column(String(32), nullable=True, default="backend")
    impact: Mapped[int | None] = mapped_column(Integer, nullable=True, default=5)

    __table_args__ = (
        Index(
            "ix_architecture_adrs_tenant_project_status",
            "tenant_id",
            "project_id",
            "status",
        ),
        Index(
            "uq_architecture_adrs_tenant_project_number",
            "tenant_id",
            "project_id",
            "number",
            unique=True,
        ),
    )


class APIContract(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """Generated API contract (OpenAPI 3.0 / GraphQL SDL / gRPC proto)."""

    __tablename__ = "architecture_api_contracts"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False, default="0.1.0")
    spec_type: Mapped[str] = mapped_column(String(32), nullable=False)
    spec_content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    source_artifact_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("artifacts.id", ondelete="SET NULL"), nullable=True
    )
    generated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)

    __table_args__ = (
        Index(
            "ix_architecture_api_contracts_tenant_project_status",
            "tenant_id",
            "project_id",
            "status",
        ),
    )


class TaskBreakdown(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """Decomposed implementation tasks derived from an ADR / contract."""

    __tablename__ = "architecture_task_breakdowns"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_artifact_type: Mapped[str] = mapped_column(String(64), nullable=False)
    parent_artifact_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    tasks: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    total_estimate_hours: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    generated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index(
            "ix_architecture_task_breakdowns_tenant_project_status",
            "tenant_id",
            "project_id",
            "status",
        ),
    )


class RiskRegister(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """Project risk ledger generated alongside ADRs."""

    __tablename__ = "architecture_risk_registers"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    risks: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    mitigation_strategy: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    generated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)

    __table_args__ = (
        Index(
            "ix_architecture_risk_registers_tenant_project_status",
            "tenant_id",
            "project_id",
            "status",
        ),
    )


class ArchitectureApproval(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Human gate for promoting an architecture artifact.

    `tenant_id` and `project_id` are required (Rule 2). The model
    intentionally does NOT use TenantScopedMixin because the primary
    lookup is by artifact id; the audit query layer joins via the
    artifact's tenant.
    """

    __tablename__ = "architecture_approvals"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    artifact_type: Mapped[str] = mapped_column(String(64), nullable=False)
    artifact_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    requested_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    decided_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "ix_architecture_approvals_tenant_project_status",
            "tenant_id",
            "project_id",
            "status",
        ),
    )


class ArchitectureVersionRow(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """Append-only version snapshot of an architecture artifact.

    Day 1 mock-removal track E: replaces the previous Python dataclass
    ``ArchitectureVersion`` (which had no DB backing and therefore
    ``list_versions`` always returned ``[]``).
    """

    __tablename__ = "architecture_versions"

    artifact_type: Mapped[str] = mapped_column(String(64), nullable=False)
    artifact_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    snapshot_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)

    __table_args__ = (
        Index(
            "ix_architecture_versions_tenant_project_artifact",
            "tenant_id",
            "project_id",
            "artifact_type",
            "artifact_id",
        ),
        Index(
            "ix_architecture_versions_tenant_project_created",
            "tenant_id",
            "project_id",
            "created_at",
        ),
    )


__all__ = [
    "ADR",
    "APIContract",
    "ArchitectureApproval",
    "ArchitectureVersionRow",
    "RiskRegister",
    "TaskBreakdown",
]

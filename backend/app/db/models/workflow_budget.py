"""WorkflowBudget — fixed-budget execution guard (NFR-044).

Persists the per-workflow ceiling and accumulated spend so admission
control at the LiteLLM boundary (NFR-030) can block calls that would
push the run past its declared ceiling.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Enum as SAEnum, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class WorkflowBudgetStatus(str, Enum):
    """Lifecycle of a workflow budget.

    ACTIVE: spend is below ceiling, calls admitted.
    EXHAUSTED: spend is at or above ceiling, calls blocked.
    CLOSED: workflow completed and budget is sealed.
    """

    ACTIVE = "active"
    EXHAUSTED = "exhausted"
    CLOSED = "closed"


class WorkflowBudget(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One row per workflow that declares a fixed USD ceiling.

    `ceiling_usd` is the immutable ceiling for the workflow.
    `spent_usd` is the running total; it advances only after a
    successful admission + completion (see `app.services.workflow_budget`).
    """

    __tablename__ = "workflow_budgets"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    workflow_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, unique=True)
    ceiling_usd: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False)
    spent_usd: Mapped[float] = mapped_column(
        Numeric(18, 8), nullable=False, default=0
    )
    status: Mapped[WorkflowBudgetStatus] = mapped_column(
        SAEnum(WorkflowBudgetStatus, name="workflow_budget_status"),
        nullable=False,
        default=WorkflowBudgetStatus.ACTIVE,
    )
    declared_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    declared_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )

    __table_args__ = (
        Index(
            "ix_workflow_budgets_tenant_project",
            "tenant_id",
            "project_id",
        ),
    )


class WorkflowBudgetDecision(Base, UUIDPrimaryKeyMixin):
    """Append-only audit row for every admission decision (Rule 6)."""

    __tablename__ = "workflow_budget_decisions"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    workflow_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    decision: Mapped[str] = mapped_column(String(32), nullable=False)
    projected_cost_usd: Mapped[float] = mapped_column(
        Numeric(18, 8), nullable=False
    )
    spent_usd: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False)
    ceiling_usd: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    __table_args__ = (
        Index(
            "ix_workflow_budget_decisions_workflow",
            "workflow_id",
            "occurred_at",
        ),
    )


__all__ = [
    "WorkflowBudget",
    "WorkflowBudgetDecision",
    "WorkflowBudgetStatus",
]
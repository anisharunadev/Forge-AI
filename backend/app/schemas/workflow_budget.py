"""Schemas for NFR-044 — Workflow Budget endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.workflow_budget import WorkflowBudgetStatus
from app.schemas.common import ForgeBaseModel


class BudgetDeclareRequest(ForgeBaseModel):
    workflow_id: UUID
    ceiling_usd: float = Field(..., gt=0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BudgetRead(ForgeBaseModel):
    workflow_id: UUID
    ceiling_usd: float
    spent_usd: float
    remaining_usd: float
    status: WorkflowBudgetStatus
    headroom_pct: float | None = None


class BudgetDecisionRead(ForgeBaseModel):
    decision: str
    projected_cost_usd: float
    spent_usd: float
    ceiling_usd: float
    actor_id: UUID | None = None
    reason: str | None = None
    occurred_at: datetime


__all__ = [
    "BudgetDeclareRequest",
    "BudgetRead",
    "BudgetDecisionRead",
]

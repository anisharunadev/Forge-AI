"""Schemas for Step 75 P3 — Spend Aggregation write-path."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.schemas.common import ForgeBaseModel


class SpendRecord(ForgeBaseModel):
    id: UUID
    tenant_id: UUID
    project_id: UUID
    agent_id: UUID
    user_id: UUID
    team_id: UUID | None = None
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    litellm_request_id: str
    reconciled_at: datetime | None = None
    created_at: datetime


class SpendByModel(ForgeBaseModel):
    model: str
    cost_usd: float
    requests: int
    prompt_tokens: int
    completion_tokens: int


class SpendByAgent(ForgeBaseModel):
    agent_id: UUID
    agent_name: str | None = None
    cost_usd: float
    requests: int


class SpendByUser(ForgeBaseModel):
    user_id: UUID
    cost_usd: float
    requests: int


class SpendByTenant(ForgeBaseModel):
    tenant_id: UUID
    cost_usd: float
    requests: int


class SpendSummary(ForgeBaseModel):
    period_start: datetime
    period_end: datetime
    total_cost_usd: float
    total_requests: int
    total_tokens: int
    by_model: list[SpendByModel]


class CostMeterEntry(ForgeBaseModel):
    run_id: UUID
    agent_id: UUID
    cost_usd: float
    tokens: int
    model: str
    timestamp: datetime


class BackfillRequest(ForgeBaseModel):
    since: datetime
    dry_run: bool = False


class BackfillResponse(ForgeBaseModel):
    rows_upserted: int
    rows_inserted: int
    drift_count: int
    dry_run: bool


class DriftEvent(ForgeBaseModel):
    row_id: UUID
    forge_cost_usd: float
    litellm_cost_usd: float
    drift_pct: float


__all__ = [
    "SpendRecord",
    "SpendSummary",
    "SpendByModel",
    "SpendByAgent",
    "SpendByUser",
    "SpendByTenant",
    "CostMeterEntry",
    "BackfillRequest",
    "BackfillResponse",
    "DriftEvent",
]

"""F-014 — Dashboard aggregation schemas (step-57).

Pydantic v2 source of truth for the dashboard endpoints. The frontend
mirror in `apps/forge/lib/api/dashboard.ts` must be updated in lock-step
when these change.

All payloads are tenant-scoped (Rule 2). The endpoints project the
underlying entities into a flat shape the UI can render directly.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel

# ---------------------------------------------------------------------------
# KPI aggregation
# ---------------------------------------------------------------------------


class RunsByDayPoint(ForgeBaseModel):
    date: str
    count: int
    success: int
    failed: int


class CostByDayPoint(ForgeBaseModel):
    date: str
    amount: float


class CostByModelRow(ForgeBaseModel):
    model: str
    amount: float
    tokens: int


class TopAgentRow(ForgeBaseModel):
    id: str
    name: str
    runs: int
    success_rate: float


class TopWorkflowRow(ForgeBaseModel):
    id: str
    name: str
    runs: int
    avg_duration: float


class TopProviderRow(ForgeBaseModel):
    """Top performing model provider for the dashboard widget.

    Mirrors the real LLM-call volume (LiteLLM proxy traffic) joined
    against the provider registry so the UI gets a human-readable
    name alongside the model alias. Source-of-truth: see
    `dashboard_service.compute_top_providers`.
    """

    model: str
    provider_id: str | None = None
    provider_name: str
    provider_type: str | None = None
    run_count: int
    total_cost: float
    avg_duration_seconds: float
    success_rate: float  # 0..100
    enabled: bool = True


class DashboardKPIs(ForgeBaseModel):
    # Agent metrics
    active_agents: int
    total_agents: int

    # Run metrics
    runs_today: int
    runs_yesterday: int
    runs_this_week: int
    success_rate: float
    avg_duration_seconds: float

    # LLM metrics
    total_cost_today: float
    daily_cost_cap: float
    total_tokens_today: int
    input_tokens_today: int
    output_tokens_today: int

    # Approval metrics
    pending_approvals: int
    critical_approvals: int

    # Idea metrics
    ideas_this_week: int
    ideas_scored: int

    # Time-series
    runs_by_day: list[RunsByDayPoint]
    cost_by_day: list[CostByDayPoint]
    cost_by_model: list[CostByModelRow]

    # Top lists
    top_agents: list[TopAgentRow]
    top_workflows: list[TopWorkflowRow]

    generated_at: datetime


# ---------------------------------------------------------------------------
# Team activity feed
# ---------------------------------------------------------------------------

ActivityTargetType = Literal[
    "workflow",
    "run",
    "agent",
    "adr",
    "idea",
    "story",
    "ticket",
    "commit",
]


class TeamActivity(ForgeBaseModel):
    id: str
    tenant_id: UUID
    actor_id: UUID | None = None
    actor_name: str
    actor_avatar_url: str | None = None
    action: str
    target_type: ActivityTargetType
    target_id: str | None = None
    target_name: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


# ---------------------------------------------------------------------------
# Pinned items
# ---------------------------------------------------------------------------

PinnedItemType = Literal["agent", "workflow", "command", "page", "ticket", "idea"]


class PinnedItemRead(ForgeBaseModel):
    id: UUID
    user_id: UUID
    item_type: PinnedItemType
    item_id: str
    item_data: dict[str, Any] = Field(default_factory=dict)
    sort_order: int
    created_at: datetime


class PinnedItemCreate(ForgeBaseModel):
    item_type: PinnedItemType
    item_id: str
    item_data: dict[str, Any] = Field(default_factory=dict)
    sort_order: int | None = None


class PinnedItemReorder(ForgeBaseModel):
    items: list[dict[str, Any]] = Field(
        ...,
        description="List of {id: UUID, sort_order: int} updates.",
    )


# ---------------------------------------------------------------------------
# AI insights
# ---------------------------------------------------------------------------

AIInsightCategory = Literal["trend", "anomaly", "opportunity", "risk", "tip"]
AIInsightSeverity = Literal["info", "warning", "critical"]


class AIInsightRead(ForgeBaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID | None = None
    title: str
    body: str
    category: AIInsightCategory
    severity: AIInsightSeverity
    related_entities: list[dict[str, Any]] = Field(default_factory=list)
    action_url: str | None = None
    action_label: str | None = None
    created_at: datetime
    read_at: datetime | None = None


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

AlertType = Literal["cost", "failure", "approval", "sync", "security", "compliance"]
AlertSeverity = Literal["info", "warning", "critical"]
AlertSourceType = Literal["workflow", "agent", "run", "connector", "policy"]


class AlertRead(ForgeBaseModel):
    id: UUID
    tenant_id: UUID
    type: AlertType
    severity: AlertSeverity
    title: str
    body: str
    source_type: AlertSourceType
    source_id: str | None = None
    source_name: str | None = None
    action_required: bool
    action_url: str | None = None
    action_label: str | None = None
    created_at: datetime
    read_at: datetime | None = None
    resolved_at: datetime | None = None


# ---------------------------------------------------------------------------
# Dashboard layout
# ---------------------------------------------------------------------------

DashboardWidgetType = Literal[
    "kpi_strip",
    "live_activity",
    "your_agents",
    "todays_runs",
    "cost_breakdown",
    "runs_overtime",
    "top_agents",
    "pending_approvals",
    "recent_ideas",
    "ai_insights",
    "personal_stats",
    "pinned",
    "quick_actions",
    "team_activity",
    "recent_alerts",
]

DashboardPreset = Literal["engineering_lead", "product_manager", "operator", "custom"]


class DashboardWidget(ForgeBaseModel):
    id: UUID
    user_id: UUID
    type: DashboardWidgetType
    enabled: bool
    position: int
    config: dict[str, Any] = Field(default_factory=dict)


class DashboardLayout(ForgeBaseModel):
    user_id: UUID
    widgets: list[DashboardWidget]
    preset: DashboardPreset
    updated_at: datetime


__all__ = [
    "DashboardKPIs",
    "RunsByDayPoint",
    "CostByDayPoint",
    "CostByModelRow",
    "TopAgentRow",
    "TopWorkflowRow",
    "TopProviderRow",
    "TeamActivity",
    "PinnedItemRead",
    "PinnedItemCreate",
    "PinnedItemReorder",
    "AIInsightRead",
    "DashboardWidget",
    "DashboardLayout",
    "AlertRead",
]

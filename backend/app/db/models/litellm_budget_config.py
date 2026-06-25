"""F-829c — Per-tenant budget configuration mirror.

LiteLLM is the source of truth for budget enforcement (we delegate
to its Budgets API), but we mirror the configuration here so that
:mod:`app.services.workflow_budget` and the UI can read it without a
round-trip to the proxy. The actual blocking still happens in
LiteLLM — this is a cache, not a control plane.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID

from sqlalchemy import DateTime, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, TimestampMixin, UUIDPrimaryKeyMixin


class LiteLLMBudgetPeriod(str, Enum):
    """LiteLLM budget reset period."""

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class LiteLLMBudgetConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Mirrored budget configuration for a tenant.

    `litellm_budget_id` is the id LiteLLM returned when the budget was
    created. The actual enforcement happens in LiteLLM; this row is
    the read-side cache.
    """

    __tablename__ = "litellm_budget_configs"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    litellm_team_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    litellm_budget_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    max_usd: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    period: Mapped[str] = mapped_column(String(16), nullable=False, default="monthly")
    hard_limit: Mapped[bool] = mapped_column(default=True, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index(
            "uq_litellm_budget_configs_tenant",
            "tenant_id",
            unique=True,
        ),
    )


__all__ = ["LiteLLMBudgetConfig", "LiteLLMBudgetPeriod"]

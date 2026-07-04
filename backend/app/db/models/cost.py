"""CostEntry — append-only ledger of LLM + tool spend (DL-027)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class CostEntry(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One row per cost-incurring event.

    `source` distinguishes LLM traffic (`litellm`), tool calls
    (`terminal`, `connector`), or human-billed services (`manual`).
    `cost_usd` is computed at the source to keep reporting
    deterministic — agents cannot self-report with arbitrary numbers.

    ADR-009 columns (M2 T-B2):
    - ``run_id`` binds the row to the SDLC run so the cumulative cap
      rule can sum confirmed spend per run. Nullable so legacy tool /
      connector rows continue to insert cleanly.
    - ``agent`` names the agent that incurred the spend. Nullable so
      non-agent call sites (terminal cost, manual) keep working.
    - ``projected`` distinguishes a pre-call projection from a
      post-call actual settlement. The cumulative cap rule
      (``sum(cost_usd WHERE run_id=X AND projected=false)``)
      filters on this column so over-reserved headroom never
      silently consumes the budget.
    """

    __tablename__ = "cost_entries"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    workflow_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    run_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    agent: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False)
    projected: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )

    __table_args__ = (
        Index("ix_cost_tenant_recorded", "tenant_id", "recorded_at"),
        Index("ix_cost_project_recorded", "project_id", "recorded_at"),
        Index("ix_cost_tenant_model", "tenant_id", "model"),
        Index("ix_cost_run_projected", "run_id", "projected"),
    )


__all__ = ["CostEntry"]

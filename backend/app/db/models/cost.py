"""CostEntry — append-only ledger of LLM + tool spend (DL-027)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class CostEntry(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One row per cost-incurring event.

    `source` distinguishes LLM traffic (`litellm`), tool calls
    (`terminal`, `connector`), or human-billed services (`manual`).
    `cost_usd` is computed at the source to keep reporting
    deterministic — agents cannot self-report with arbitrary numbers.
    """

    __tablename__ = "cost_entries"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    workflow_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False)
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
    )


__all__ = ["CostEntry"]

"""Phase 5 -- per-tenant per-minute cost rollup table.

Filled by the ``cost_aggregate`` scheduler job from LiteLLM spend
logs. Read by ``GET /v1/observability/cost`` for the cost dashboard
in the admin UI. The unique index on ``(tenant_id, minute)`` makes
the upsert safe to re-run on a partially-written row.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CostMinuteRollup(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "cost_minute_rollup"
    __table_args__ = (
        UniqueConstraint("tenant_id", "minute", name="uq_cost_rollup_tenant_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    minute: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    spend_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

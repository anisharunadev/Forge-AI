"""F15 — AlertConfig: per-tenant budget thresholds.

Step-78 F15 wires the cost-alert dashboard (spec line 632). One row
per tenant; ``warn_pct`` / ``exceed_pct`` are integers in [0, 100].
``channels`` is a JSONB list of delivery channels (``email``, ``slack``).

Rule 2: composite index on ``(tenant_id, ...)`` so the alert reader
path stays a single-index probe.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Index, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class AlertConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One row per tenant — the budget alert threshold configuration."""

    __tablename__ = "alert_configs"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, unique=True, index=True)
    warn_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=80, server_default="80")
    exceed_pct: Mapped[int] = mapped_column(
        Integer, nullable=False, default=95, server_default="95"
    )
    channels: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (Index("ix_alert_configs_tenant_warn", "tenant_id", "warn_pct"),)

    __mapper_args__ = {"eager_defaults": True}


__all__ = ["AlertConfig"]

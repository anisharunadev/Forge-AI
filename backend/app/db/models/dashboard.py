"""F-014 — Dashboard persistence models (step-57).

Lightweight per-user tables for dashboard personalization: pinned items,
AI insight read state, and dashboard layout. KPI / activity / alert
data are computed on demand from existing tables (audit_events,
run_records, etc.) — they do not get their own table.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, UUIDPrimaryKeyMixin


class PinnedItem(Base, UUIDPrimaryKeyMixin):
    """A user-pinned shortcut surfaced on the dashboard.

    `item_data` is the denormalized display payload (icon, label, href)
    so the UI can render without a second round-trip. We never store
    secrets here — only the metadata needed to render the tile.
    """

    __tablename__ = "dashboard_pinned_items"

    user_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    item_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(128), nullable=False)
    item_data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AIInsightRead(Base, UUIDPrimaryKeyMixin):
    """Per-user read state for an AI insight.

    The insight itself is stored in a shared per-tenant table; this
    table only tracks "user X read insight Y at time Z".
    """

    __tablename__ = "dashboard_insight_reads"

    user_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    insight_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    _audit_scope = "global"


class AIInsight(Base, UUIDPrimaryKeyMixin):
    """Server-generated proactive insight (F-014 / step-57).

    `related_entities` is a JSON list of {type, id} so the insight can
    be cross-linked to agents, runs, workflows, or ideas without a
    polymorphic FK.
    """

    __tablename__ = "dashboard_insights"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    user_id: Mapped[UUID | None] = mapped_column(
        GUID(),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    body: Mapped[str] = mapped_column(String(2048), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="info")
    related_entities: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    action_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    action_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DashboardLayoutRow(Base, UUIDPrimaryKeyMixin):
    """Per-user dashboard layout — the canonical widget grid.

    `widgets` is a JSON list of {id, type, enabled, position, config}
    rows. We store as JSON rather than a child table because widget
    metadata is small and the read pattern is "load the whole layout at
    once".
    """

    __tablename__ = "dashboard_layouts"

    user_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, unique=True, index=True)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    widgets: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    preset: Mapped[str] = mapped_column(String(32), nullable=False, default="custom")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


__all__ = [
    "PinnedItem",
    "AIInsight",
    "AIInsightRead",
    "DashboardLayoutRow",
]

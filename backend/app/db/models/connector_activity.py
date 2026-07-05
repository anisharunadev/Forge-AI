"""Connector Activity log model (M3 — Gap M3-G1).

Append-only log of activity events across all connectors in a tenant.
The Activity tab in the Connector Center reads from this table; the
disconnect endpoint writes a row; the OAuth callback writes a row; the
seed package inserts historical events to populate the UI.

The schema is intentionally broad so the same table backs all event
categories (sync / webhook / test / install / disconnect / error /
reveal / rotate) without needing a per-kind table fan-out. Event kind
is captured in :attr:`event_type`; outcome in :attr:`status`.

Per Rule 2 every row carries ``tenant_id``. The Connector Center UI is
tenant-scoped (no project pivot), so ``project_id`` is also carried
but indexed (not unique-with-tenant).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


# String values used for the SAEnum columns — kept in sync with the
# Literal types in ``app.schemas.connector_activity``.
_EVENT_TYPES = (
    "sync",
    "webhook",
    "test",
    "install",
    "disconnect",
    "error",
    "reveal",
    "rotate",
)
_STATUSES = (
    "success",
    "failed",
    "partial",
    "in_progress",
)


class ConnectorActivity(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One row per notable connector-side action.

    ``event_metadata`` is named with the trailing underscore on the ORM
    column to avoid clashing with the SQLAlchemy ``Base.metadata`` class
    attribute — at the wire / schema layer the field is exposed as
    ``metadata`` (see :class:`app.schemas.connector_activity.ConnectorSyncEventRead`).
    """

    __tablename__ = "connector_activity"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    connector_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("connectors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(
        SAEnum(*_EVENT_TYPES, name="connector_activity_event_type"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        SAEnum(*_STATUSES, name="connector_activity_status"),
        nullable=False,
        default="in_progress",
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    records_affected: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )  # noqa: A003 — see module docstring re: Base.metadata clash

    __table_args__ = (
        Index("ix_connector_activity_tenant_started", "tenant_id", "started_at"),
        Index(
            "ix_connector_activity_connector_started", "connector_id", "started_at"
        ),
    )


__all__ = ["ConnectorActivity"]

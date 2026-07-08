"""Webhook model + delivery audit (Step 55).

A :class:`Webhook` is an inbound or outbound HTTP subscription attached
to a tenant. The :class:`WebhookDelivery` table is an append-only audit
log of every delivery attempt so the Webhooks tab can show a delivery
timeline without re-hitting the upstream provider.
"""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class WebhookDirection(enum.StrEnum):
    """Inbound (Forge receives) vs outbound (Forge sends)."""

    INBOUND = "inbound"
    OUTBOUND = "outbound"


class WebhookAuthType(enum.StrEnum):
    """How the webhook authenticates."""

    NONE = "none"
    BASIC = "basic"
    BEARER = "bearer"
    HMAC = "hmac"
    SIGNATURE = "signature"


class WebhookStatus(enum.StrEnum):
    """Lifecycle of a webhook subscription."""

    ACTIVE = "active"
    PAUSED = "paused"
    FAILING = "failing"


class WebhookDeliveryStatus(enum.StrEnum):
    """Outcome of a single delivery attempt."""

    OK = "ok"
    ERROR = "error"
    PENDING = "pending"


class Webhook(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A webhook subscription."""

    __tablename__ = "webhooks"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    direction: Mapped[WebhookDirection] = mapped_column(
        SAEnum(WebhookDirection, name="webhook_direction"),
        nullable=False,
    )
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    events: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    # ponytail: project JSONB degrades to JSON on SQLite so test schema
    # builds; renders as PG_JSONB on Postgres so prod on-disk shape is
    # unchanged.
    auth_type: Mapped[WebhookAuthType] = mapped_column(
        SAEnum(WebhookAuthType, name="webhook_auth_type"),
        nullable=False,
        default=WebhookAuthType.NONE,
    )
    auth_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[WebhookStatus] = mapped_column(
        SAEnum(WebhookStatus, name="webhook_status"),
        nullable=False,
        default=WebhookStatus.ACTIVE,
    )
    last_triggered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_delivery_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    success_count_24h: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count_24h: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)

    __table_args__ = (
        Index("ix_webhooks_tenant_project", "tenant_id", "project_id"),
        Index("ix_webhook_tenant_status", "tenant_id", "status"),
        Index("ix_webhook_tenant_direction", "tenant_id", "direction"),
    )


class WebhookDelivery(Base, UUIDPrimaryKeyMixin):
    """One delivery attempt against a webhook subscription."""

    __tablename__ = "webhook_deliveries"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    webhook_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("webhooks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[WebhookDeliveryStatus] = mapped_column(
        SAEnum(WebhookDeliveryStatus, name="webhook_delivery_status"),
        nullable=False,
        default=WebhookDeliveryStatus.PENDING,
    )
    response_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_preview: Mapped[str] = mapped_column(Text, nullable=False, default="")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_webhook_deliveries_tenant_project", "tenant_id", "project_id"),
        Index(
            "ix_webhook_delivery_webhook_attempted",
            "webhook_id",
            "attempted_at",
        ),
    )


__all__ = [
    "Webhook",
    "WebhookAuthType",
    "WebhookDelivery",
    "WebhookDeliveryStatus",
    "WebhookDirection",
    "WebhookStatus",
]

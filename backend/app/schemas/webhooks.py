"""Schemas for F-007 Webhook subscriptions + delivery audit (Step 55)."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.webhook import (
    WebhookAuthType,
    WebhookDeliveryStatus,
    WebhookDirection,
    WebhookStatus,
)
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class WebhookCreate(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    direction: WebhookDirection
    url: str | None = Field(default=None, max_length=500)
    events: list[str] = Field(default_factory=list)
    auth_type: WebhookAuthType = WebhookAuthType.NONE
    auth_secret: str | None = None


class WebhookRead(TenantScopedModel):
    id: UUID
    name: str
    direction: WebhookDirection
    url: str | None
    events: list[str]
    auth_type: WebhookAuthType
    status: WebhookStatus
    last_triggered_at: datetime | None
    last_delivery_status: str | None
    success_count_24h: int
    error_count_24h: int
    created_at: datetime


class WebhookDeliveryRead(TenantScopedModel):
    id: UUID
    webhook_id: UUID
    event: str
    status: WebhookDeliveryStatus
    response_code: int | None
    duration_ms: int
    attempted_at: datetime
    payload_preview: str
    error_message: str | None


class WebhookTestResult(ForgeBaseModel):
    """Outcome of a single test ping."""

    status: WebhookDeliveryStatus
    response_code: int
    message: str

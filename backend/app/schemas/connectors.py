"""Schemas for F-007 — Connectors."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.connector import ConnectorStatus, ConnectorType, SyncStatus
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class ConnectorBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    type: ConnectorType
    config: dict[str, Any] = Field(default_factory=dict)


class ConnectorCreate(ConnectorBase):
    project_id: UUID


class ConnectorUpdate(ForgeBaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    status: ConnectorStatus | None = None


class ConnectorRead(ConnectorBase, TenantScopedModel):
    id: UUID
    status: ConnectorStatus
    last_sync_at: datetime | None = None
    last_error: str | None = None
    created_by: UUID


class ConnectorSyncHistoryRead(ForgeBaseModel):
    id: UUID
    connector_id: UUID
    started_at: datetime
    finished_at: datetime | None = None
    status: SyncStatus
    items_synced: int
    error_message: str | None = None


class ConnectorTestResult(ForgeBaseModel):
    connector_id: UUID
    ok: bool
    latency_ms: float | None = None
    detail: str | None = None
    checked_at: datetime

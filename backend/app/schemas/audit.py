"""Schemas for F-005 — Audit read."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, Page


class AuditEventRead(ForgeBaseModel):
    id: UUID
    tenant_id: UUID
    project_id: UUID
    actor_id: UUID | None
    action: str
    target_type: str
    target_id: str
    payload: dict[str, Any]
    occurred_at: datetime


class AuditQueryParams(ForgeBaseModel):
    action: str | None = None
    target_type: str | None = None
    actor_id: UUID | None = None
    since: datetime | None = None
    until: datetime | None = None


AuditPage = Page[AuditEventRead]

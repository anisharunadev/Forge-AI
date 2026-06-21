"""Schemas for F-006 — Approvals."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.approval import ApprovalStatus
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class ApprovalCreate(ForgeBaseModel):
    type: str = Field(..., min_length=1, max_length=64)
    target_artifact_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class ApprovalDecision(ForgeBaseModel):
    status: ApprovalStatus
    reason: str | None = None


class ApprovalRead(TenantScopedModel):
    id: UUID
    type: str
    target_artifact_id: UUID | None
    requested_by: UUID
    status: ApprovalStatus
    decided_by: UUID | None
    decided_at: datetime | None
    reason: str | None
    payload: dict[str, Any]

"""Schemas for F-010 — Artifacts."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.artifact import ArtifactStatus
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class ArtifactBase(ForgeBaseModel):
    type: str = Field(..., min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)


class ArtifactCreate(ArtifactBase):
    pass


class ArtifactRead(ArtifactBase, TenantScopedModel):
    id: UUID
    version: int
    status: ArtifactStatus
    created_by: UUID
    superseded_by_id: UUID | None = None
    superseded_at: datetime | None = None
    content_hash: str

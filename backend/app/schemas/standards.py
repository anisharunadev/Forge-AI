"""Schemas for F-001 — Standards."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel


class StandardBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    status: str = Field(default="active", max_length=32)
    metadata: dict = Field(default_factory=dict)


class StandardCreate(StandardBase):
    project_id: UUID | None = Field(
        default=None,
        description="NULL means org-level; inherits to every project.",
    )


class StandardUpdate(ForgeBaseModel):
    name: str | None = None
    content: str | None = None
    status: str | None = None
    metadata: dict | None = None


class StandardRead(StandardBase, TenantScopedModel):
    id: UUID
    version: int

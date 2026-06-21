"""Schemas for F-002 — Templates."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel


class TemplateBase(ForgeBaseModel):
    type: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    content: dict[str, Any] = Field(default_factory=dict)
    variables: list[dict[str, Any]] = Field(default_factory=list)


class TemplateCreate(TemplateBase):
    project_id: UUID | None = None


class TemplateRead(TemplateBase, TenantScopedModel):
    id: UUID
    version: int

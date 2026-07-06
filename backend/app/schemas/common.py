"""Shared schemas: pagination, error envelopes, audit fields."""

from __future__ import annotations

from datetime import datetime
from typing import Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ForgeBaseModel(BaseModel):
    """Base Pydantic v2 model with ORM-mode mapping enabled."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class Page(ForgeBaseModel, Generic[T]):
    """Cursor/page envelope for list endpoints."""

    items: list[T]
    total: int = Field(default=0, ge=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=500)


class ErrorResponse(ForgeBaseModel):
    error: str
    detail: str | None = None
    request_id: str | None = None
    occurred_at: datetime


class IDModel(ForgeBaseModel):
    id: UUID


class TenantScopedModel(ForgeBaseModel):
    tenant_id: UUID
    project_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

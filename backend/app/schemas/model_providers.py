"""Schemas for F-012 — Model Provider Registry."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.model_provider import ModelProviderType
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class ModelProviderBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    type: ModelProviderType
    config: dict[str, Any] = Field(default_factory=dict)
    litellm_model_alias: str = Field(..., min_length=1, max_length=200)
    enabled: bool = True
    rate_limit_rpm: int = Field(default=0, ge=0)
    rate_limit_tpm: int = Field(default=0, ge=0)


class ModelProviderCreate(ModelProviderBase):
    pass


class ModelProviderUpdate(ForgeBaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None
    rate_limit_rpm: int | None = None
    rate_limit_tpm: int | None = None


class ModelProviderRead(ModelProviderBase, TenantScopedModel):
    id: UUID


class ModelProviderResolveResult(ForgeBaseModel):
    alias: str
    provider: ModelProviderRead
    resolved_at: datetime

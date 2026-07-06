"""Pydantic schemas for the projects API (Settings → General tab)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ForgeBaseModel

Visibility = Literal["private", "internal", "public"]


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    default_branch: str | None = "main"
    visibility: Visibility | None = "private"


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    slug: str | None = Field(default=None, min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    default_branch: str | None = None
    visibility: Visibility | None = None


class ProjectRead(ForgeBaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    slug: str
    description: str | None = None
    default_branch: str
    visibility: str
    status: str
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


__all__ = ["ProjectCreate", "ProjectUpdate", "ProjectRead", "Visibility"]

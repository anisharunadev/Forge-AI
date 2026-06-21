"""Schemas for F-017 — Hook Orchestration."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.hook import HookPhase
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class HookBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    event_type: str = Field(..., min_length=1, max_length=120)
    phase: HookPhase = HookPhase.POST
    action: str = Field(default="shell", max_length=64)
    script: str = Field(default="", max_length=64_000)
    enabled: bool = True
    run_order: int = Field(default=100, ge=0)
    timeout_seconds: int = Field(default=30, ge=1, le=600)


class HookCreate(HookBase):
    project_id: UUID | None = None


class HookUpdate(ForgeBaseModel):
    name: str | None = None
    event_type: str | None = None
    phase: HookPhase | None = None
    action: str | None = None
    script: str | None = None
    enabled: bool | None = None
    run_order: int | None = None
    timeout_seconds: int | None = None


class HookRead(HookBase, TenantScopedModel):
    id: UUID


class HookTestRequest(ForgeBaseModel):
    context: dict[str, Any] = Field(default_factory=dict)


class HookResult(ForgeBaseModel):
    hook_id: UUID
    name: str
    phase: HookPhase
    ok: bool
    started_at: datetime
    finished_at: datetime
    duration_ms: float
    output: str | None = None
    error: str | None = None

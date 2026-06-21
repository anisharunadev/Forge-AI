"""Schemas for F-011 — Agent Registry and F-013 — Agent Assignment."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.agent import AgentStatus, AgentType
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class AgentBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    type: AgentType
    capabilities: dict[str, Any] = Field(default_factory=dict)
    version: str = Field(default="1.0.0", max_length=64)


class AgentCreate(AgentBase):
    project_id: UUID | None = Field(
        default=None,
        description="NULL means org-level; available to every project.",
    )


class AgentUpdate(ForgeBaseModel):
    name: str | None = None
    capabilities: dict[str, Any] | None = None
    status: AgentStatus | None = None
    version: str | None = None


class AgentRead(AgentBase, TenantScopedModel):
    id: UUID
    status: AgentStatus


class AgentAssignmentCreate(ForgeBaseModel):
    task_type: str = Field(..., min_length=1, max_length=64)
    project_id: UUID | None = None
    strategy: str = Field(
        default="round_robin",
        description="round_robin | least_loaded | capability_match | manual_pin",
    )
    pinned_agent_id: UUID | None = None
    required_capabilities: dict[str, Any] = Field(default_factory=dict)


class AgentAssignmentRead(ForgeBaseModel):
    task_type: str
    project_id: UUID | None
    strategy: str
    agent: AgentRead
    assigned_at: datetime

"""Schemas for F-003 — Policies."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.policy import PolicySeverity
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class PolicyBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    expression: dict[str, Any]
    severity: PolicySeverity = PolicySeverity.WARN
    enabled: bool = True


class PolicyCreate(PolicyBase):
    pass


class PolicyRead(PolicyBase, TenantScopedModel):
    id: UUID

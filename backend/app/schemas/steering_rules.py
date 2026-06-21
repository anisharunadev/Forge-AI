"""Schemas for F-504 — Steering Rules Engine."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel


# ---------------------------------------------------------------------------
# Canonical agent stages the engine knows how to inject for.
# Kept small and explicit; expanding it is an API change.
# ---------------------------------------------------------------------------

STEERING_STAGES: tuple[str, ...] = (
    "pre_plan",
    "pre_code",
    "pre_commit",
    "pre_deploy",
    "pre_review",
)


class SteeringRuleBase(ForgeBaseModel):
    rule_id: str = Field(..., min_length=1, max_length=200)
    file_path: str = Field(..., min_length=1, max_length=4000)
    content: str = Field(default="")
    scope: str = Field(default="project", max_length=64)
    applies_to_stages: list[str] = Field(
        default_factory=list,
        description="Stage names this rule applies to (e.g. pre_plan, pre_code, pre_commit).",
    )
    # The ORM column is aliased ``metadata_`` because ``metadata`` is
    # reserved on SQLAlchemy's DeclarativeBase. Map both directions.
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias="metadata_",
        serialization_alias="metadata",
    )


class SteeringRuleCreate(SteeringRuleBase):
    project_id: UUID | None = Field(
        default=None,
        description="Defaults to principal.project_id when omitted.",
    )


class SteeringRuleRead(SteeringRuleBase, TenantScopedModel):
    id: UUID
    content_hash: str
    indexed_at: datetime


class SteeringRuleUpdate(ForgeBaseModel):
    content: str | None = None
    scope: str | None = None
    applies_to_stages: list[str] | None = None
    metadata: dict[str, Any] | None = Field(default=None, validation_alias="metadata_")


class SteeringCatalog(ForgeBaseModel):
    """Typed catalog returned to the agent runtime."""

    tenant_id: UUID
    project_id: UUID | None
    rules: list[SteeringRuleRead]


class InjectionResult(ForgeBaseModel):
    """Result of `inject_into_context` — rules keyed by stage."""

    rules_by_stage: dict[str, list[str]] = Field(
        default_factory=dict,
        description="stage -> list of rule markdown content strings.",
    )


__all__ = [
    "STEERING_STAGES",
    "SteeringCatalog",
    "SteeringRuleBase",
    "SteeringRuleCreate",
    "SteeringRuleRead",
    "SteeringRuleUpdate",
    "InjectionResult",
]
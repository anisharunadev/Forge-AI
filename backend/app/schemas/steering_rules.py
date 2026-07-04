"""Schemas for F-504 — Steering Rules Engine."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
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



# ---------------------------------------------------------------------------
# M2 Plan 01-07 (T-C2) -- typed evaluation decision.
# ---------------------------------------------------------------------------
#
# SteeringEngine.evaluate() returns a SteeringDecision instead of a
# raw dict. The action field is constrained to allow / warn / block
# so the SDLC supervisor can branch on it deterministically without
# re-parsing the markdown.

Action = Literal["allow", "warn", "block"]


class SteeringDecision(ForgeBaseModel):
    """Typed result of :meth:`SteeringEngine.evaluate`.

    The evaluator is rules-only per ADR-009 (no LLM participation in
    the gate). A decision carries:

    * ``stage`` -- which pipeline stage was being evaluated.
    * ``rules_applied`` -- list of rule_ids whose front-matter matched.
    * ``action`` -- one of allow / warn / block. The supervisor
      branches on this value; never on a free-form string.
    * ``reason`` -- human-readable explanation for audit + UI badges.
    * ``metadata`` -- optional non-decision facts (timestamps, content
      hashes) for the audit row.
    """

    stage: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="STEERING_STAGE id (pre_plan, pre_code, pre_commit, pre_deploy, pre_review).",
    )
    rules_applied: list[str] = Field(
        default_factory=list,
        max_length=1_000,
        description="Rule IDs whose front-matter matched the stage.",
    )
    action: Action = Field(
        ...,
        description="Branch the supervisor takes: allow / warn / block.",
    )
    reason: str = Field(
        default="",
        max_length=2_000,
        description="Human-readable rationale for the audit row + UI badge.",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Non-decision facts: content hashes, timestamps, etc.",
    )

    def is_blocking(self) -> bool:
        """True when the supervisor must halt the run."""
        return self.action == "block"

    def is_warn_only(self) -> bool:
        """True when the rule fired but the run may continue with a note."""
        return self.action == "warn"



__all__ = [
    "Action",
    "InjectionResult",
    "STEERING_STAGES",
    "SteeringCatalog",
    "SteeringDecision",
    "SteeringRuleBase",
    "SteeringRuleCreate",
    "SteeringRuleRead",
    "SteeringRuleUpdate",
]
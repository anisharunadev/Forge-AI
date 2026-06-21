"""Schemas for F-505 — Per-Stage Tool Bundle Guardrails.

The stage names mirror the SDLC stages that already exist in
`app.sdlc.RunStage` and the Forge top-level navigation.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel

Stage = Literal[
    "ideation",
    "architecture",
    "development",
    "testing",
    "security",
    "deployment",
]

STAGES: tuple[Stage, ...] = (
    "ideation",
    "architecture",
    "development",
    "testing",
    "security",
    "deployment",
)


class ToolBundleBase(ForgeBaseModel):
    """Shared shape for create/read of a bundle."""

    stage: Stage
    permitted_tools: list[str] = Field(default_factory=list)
    denied_tools: list[str] = Field(default_factory=list)
    rationale: str | None = None


class ToolBundleUpdate(ForgeBaseModel):
    """Steward override payload — all fields optional."""

    permitted_tools: list[str] | None = None
    denied_tools: list[str] | None = None
    rationale: str | None = None


class ToolBundleRead(ToolBundleBase, TenantScopedModel):
    """Bundle row exposed by the API."""

    overridden: bool = False
    overridden_at: str | None = None
    overridden_by: str | None = None


class ToolBundleDecision(ForgeBaseModel):
    """Outcome of an `enforce_bundle` check."""

    allowed: bool
    stage: Stage
    tool: str
    reason: str
    agent_id: str | None = None
    audit_event_id: str | None = None


__all__ = [
    "STAGES",
    "Stage",
    "ToolBundleBase",
    "ToolBundleUpdate",
    "ToolBundleRead",
    "ToolBundleDecision",
]
"""Schemas for F-507 — Day-One Bootstrap with Reference Standards.

A Day-One Bootstrap loads the KnackForge reference standard library
(F-001) for a newly-onboarded project, then layers any
customer-specific overrides on top. The output is a typed
``BootstrapResult`` that downstream services (architecture attestation,
policy engine, ideation intake) consume as their starting baseline.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel


class BootstrapStatus(StrEnum):
    """Lifecycle of the bootstrap for a project."""

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


# ---------------------------------------------------------------------------
# Component DTOs (read-side)
# ---------------------------------------------------------------------------


class Standard(ForgeBaseModel):
    """A baseline or overridden standard loaded into a project."""

    name: str
    content: str
    version: int = 1
    status: str = "active"
    source: str = Field(
        default="baseline",
        description="Where the standard came from: 'baseline' (F-001) or 'overlay' (customer override).",  # noqa: E501
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


class Template(ForgeBaseModel):
    """A baseline or overridden template loaded into a project."""

    type: str
    name: str
    content: dict[str, Any] = Field(default_factory=dict)
    variables: list[dict[str, Any]] = Field(default_factory=list)
    version: int = 1
    source: str = Field(default="baseline")


class Policy(ForgeBaseModel):
    """A baseline or overridden governance policy loaded into a project."""

    name: str
    description: str | None = None
    expression: dict[str, Any]
    severity: str = "warn"
    enabled: bool = True
    source: str = Field(default="baseline")


class SteeringRule(ForgeBaseModel):
    """A steering rule — vendor / customer-specific guardrail (F-507)."""

    name: str
    description: str | None = None
    applies_to: str = Field(
        default="*",
        description="Selector for where the rule applies: 'adr', 'task', 'policy', '*', etc.",
    )
    expression: dict[str, Any] = Field(default_factory=dict)
    source: str = Field(default="overlay")


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------


class BootstrapResult(TenantScopedModel):
    """The full output of a Day-One Bootstrap run."""

    project_id: UUID
    status: BootstrapStatus
    standards: list[Standard] = Field(default_factory=list)
    templates: list[Template] = Field(default_factory=list)
    governance_policies: list[Policy] = Field(default_factory=list)
    steering_rules: list[SteeringRule] = Field(default_factory=list)
    run_id: UUID | None = None
    completed_at: datetime | None = None
    error: str | None = None


# M2 Plan 01-07 (T-A8, G27) — ``BootstrapReport`` is the new name the
# downstream services expect (architecture attestation, policy engine,
# ideation intake all import it under that name).  Aliasing rather
# than renaming keeps the surface zero-behavior-change while the
# older callers migrate — ``isinstance(x, BootstrapReport)`` and
# ``isinstance(x, BootstrapResult)`` both resolve to True for the
# same object.  See Q-M2-1 in the M2 spec for the rename-vs-alias
# decision rationale.
BootstrapReport = BootstrapResult


class BootstrapStatusRead(ForgeBaseModel):
    """Lightweight read for the status endpoint."""

    project_id: UUID
    status: BootstrapStatus
    run_id: UUID | None = None
    counts: dict[str, int] = Field(default_factory=dict)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None

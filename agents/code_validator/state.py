"""F-501 Code Validator sub-graph state — canonical Pydantic v2 models.

This module is the CANONICAL home of the per-scanner Finding models
and the :class:`CodeValidatorState`. The schema-layer mirror at
``backend/app.schemas.validation_report`` re-exports them so the wire
format and the in-process state share one definition.

Independence contract (per locked Phase 1 decision in STATE.md):

* This module is INTENTIONALLY independent of the SDLC supervisor
  package (no shared prompt template, no shared state type).
* It carries its own ``tenant_id`` / ``project_id`` (Rule 2).
* It has its own typed findings (no shared enum with the SDLC graph).
* It does NOT import any LLM SDK.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Per-scanner Finding models.
#
# ponytail: hardcoded severity vocabularies (lint: error/warning/info,
# typecheck: error/warning, security: critical/high/medium/low) match
# the underlying tool outputs 1:1 so the parsing logic in the nodes
# is a straight dict → model conversion.
# ---------------------------------------------------------------------------


class LintFinding(BaseModel):
    """A single lint finding (e.g. ruff ``E501``)."""

    model_config = ConfigDict(frozen=False)

    file: str
    line: int
    column: int
    code: str
    severity: Literal["error", "warning", "info"]
    message: str


class TypeCheckFinding(BaseModel):
    """A single type-checker finding (e.g. mypy ``arg-type``)."""

    model_config = ConfigDict(frozen=False)

    file: str
    line: int
    column: int
    code: str
    severity: Literal["error", "warning"]
    message: str


class SecurityFinding(BaseModel):
    """A single security-scan finding (e.g. bandit ``B105``)."""

    model_config = ConfigDict(frozen=False)

    file: str
    line: int
    rule_id: str
    severity: Literal["critical", "high", "medium", "low"]
    message: str


# ---------------------------------------------------------------------------
# ValidationReport — the terminal artifact of the sub-graph.
#
# Defined here (not re-imported from the schema layer) so the
# sub-graph has a self-contained contract. The schema layer keeps a
# parallel definition for wire-format stability.
# ---------------------------------------------------------------------------


class ValidationReport(BaseModel):
    """Final artifact emitted by the Code Validator sub-graph.

    All fields are required (no ``= None`` defaults) so Rule 4 typed
    artifacts are always fully populated. Tenant + project IDs are
    mandatory per Rule 2.
    """

    model_config = ConfigDict(frozen=False)

    tenant_id: UUID
    project_id: UUID
    run_id: UUID
    lint_findings: list[LintFinding]
    typecheck_findings: list[TypeCheckFinding]
    security_findings: list[SecurityFinding]
    verdict: Literal["pass", "warn", "fail"]
    produced_at: datetime
    summary: str = Field(default="")

    @property
    def is_blocking(self) -> bool:
        """``True`` iff ``verdict == "fail"`` — downstream gates MUST
        block traffic on this report.
        """
        return self.verdict == "fail"

    def to_kg_payload(self) -> dict:
        """Return a dict shaped for the React Flow knowledge graph."""
        return {
            "id": f"validation-report:{self.run_id}",
            "type": "artifact",
            "label": f"ValidationReport {self.verdict}",
            "data": {
                "kind": "ValidationReport",
                "verdict": self.verdict,
                "is_blocking": self.is_blocking,
                "lint_count": len(self.lint_findings),
                "typecheck_count": len(self.typecheck_findings),
                "security_count": len(self.security_findings),
                "run_id": str(self.run_id),
                "tenant_id": str(self.tenant_id),
                "project_id": str(self.project_id),
                "produced_at": self.produced_at.isoformat(),
            },
        }


# ---------------------------------------------------------------------------
# State threaded through the sub-graph.
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    """UTC now — single source of timezone-aware timestamps."""
    return datetime.now(UTC)


def _new_uuid() -> UUID:
    return uuid4()


class CodeValidatorState(BaseModel):
    """The state threaded through the Code Validator sub-graph.

    Required fields (no ``= None`` defaults for tenant / project / run
    IDs — Rule 2 multi-tenancy is mandatory):

    * ``tenant_id`` — required UUID.
    * ``project_id`` — required UUID.
    * ``run_id`` — required UUID.
    * ``files`` — required list of file paths to scan.

    Optional / accumulating fields have ``default_factory`` to keep
    the state checkpoint-friendly.
    """

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        arbitrary_types_allowed=False,
    )

    # ---- Required tenant + run identity (Rule 2) ----
    tenant_id: UUID
    project_id: UUID
    run_id: UUID

    # ---- Scan target ----
    files: list[str] = Field(default_factory=list)

    # ---- Per-node finding buckets ----
    lint_findings: list[LintFinding] = Field(default_factory=list)
    typecheck_findings: list[TypeCheckFinding] = Field(default_factory=list)
    security_findings: list[SecurityFinding] = Field(default_factory=list)

    # ---- Final verdict + artifact ----
    verdict: Literal["pass", "warn", "fail"] | None = None
    produced_at: datetime | None = None
    report: ValidationReport | None = None

    # ---- Audit metadata ----
    metadata: dict[str, str] = Field(default_factory=dict)


__all__ = [
    "CodeValidatorState",
    "LintFinding",
    "TypeCheckFinding",
    "SecurityFinding",
    "ValidationReport",
]

"""Validation Report artifact schema (F-501 sub-graph + F-502 envelope).

This module is the canonical schema for any Code Validator run. It
hosts TWO contracts in one place:

1. **F-502 envelope** (legacy / F-005 audit-trail view):
   ``report_id``, ``decision`` (``"PASS" | "FAIL"``), ``findings``,
   ``summary``, ``schema_version="1.0.0"`` — used by the audit-trail
   surface (F-005) and the F-503 merge gate.

2. **F-501 sub-graph artifact** (plan 01-05): per-scanner finding
   lists (``lint_findings`` / ``typecheck_findings`` /
   ``security_findings``) + a lowercase ``verdict``
   (``"pass" | "warn" | "fail"``) + the per-scanner :class:`LintFinding`,
   :class:`TypeCheckFinding`, :class:`SecurityFinding` models.

The two contracts coexist on the same :class:`ValidationReport` class
so existing F-502 callers keep working while the F-501 sub-graph can
populate the new fields. The ``verdict`` and ``decision`` fields are
the same logical value in two different namespaces; ``decision`` is
the legacy uppercase form and ``verdict`` is the new lowercase form
preferred by the React Flow KG renderer.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import ForgeBaseModel

SCHEMA_VERSION: str = "1.0.0"

VALIDATION_DECISIONS = ("PASS", "FAIL")
"""Allow-list for the F-502 top-level decision string (uppercase)."""

VALIDATION_VERDICTS = ("pass", "warn", "fail")
"""Allow-list for the F-501 sub-graph verdict (lowercase)."""

SEVERITY_LEVELS = ("critical", "high", "medium", "low", "info")
"""Ordered worst->best so by_severity aggregation is stable."""

DecisionLiteral = Literal["PASS", "FAIL"]
VerdictLiteral = Literal["pass", "warn", "fail"]
SeverityLiteral = Literal["critical", "high", "medium", "low", "info"]


class ValidationFinding(ForgeBaseModel):
    """One issue surfaced by a scanner during a validation run."""

    finding_id: str = Field(..., min_length=1, max_length=128)
    severity: SeverityLiteral
    file_path: str = Field(..., min_length=1, max_length=1024)
    line: int = Field(..., ge=0)
    rule_id: str = Field(..., min_length=1, max_length=128)
    evidence: str = Field(..., min_length=1)
    recommended_fix: str = Field(default="")
    standards_ref: list[str] = Field(default_factory=list)


class ValidationSummary(ForgeBaseModel):
    """Aggregated counters for a single ValidationReport.

    `by_severity` is constrained to the canonical severity keys; any
    unknown key in input is rejected so downstream consumers can rely
    on a fixed shape.
    """

    total_findings: int = Field(default=0, ge=0)
    by_severity: dict[SeverityLiteral, int] = Field(default_factory=dict)
    scan_duration_ms: int = Field(default=0, ge=0)
    scanners_executed: list[str] = Field(default_factory=list)

    @field_validator("by_severity")
    @classmethod
    def _ensure_known_severities(cls, v: dict[str, int]) -> dict[str, int]:
        unknown = set(v.keys()) - set(SEVERITY_LEVELS)
        if unknown:
            raise ValueError(
                f"by_severity contains unknown keys {sorted(unknown)!r}; "
                f"allowed: {list(SEVERITY_LEVELS)!r}"
            )
        # Coerce values to non-negative ints.
        return {k: int(max(0, val)) for k, val in v.items()}


def aggregate_summary(
    findings: list[ValidationFinding],
    *,
    scan_duration_ms: int = 0,
    scanners_executed: list[str] | None = None,
) -> ValidationSummary:
    """Build a ValidationSummary from a list of findings.

    Centralizes the aggregation rule so the API layer and the schema's
    own self-consistency check share one implementation.
    """
    by_severity: dict[SeverityLiteral, int] = {level: 0 for level in SEVERITY_LEVELS}
    for f in findings:
        by_severity[f.severity] += 1
    return ValidationSummary(
        total_findings=len(findings),
        by_severity=by_severity,
        scan_duration_ms=scan_duration_ms,
        scanners_executed=list(scanners_executed or []),
    )


# ---------------------------------------------------------------------------
# F-501 sub-graph per-scanner finding types.
#
# The Code Validator sub-graph (plan 01-05) uses three deterministic
# scanners (lint, typecheck, security) that emit distinct finding
# shapes. The canonical home of these models is
# ``agents.code_validator.state`` (which is the in-process state of
# the sub-graph). They are re-exported here so the schema layer is
# the single import surface for wire-format stability.
# ---------------------------------------------------------------------------

try:
    from agents.code_validator.state import (  # noqa: F401
        LintFinding as _LintFinding,
        SecurityFinding as _SecurityFinding,
        TypeCheckFinding as _TypeCheckFinding,
        ValidationReport as _SubgraphValidationReport,
    )

    LintFinding = _LintFinding
    TypeCheckFinding = _TypeCheckFinding
    SecurityFinding = _SecurityFinding
except Exception:  # pragma: no cover — fallback for environments where the
    # ``agents`` package is not importable (e.g. legacy F-502 callers
    # running without the F-501 sub-graph on the path). The fallback
    # definitions below are byte-identical to the canonical ones.

    class LintFinding(BaseModel):  # type: ignore[no-redef]
        """A single lint finding (e.g. ruff ``E501``)."""

        model_config = ConfigDict(frozen=False)

        file: str
        line: int
        column: int
        code: str
        severity: Literal["error", "warning", "info"]
        message: str

    class TypeCheckFinding(BaseModel):  # type: ignore[no-redef]
        """A single type-checker finding (e.g. mypy ``arg-type``)."""

        model_config = ConfigDict(frozen=False)

        file: str
        line: int
        column: int
        code: str
        severity: Literal["error", "warning"]
        message: str

    class SecurityFinding(BaseModel):  # type: ignore[no-redef]
        """A single security-scan finding (e.g. bandit ``B105``)."""

        model_config = ConfigDict(frozen=False)

        file: str
        line: int
        rule_id: str
        severity: Literal["critical", "high", "medium", "low"]
        message: str


class ValidationReport(ForgeBaseModel):
    """Top-level envelope for a single validator run.

    This single class hosts BOTH:

    * the F-502 envelope (legacy audit-trail fields: ``report_id``,
      ``decision``, ``findings``, ``summary``, ``schema_version``);
    * the F-501 sub-graph fields (per-scanner finding lists,
      ``verdict``, ``tenant_id``/``project_id``, ``produced_at``).

    F-502 callers that only set the legacy fields continue to work.
    F-501 callers populate the new fields; both contracts are honored
    on the same row.
    """

    # ---- F-502 envelope (legacy / audit-trail view) ----
    report_id: UUID
    run_id: UUID
    timestamp: datetime
    validator_version: str = Field(..., min_length=1, max_length=64)
    decision: DecisionLiteral
    findings: list[ValidationFinding] = Field(default_factory=list)
    summary: ValidationSummary
    evidence_pack_url: str = Field(default="", max_length=2048)
    schema_version: str = Field(default=SCHEMA_VERSION)

    # ---- F-501 sub-graph fields (plan 01-05) ----
    # Rule 2 multi-tenancy: optional in the merged shape so the F-502
    # legacy callers that only set the audit-trail fields continue to
    # validate cleanly. F-501 sub-graph output always populates these.
    tenant_id: UUID | None = None
    project_id: UUID | None = None
    # Per-scanner finding lists — empty list is the pass-by-default state.
    lint_findings: list[LintFinding] = Field(default_factory=list)
    typecheck_findings: list[TypeCheckFinding] = Field(default_factory=list)
    security_findings: list[SecurityFinding] = Field(default_factory=list)
    # Lowercase verdict — preferred by React Flow KG renderer.
    # Optional in the merged shape; the F-501 sub-graph always populates.
    verdict: VerdictLiteral | None = None
    # F-501 timestamp (separate from F-502 ``timestamp`` for back-compat).
    produced_at: datetime | None = None
    # Optional free-form human-readable summary; defaults to empty.
    summary_text: str = Field(default="")

    @field_validator("schema_version")
    @classmethod
    def _check_schema_version(cls, v: str) -> str:
        # For v1 we only accept the literal current version; future
        # migrations will widen this set.
        if v != SCHEMA_VERSION:
            raise ValueError(f"unsupported schema_version {v!r}; expected {SCHEMA_VERSION!r}")
        return v

    # ------------------------------------------------------------------
    # F-501 convenience helpers
    # ------------------------------------------------------------------

    @property
    def is_blocking(self) -> bool:
        """``True`` iff ``verdict == "fail"`` — downstream gates MUST
        block traffic on this report. Returns ``False`` when ``verdict``
        is ``None`` (F-502 legacy rows that pre-date the F-501 contract).
        """
        return self.verdict == "fail"

    def to_kg_payload(self) -> dict:
        """Return a dict shaped for the React Flow knowledge graph.

        Schema matches the ``KGNode`` contract used by the
        Architecture Center renderer::

            {
                "id": "validation-report:<run_id>",
                "type": "artifact",
                "label": "ValidationReport fail",
                "data": {
                    "kind": "ValidationReport",
                    "verdict": "fail",
                    "is_blocking": True,
                    "lint_count": ...,
                    ...
                },
            }
        """
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


__all__ = [
    "SCHEMA_VERSION",
    "VALIDATION_DECISIONS",
    "VALIDATION_VERDICTS",
    "SEVERITY_LEVELS",
    "DecisionLiteral",
    "VerdictLiteral",
    "SeverityLiteral",
    "ValidationFinding",
    "ValidationSummary",
    "ValidationReport",
    "aggregate_summary",
    "LintFinding",
    "TypeCheckFinding",
    "SecurityFinding",
]

"""F-502 — Validation Report artifact schema.

A typed artifact (per Rule 4 / DL-027) carrying the validator's findings
for a single validator run on a commit. Consumed by F-503 (Deterministic
Security Gate) and surfaced through the F-005 audit trail.

Layout follows the F-010 artifact model:

  ValidationReport  -> top-level envelope
    ValidationFinding -> one issue surfaced by the validator
    ValidationSummary -> aggregated counts + scanner metadata

The schema is versioned (schema_version = "1.0.0") so consumers can
branch on contract changes without breaking older payloads.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.common import ForgeBaseModel


SCHEMA_VERSION: str = "1.0.0"

VALIDATION_DECISIONS = ("PASS", "FAIL")
"""Allow-list for the top-level decision string."""

SEVERITY_LEVELS = ("critical", "high", "medium", "low", "info")
"""Ordered worst->best so by_severity aggregation is stable."""

DecisionLiteral = Literal["PASS", "FAIL"]
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


class ValidationReport(ForgeBaseModel):
    """Top-level envelope for a single validator run."""

    report_id: UUID
    run_id: UUID
    timestamp: datetime
    validator_version: str = Field(..., min_length=1, max_length=64)
    decision: DecisionLiteral
    findings: list[ValidationFinding] = Field(default_factory=list)
    summary: ValidationSummary
    evidence_pack_url: str = Field(default="", max_length=2048)
    schema_version: str = Field(default=SCHEMA_VERSION)

    @field_validator("schema_version")
    @classmethod
    def _check_schema_version(cls, v: str) -> str:
        # For v1 we only accept the literal current version; future
        # migrations will widen this set.
        if v != SCHEMA_VERSION:
            raise ValueError(
                f"unsupported schema_version {v!r}; expected {SCHEMA_VERSION!r}"
            )
        return v


__all__ = [
    "SCHEMA_VERSION",
    "VALIDATION_DECISIONS",
    "SEVERITY_LEVELS",
    "DecisionLiteral",
    "SeverityLiteral",
    "ValidationFinding",
    "ValidationSummary",
    "ValidationReport",
    "aggregate_summary",
]

"""Code Validator sub-graph state — F-501.

A separate TypedDict/BaseModel state for the Code Validator sub-graph.
This module is intentionally self-contained: it MUST NOT import from
``sdlc_state`` so the validator can evolve independently from the SDLC
supervisor (NFR-043 — independence).

The sub-graph is a small fan-out / fan-in pipeline:

    scan_secrets ──┐
    scan_iac ──────┼──▶ aggregate_findings ──▶ END
    scan_vulns ────┤
    scan_standards ┘

Final output is a typed :class:`ValidationReport` artifact with a
deterministic :class:`Literal["PASS", "FAIL"]` decision (NFR-042).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ---------------------------------------------------------------------------
# Severity — drives the PASS/FAIL decision (NFR-042).
# ---------------------------------------------------------------------------


class Severity(str, Enum):
    """Severity scale used by every scanner.

    Ordered from least to most severe. The aggregate node converts
    findings to PASS/FAIL based on whether any finding is at or above
    the ``HIGH`` threshold.
    """

    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @classmethod
    def fails_run(cls) -> tuple[Severity, ...]:
        """Severities that force a FAIL decision."""
        return (cls.HIGH, cls.CRITICAL)

    def at_or_above(self, threshold: Severity) -> bool:
        order = [
            Severity.INFO,
            Severity.LOW,
            Severity.MEDIUM,
            Severity.HIGH,
            Severity.CRITICAL,
        ]
        return order.index(self) >= order.index(threshold)


# ---------------------------------------------------------------------------
# Validator version — bumped when the sub-graph topology or rules change.
# ---------------------------------------------------------------------------

VALIDATOR_VERSION = "1.0.0"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _new_uuid() -> UUID:
    return uuid.uuid4()


# ---------------------------------------------------------------------------
# Minimal local type for the report artifact.
#
# T1.6 will create the canonical schema for ValidationReport. Until that
# task lands, we ship a local typed artifact that matches the expected
# shape exactly. The canonical schema (when created) must satisfy the
# same duck-type contract used here.
# ---------------------------------------------------------------------------


class ValidationFinding(BaseModel):
    """A single finding produced by one of the scanners.

    Fields mirror the contract specified in the F-501 ticket:

    * ``finding_id`` — deterministic per scanner+file+rule+line.
    * ``severity`` — drives PASS/FAIL via :meth:`Severity.at_or_above`.
    * ``file_path`` — relative to repo root.
    * ``line`` — 1-indexed line number (0 if N/A).
    * ``rule_id`` — scanner-native identifier (e.g. ``trufflehog:aws``).
    * ``evidence`` — redacted snippet showing the issue.
    * ``recommended_fix`` — actionable remediation hint.
    * ``standards_ref`` — standard citation (CWE, OWASP, CIS, etc).
    """

    model_config = ConfigDict(frozen=False, arbitrary_types_allowed=False)

    finding_id: str
    severity: Severity
    file_path: str
    line: int = 0
    rule_id: str
    evidence: str = ""
    recommended_fix: str = ""
    standards_ref: str = ""
    scanner: str = ""


class ValidationSummary(BaseModel):
    """Aggregated counts and the resulting decision."""

    model_config = ConfigDict(frozen=False)

    total_findings: int = 0
    by_severity: dict[str, int] = Field(default_factory=dict)
    by_scanner: dict[str, int] = Field(default_factory=dict)
    highest_severity: Severity | None = None
    decision: Literal["PASS", "FAIL"] = "PASS"


class ValidationReport(BaseModel):
    """Final artifact emitted by the Code Validator sub-graph (NFR-042).

    Deterministic contract::

        decision == "PASS"  ⇔  no finding with severity >= HIGH.

    All other states (including empty scans) MUST be ``"PASS"``.
    """

    model_config = ConfigDict(frozen=False)

    decision: Literal["PASS", "FAIL"]
    findings: list[ValidationFinding] = Field(default_factory=list)
    summary: ValidationSummary = Field(default_factory=ValidationSummary)
    run_id: UUID = Field(default_factory=_new_uuid)
    validator_version: str = VALIDATOR_VERSION
    created_at: datetime = Field(default_factory=_utcnow)

    @field_validator("decision")
    @classmethod
    def _decision_consistent_with_findings(
        cls, v: Literal["PASS", "FAIL"], info: Any
    ) -> Literal["PASS", "FAIL"]:
        # Defer cross-field check to ``finalize`` below; this method
        # only validates the literal value itself.
        return v

    @classmethod
    def finalize(
        cls,
        *,
        findings: list[ValidationFinding],
        run_id: UUID | None = None,
    ) -> ValidationReport:
        """Compute the deterministic PASS/FAIL decision.

        NFR-042:
            * PASS requires zero findings with severity >= HIGH.
            * FAIL surfaces every finding.
        """

        counts: dict[str, int] = {}
        by_scanner: dict[str, int] = {}
        highest: Severity | None = None
        for f in findings:
            counts[f.severity.value] = counts.get(f.severity.value, 0) + 1
            by_scanner[f.scanner] = by_scanner.get(f.scanner, 0) + 1
            if highest is None or f.severity.at_or_above(highest):
                highest = f.severity

        decision: Literal["PASS", "FAIL"] = "PASS"
        if any(f.severity.at_or_above(Severity.HIGH) for f in findings):
            decision = "FAIL"

        return cls(
            decision=decision,
            findings=list(findings),
            summary=ValidationSummary(
                total_findings=len(findings),
                by_severity=counts,
                by_scanner=by_scanner,
                highest_severity=highest,
                decision=decision,
            ),
            run_id=run_id or _new_uuid(),
        )

    def content_hash(self) -> str:
        """Stable content hash for artifact registry (Rule 4)."""
        canonical = json.dumps(
            {
                "decision": self.decision,
                "findings": [f.model_dump(mode="json") for f in self.findings],
                "validator_version": self.validator_version,
                "run_id": str(self.run_id),
            },
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Scanner target — what the validators scan.
# ---------------------------------------------------------------------------


class ScanTarget(BaseModel):
    """The artifact under validation.

    The Code Validator sub-graph never touches the filesystem directly;
    it operates on a content bundle passed in by the caller (typically
    the SDLC implementation phase). This keeps the sub-graph stateless
    and reproducible.
    """

    model_config = ConfigDict(frozen=False)

    repo_id: str
    commit_sha: str = "HEAD"
    files: list[dict[str, Any]] = Field(default_factory=list)
    iac_paths: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Scanner output envelope.
# ---------------------------------------------------------------------------


class ScannerEnvelope(BaseModel):
    """One scanner's contribution to the aggregate.

    Each scanner writes its findings into a per-key slot of the state
    (e.g. ``findings.secrets``, ``findings.iac``). The envelope carries
    timing + error context for the audit log (Rule 6).
    """

    model_config = ConfigDict(frozen=False)

    scanner: str
    findings: list[ValidationFinding] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=_utcnow)
    finished_at: datetime | None = None
    duration_ms: int = 0
    error: str | None = None


# ---------------------------------------------------------------------------
# Per-scanner finding buckets used inside the state.
# ---------------------------------------------------------------------------


class FindingsBuckets(BaseModel):
    """Container that groups per-scanner finding lists."""

    model_config = ConfigDict(frozen=False)

    secrets: list[ValidationFinding] = Field(default_factory=list)
    iac: list[ValidationFinding] = Field(default_factory=list)
    vulns: list[ValidationFinding] = Field(default_factory=list)
    standards: list[ValidationFinding] = Field(default_factory=list)

    def all(self) -> list[ValidationFinding]:
        return [*self.secrets, *self.iac, *self.vulns, *self.standards]

    def merge(self, other: FindingsBuckets) -> FindingsBuckets:
        return FindingsBuckets(
            secrets=[*self.secrets, *other.secrets],
            iac=[*self.iac, *other.iac],
            vulns=[*self.vulns, *other.vulns],
            standards=[*self.standards, *other.standards],
        )


# ---------------------------------------------------------------------------
# Tool bundle — explicit allow-list (NFR-043).
# ---------------------------------------------------------------------------


class CodeValidatorToolBundle(BaseModel):
    """The narrow set of read-only scanner tools the validator may use.

    Constitutionally forbidden tools (NFR-043):

    * terminal / shell execution
    * IDE state mutation
    * git write operations

    Only the four read-only scanners are allowed.
    """

    model_config = ConfigDict(frozen=True)

    secrets_scanner: str = "trufflehog"
    iac_scanner: str = "checkov"
    vuln_scanner: str = "bandit"
    standards_scanner: str = "semgrep"

    ALLOWED_SCANNERS: tuple[str, ...] = (
        "trufflehog",
        "checkov",
        "bandit",
        "semgrep",
    )

    @classmethod
    def default(cls) -> CodeValidatorToolBundle:
        return cls()


# ---------------------------------------------------------------------------
# CodeValidatorState — the LangGraph state.
# ---------------------------------------------------------------------------


class CodeValidatorState(BaseModel):
    """The state threaded through the Code Validator sub-graph.

    Independence contract (NFR-043):

    * Does NOT import or reference :class:`app.agents.sdlc_state.SDLCState`.
    * Carries its own ``tenant_id`` / ``project_id`` (Rule 2).
    * Uses a dedicated LiteLLM virtual key prefix (see
      ``code_validator.py``).
    * Has its own prompt template (``prompts/code_validator.j2``).
    """

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        arbitrary_types_allowed=False,
    )

    run_id: UUID = Field(default_factory=_new_uuid)
    tenant_id: UUID
    project_id: UUID
    actor_id: UUID

    target: ScanTarget
    tool_bundle: CodeValidatorToolBundle = Field(default_factory=CodeValidatorToolBundle.default)
    findings: FindingsBuckets = Field(default_factory=FindingsBuckets)
    # Per-scanner scratch fields — written by the corresponding scanner
    # node, merged into ``findings`` by ``aggregate_findings``. We use
    # dedicated slots (rather than letting each scanner write to
    # ``findings``) so LangGraph's parallel reducer does not complain
    # about multiple concurrent writes to the same channel.
    secrets_partial: list[ValidationFinding] = Field(default_factory=list)
    iac_partial: list[ValidationFinding] = Field(default_factory=list)
    vulns_partial: list[ValidationFinding] = Field(default_factory=list)
    standards_partial: list[ValidationFinding] = Field(default_factory=list)
    secrets_envelope: ScannerEnvelope | None = None
    iac_envelope: ScannerEnvelope | None = None
    vulns_envelope: ScannerEnvelope | None = None
    standards_envelope: ScannerEnvelope | None = None
    scanner_envelopes: list[ScannerEnvelope] = Field(default_factory=list)
    cost_so_far: Decimal = Decimal("0")
    metadata: dict[str, Any] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    # Set by the aggregate node.
    report: ValidationReport | None = None

    # ------------------------------------------------------------------
    # Mutators — checkpoint-friendly.
    # ------------------------------------------------------------------

    def with_bucket(
        self,
        scanner: str,
        findings: list[ValidationFinding],
    ) -> CodeValidatorState:
        bucket_map = {
            "secrets": "secrets",
            "iac": "iac",
            "vulns": "vulns",
            "standards": "standards",
        }
        key = bucket_map.get(scanner)
        if key is None:
            raise ValueError(f"unknown scanner bucket: {scanner}")
        new_buckets = self.findings.model_copy(
            update={key: [*getattr(self.findings, key), *findings]}
        )
        return self.model_copy(
            update={
                "findings": new_buckets,
                "updated_at": _utcnow(),
            }
        )

    def with_envelope(self, envelope: ScannerEnvelope) -> CodeValidatorState:
        return self.model_copy(
            update={
                "scanner_envelopes": [*self.scanner_envelopes, envelope],
                "updated_at": _utcnow(),
            }
        )

    def with_report(self, report: ValidationReport) -> CodeValidatorState:
        return self.model_copy(update={"report": report, "updated_at": _utcnow()})

    def add_error(self, message: str) -> CodeValidatorState:
        return self.model_copy(update={"errors": [*self.errors, message], "updated_at": _utcnow()})

    def add_cost(self, cost: Decimal) -> CodeValidatorState:
        if cost < 0:
            raise ValueError("cost increment must be non-negative")
        return self.model_copy(
            update={"cost_so_far": self.cost_so_far + cost, "updated_at": _utcnow()}
        )

    def as_langgraph_state(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    @classmethod
    def from_langgraph_state(cls, payload: dict[str, Any]) -> CodeValidatorState:
        if "cost_so_far" in payload:
            payload = {**payload, "cost_so_far": Decimal(str(payload["cost_so_far"]))}
        return cls.model_validate(payload)


__all__ = [
    "Severity",
    "VALIDATOR_VERSION",
    "ValidationFinding",
    "ValidationSummary",
    "ValidationReport",
    "ScanTarget",
    "ScannerEnvelope",
    "FindingsBuckets",
    "CodeValidatorToolBundle",
    "CodeValidatorState",
    # F-501 per-scanner finding types — re-exported from the canonical
    # schema location so legacy callers can keep using the
    # ``app.agents.code_validator_state`` import surface.
    "LintFinding",
    "TypeCheckFinding",
    "SecurityFinding",
]


# ---------------------------------------------------------------------------
# F-501 re-exports (plan 01-05).
#
# The new top-level ``agents.code_validator.state`` module is the
# canonical home of the per-scanner finding models. Re-export them
# here so the existing import surface (e.g. ``from
# app.agents.code_validator_state import ValidationReport``) keeps
# working for every existing F-502 caller.
# ---------------------------------------------------------------------------

from app.schemas.validation_report import (  # noqa: E402,F401
    LintFinding,
    SecurityFinding,
    TypeCheckFinding,
)

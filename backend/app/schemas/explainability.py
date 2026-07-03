"""Run-level explainability schema (Step-64 Sub-step A).

The CodeRabbit "agentic SDLC" mapping calls out a 5-question explainability
bundle every reviewer expects to see for an autonomous run. We compute the
bundle from existing tables (no schema migration) and surface it through
``GET /api/v1/runs/{id}/explainability``.

Each sub-payload answers exactly one question:

* :class:`Q1ChangesAndWhy`       — what did you change and why?
* :class:`Q2ChecksPerformed`      — what did you check?
* :class:`Q3CoverageGaps`         — what did you NOT check?
* :class:`Q4ConfidenceScore`      — confidence + calibration provenance
* :class:`Q5Counterfactual`       — what would change your recommendation?

The whole bundle is recomputed on every request; we deliberately do NOT
store snapshots (would require a migration). The grade + rationale give
the reviewer a single-letter verdict in the UI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel


# ---------------------------------------------------------------------------
# Q1 — what did you change and why?
# ---------------------------------------------------------------------------

ChangeKindLiteral = Literal["added", "removed", "modified", "renamed"]


class ChangeEntry(ForgeBaseModel):
    """One file-level change emitted by a command run / commit audit."""

    file: str
    change_kind: ChangeKindLiteral
    lines_added: int = 0
    lines_removed: int = 0
    rationale: str = ""
    citation: str | None = None


class Q1ChangesAndWhy(ForgeBaseModel):
    """Aggregated change summary for the run."""

    summary: str
    changes: list[ChangeEntry] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Q2 — what did you check?
# ---------------------------------------------------------------------------

CheckOutcomeLiteral = Literal["pass", "fail", "warn", "skip"]
CheckSourceLiteral = Literal["validation_report", "audit_events", "policy_engine"]


class CheckEntry(ForgeBaseModel):
    """One check the agent (or its surrounding guards) performed."""

    name: str
    category: str
    outcome: CheckOutcomeLiteral
    detail: str = ""
    source: CheckSourceLiteral


class Q2ChecksPerformed(ForgeBaseModel):
    """Aggregate of every check that landed in the run's audit + validator trail."""

    total_checks: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    entries: list[CheckEntry] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Q3 — what did you NOT check?
# ---------------------------------------------------------------------------


class Q3CoverageGaps(ForgeBaseModel):
    """Honest accounting of checks the run did NOT exercise.

    ``explicit_gaps`` are surfaced by the source data (a validation
    report that was skipped, an audit event with ``outcome=skipped``);
    ``implicit_gaps`` come from :data:`RunExplainabilityService.STANDARD_GAPS`
    and from sparse-evidence heuristics.
    """

    explicit_gaps: list[str] = Field(default_factory=list)
    implicit_gaps: list[str] = Field(default_factory=list)
    coverage_pct: float = Field(default=0.0, ge=0, le=100)


# ---------------------------------------------------------------------------
# Q4 — confidence + calibration
# ---------------------------------------------------------------------------

CalibrationLiteral = Literal["token_logprob", "validation_passes", "heuristic", "human_only"]


class Q4ConfidenceScore(ForgeBaseModel):
    """Confidence score plus the provenance that produced it.

    ``calibration`` lets reviewers understand whether the number is
    cheap (heuristic) or expensive (token logprobs) — and swap in a
    real calibrated model later without changing the wire format.
    """

    raw_score: float = Field(ge=0, le=100)
    calibration: CalibrationLiteral
    threshold: float = Field(ge=0, le=100, default=70.0)
    would_escalate: bool
    bands_observed: dict[str, int] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Q5 — what would change your recommendation?
# ---------------------------------------------------------------------------


class Q5Counterfactual(ForgeBaseModel):
    """Bullet list of conditions that would flip the recommendation.

    Built from validator decisions + state-machine failures. The
    ``counter_recommendation`` is the actionable summary the reviewer
    reads first.
    """

    conditions: list[str] = Field(default_factory=list)
    counter_recommendation: str


# ---------------------------------------------------------------------------
# Top-level bundle
# ---------------------------------------------------------------------------

GradeLiteral = Literal["A", "B", "C", "D", "F"]


class RunExplainability(ForgeBaseModel):
    """CodeRabbit 5-question explainability bundle for a single run.

    Computed read-only by :class:`RunExplainabilityService`. Recomputed
    on every GET — no caching layer (would require a migration we are
    explicitly deferring per the Step-64 spec).
    """

    run_id: UUID
    tenant_id: UUID
    project_id: UUID
    what_changed: Q1ChangesAndWhy
    what_checked: Q2ChecksPerformed
    coverage_gaps: Q3CoverageGaps
    confidence: Q4ConfidenceScore
    counterfactual: Q5Counterfactual
    # default_factory=lambda: ... required for Pydantic v2 + datetime.now
    computed_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    schema_version: int = 1
    grade: GradeLiteral = "B"
    grade_rationale: str = ""


__all__ = [
    "ChangeEntry",
    "ChangeKindLiteral",
    "CheckEntry",
    "CheckOutcomeLiteral",
    "CheckSourceLiteral",
    "CalibrationLiteral",
    "GradeLiteral",
    "Q1ChangesAndWhy",
    "Q2ChecksPerformed",
    "Q3CoverageGaps",
    "Q4ConfidenceScore",
    "Q5Counterfactual",
    "RunExplainability",
]
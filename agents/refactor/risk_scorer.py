"""
Risk scorer — assigns each file a risk level + estimated effort.

The score is a clamped sum of weighted positive signals. The signals
and weights are kept here (not in a config) so the v0.1 contract is
fixed and the smoke test is stable.

Score thresholds (in [0, 10]):

  - low     : score < 3
  - medium  : 3 ≤ score < 6
  - high    : score ≥ 6

Effort estimate uses a simple per-LoC table by language, multiplied
by a risk multiplier. v0.2 should fold in real historical data
instead of the static table.
"""

from __future__ import annotations

import math
from typing import List, Tuple

from .schemas import Evidence, FileRecord, RiskAssessment


# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

#: Risk contributions. All weights are positive — the score is the
#: sum of these, clamped to [0, 10].
WEIGHT_FAN_IN = 2.5              # per inbound import (log-dampened)
WEIGHT_FAN_OUT = 1.5             # per outbound import (log-dampened)
WEIGHT_LOC = 0.005               # per LoC
WEIGHT_BUSINESS_LOGIC = 2.0      # file role implies business logic
WEIGHT_ENTRYPOINT = 3.0          # file is an entrypoint
WEIGHT_UNCOVERED = 2.0           # file has no test coverage in the repo
WEIGHT_DEPRECATED_RUNTIME = 3.0  # file uses a legacy runtime

#: Roles that count as "business logic" — i.e. they encode domain
#: rules and have higher refactor cost.
BUSINESS_LOGIC_ROLES = {"service", "domain", "model", "controller", "usecase"}

#: Per-LoC effort multipliers (days per LoC). Conservative defaults.
EFFORT_DAYS_PER_LOC = {
    "python": 0.0008,
    "typescript": 0.0009,
    "javascript": 0.0009,
    "java": 0.0012,
    "csharp": 0.0012,
    "go": 0.0008,
    "ruby": 0.0010,
    "rust": 0.0012,
    "kotlin": 0.0010,
    "swift": 0.0010,
    "_default": 0.0010,
}

#: Risk multiplier applied to the raw LoC effort. Higher-risk files
#: cost more per LoC because every change needs deeper review.
RISK_MULTIPLIER = {
    "low": 1.0,
    "medium": 1.4,
    "high": 2.0,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def assess_risks(
    repo_files: List[FileRecord],
) -> List[RiskAssessment]:
    """Return a `RiskAssessment` for every file in the input list.

    Output is sorted by `path` for determinism.
    """
    assessments: List[RiskAssessment] = []
    for f in repo_files:
        score, factors, ev = _score_one(f)
        risk_level = _bucket(score)
        days = _estimate_effort(f, risk_level)
        assessments.append(
            RiskAssessment(
                path=f.path,
                risk_level=risk_level,
                score=round(score, 3),
                factors=factors,
                estimated_effort_days=round(days, 3),
                evidence=ev,
            )
        )

    assessments.sort(key=lambda r: r.path)
    return assessments


def repo_risk_score(assessments: List[RiskAssessment]) -> float:
    """Top-line repo risk: weighted average by LoC, in [0, 10]."""
    if not assessments:
        return 0.0
    total = sum(a.score for a in assessments)
    return round(total / len(assessments), 3)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _score_one(f: FileRecord) -> Tuple[float, List[str], List[Evidence]]:
    score = 0.0
    factors: List[str] = []
    evidence: List[Evidence] = []

    fan_in = len(f.imported_by)
    fan_out = len(f.imports)
    # log1p dampens huge fan-in values (monoliths) so a single huge
    # graph doesn't dominate the score.
    if fan_in:
        contrib = WEIGHT_FAN_IN * math.log1p(fan_in)
        score += contrib
        factors.append(f"fan_in={fan_in}")
        evidence.append(Evidence(
            kind="risk",
            description=f"{fan_in} inbound imports (log-dampened).",
            paths=[f.path],
            metric="fan_in",
            value=float(fan_in),
        ))

    if fan_out:
        contrib = WEIGHT_FAN_OUT * math.log1p(fan_out)
        score += contrib
        factors.append(f"fan_out={fan_out}")
        evidence.append(Evidence(
            kind="risk",
            description=f"{fan_out} outbound imports (log-dampened).",
            paths=[f.path],
            metric="fan_out",
            value=float(fan_out),
        ))

    if f.loc > 0:
        contrib = WEIGHT_LOC * f.loc
        score += contrib
        factors.append(f"loc={f.loc}")
        evidence.append(Evidence(
            kind="risk",
            description=f"{f.loc} LoC in the file.",
            paths=[f.path],
            metric="loc",
            value=float(f.loc),
        ))

    if f.role in BUSINESS_LOGIC_ROLES:
        score += WEIGHT_BUSINESS_LOGIC
        factors.append(f"role={f.role}")
        evidence.append(Evidence(
            kind="risk",
            description=f"Role {f.role!r} implies business logic.",
            paths=[f.path],
            metric="role",
            value=1.0,
        ))

    if f.is_entrypoint:
        score += WEIGHT_ENTRYPOINT
        factors.append("entrypoint")
        evidence.append(Evidence(
            kind="risk",
            description="File is an entrypoint (publicly reachable).",
            paths=[f.path],
            metric="entrypoint",
            value=1.0,
        ))

    if not f.has_tests and f.role in BUSINESS_LOGIC_ROLES:
        score += WEIGHT_UNCOVERED
        factors.append("no_tests")
        evidence.append(Evidence(
            kind="risk",
            description="Business-logic file without test coverage.",
            paths=[f.path],
            metric="has_tests",
            value=0.0,
        ))

    if f.in_deprecated_path:
        score += WEIGHT_DEPRECATED_RUNTIME
        factors.append("deprecated_path")
        evidence.append(Evidence(
            kind="risk",
            description="File lives in a deprecated path.",
            paths=[f.path],
            metric="deprecated_path",
            value=1.0,
        ))

    # Clamp to [0, 10].
    score = max(0.0, min(10.0, score))
    return score, factors, evidence


def _bucket(score: float) -> str:
    if score >= 6.0:
        return "high"
    if score >= 3.0:
        return "medium"
    return "low"


def _estimate_effort(f: FileRecord, risk_level: str) -> float:
    per_loc = EFFORT_DAYS_PER_LOC.get(f.language, EFFORT_DAYS_PER_LOC["_default"])
    mult = RISK_MULTIPLIER.get(risk_level, 1.0)
    return f.loc * per_loc * mult

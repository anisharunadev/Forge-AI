"""
Schemas for the QA Agent handoff contract (ADR-0004).

This is the v1 contract called out in `workspace/memory/qa.md` §3 and
in ADR-0004 (FORA-41). Other stages read these dataclasses, so a
shape change is a breaking change to the agent handoff contract.

Three top-level types are exported:

    TestPlan        — what the agent intends to run, per tier
    TestRun         — what actually happened: per-tier pass/fail, p50/p99, evidence
    CoverageReport  — line, branch, mutation-score (where available)

`InputSignal` is re-used from `agents.ideation.schemas` so collectors
across agents emit the same shape. The re-export keeps the public
surface of `agents.qa.schemas` self-contained: downstream code does
not have to know which sibling module defined the contract.

Versioning
----------
The package is at schema version 1.0.0 (SCHEMA_VERSION). Additive
changes are a minor bump; breaking changes are a major bump and a
new ADR.  The validate() methods are the gate; a payload that
claims a newer major version than the running code knows about is
rejected (fail closed).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

# Re-use the cross-agent InputSignal contract. The Ideation agent owns
# the canonical definition today; once FORA-41 lands, this re-export
# moves into `agents/_shared/schemas.py`.
from agents.ideation.schemas import InputSignal  # noqa: F401


SCHEMA_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Tier + status enums
# ---------------------------------------------------------------------------

class TestTier(str, Enum):
    """The four test tiers. Order is the run order; v1 is fixed."""
    UNIT = "unit"
    INTEGRATION = "integration"
    E2E = "e2e"
    CONTRACT = "contract"


# Run order, derived once so callers do not have to depend on Enum order.
TIER_RUN_ORDER: List[str] = [t.value for t in TestTier]


class TierStatus(str, Enum):
    """Status of a single tier within a TestRun."""
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    NOT_IMPLEMENTED = "not_implemented"
    SKIPPED = "skipped"
    ERRORED = "errored"             # ADR-0004: infrastructure failure (e.g. test runner crashed)


class RunStatus(str, Enum):
    """Status of the whole TestRun. The Security stage consumes this as the gate
    token; ADR-0004 §3.2 aligns the `verdict` field with one of the three
    Security-actionable values: pass, fail, needs_attention."""
    PASSED = "passed"
    FAILED = "failed"
    PARTIAL = "partial"          # some tiers passed, some not_implemented, none failed
    NEEDS_ATTENTION = "needs_attention"  # ADR-0004: explicit Security-actionable verdict
    BLOCKED = "blocked"          # validation failure or upstream missing signal
    CANCELLED = "cancelled"


# Mapping from TierStatus to a compact wire string.
def _tier_status(s: Any) -> str:
    return s.value if isinstance(s, TierStatus) else str(s)


def _run_status(s: Any) -> str:
    return s.value if isinstance(s, RunStatus) else str(s)


# ---------------------------------------------------------------------------
# ADR-0004 helpers: ISO 8601 + SHA1 + idempotency key
# ---------------------------------------------------------------------------

_SHA1_RE = re.compile(r"^[0-9a-f]{40}$")
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _is_hex_sha(s: str) -> bool:
    return bool(s) and _SHA1_RE.match(s) is not None


def _is_iso8601_utc(s: str) -> bool:
    return bool(s) and _ISO_RE.match(s) is not None


def _deterministic_key(*parts: Any) -> str:
    """Stable hash for default idempotency keys.  The same plan produces
    the same key across runs, which is the property retry safety
    depends on (ADR-0001 §2 principle 3: idempotent stages)."""
    payload = "|".join(str(p) for p in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


# ---------------------------------------------------------------------------
# Per-test and per-tier results
# ---------------------------------------------------------------------------

@dataclass
class TestCase:
    """One test case (or one skeleton file in v1) the agent emitted."""
    id: str
    name: str
    target: str                  # file path or symbol the test exercises
    framework: str               # "pytest" | "jest" | "playwright" | "pact" | ...
    command: str                 # the exact command line a runner can execute
    status: str                  # one of TierStatus values
    duration_ms: float = 0.0
    evidence: str = ""           # path to the emitted file, or a short log line

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TierResult:
    """The result of running one tier.

    The pre-existing fields cover counts; ADR-0004 §3.2 adds `p50_ms`,
    `p99_ms`, `sample_failures`, and `error` so the Security stage can
    reason about latency and pick representative failure evidence.
    """
    tier: str                    # one of TIER_RUN_ORDER
    framework: str
    command: str                 # the suite-level command (e.g. `pytest tests/unit/...`)
    status: str                  # one of TierStatus values
    total: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    not_implemented: int = 0
    duration_ms: float = 0.0
    p50_ms: float = 0.0          # ADR-0004 §3.2
    p99_ms: float = 0.0          # ADR-0004 §3.2
    sample_failures: List[str] = field(default_factory=list)  # ADR-0004 §3.2
    cases: List[TestCase] = field(default_factory=list)
    error: Optional[str] = None  # ADR-0004: populated when status == "errored"
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["cases"] = [c.to_dict() for c in self.cases]
        return out

    def validate(self) -> List[str]:
        errors: List[str] = []
        if self.tier not in TIER_RUN_ORDER:
            errors.append(f"TierResult.tier must be one of {TIER_RUN_ORDER}, got {self.tier!r}")
        valid_statuses = [s.value for s in TierStatus]
        if self.status not in valid_statuses:
            errors.append(
                f"TierResult.status must be one of {valid_statuses}, got {self.status!r}"
            )
        if self.total < 0:
            errors.append(f"TierResult.total must be >= 0, got {self.total}")
        if self.passed < 0 or self.failed < 0 or self.skipped < 0 or self.not_implemented < 0:
            errors.append("TierResult counts must be >= 0")
        if self.passed + self.failed + self.skipped + self.not_implemented > self.total:
            errors.append(
                f"TierResult sum of counts exceeds total ({self.total})"
            )
        if self.p50_ms < 0 or self.p99_ms < 0:
            errors.append("TierResult p50_ms/p99_ms must be >= 0")
        if self.p50_ms > self.p99_ms:
            errors.append(
                f"TierResult p50_ms ({self.p50_ms}) must be <= p99_ms ({self.p99_ms})"
            )
        if self.status == TierStatus.ERRORED.value and not self.error:
            errors.append("TierResult.error is required when status == 'errored'")
        if self.status == TierStatus.NOT_IMPLEMENTED.value and self.total > 0:
            # A not_implemented tier must have zero tests reported; otherwise
            # the contract is contradictory.
            errors.append(
                "TierResult.status == 'not_implemented' requires total == 0"
            )
        return errors


# ---------------------------------------------------------------------------
# Top-level: TestPlan, TestRun, CoverageReport
# ---------------------------------------------------------------------------

@dataclass
class TierPlan:
    """The agent's plan for one tier: framework, command, and intent."""
    tier: str                    # one of TIER_RUN_ORDER
    framework: str
    command: str
    framework_version: str = ""
    required: bool = True        # see workspace/memory/qa.md §2
    selection_rule: str = ""     # human-readable "why this tier for this change"
    files_in_scope: List[str] = field(default_factory=list)  # ADR-0004 §3.1
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TestPlan:
    """What the QA agent intends to run for one PR.

    A TestPlan is the *input* to QaAgent.run(); the caller (DevOps
    orchestrator) builds it from the merged PR metadata and the
    project knowledge layer. The agent is not responsible for picking
    tiers — that is a planning concern.

    ADR-0004 extends the pre-existing shape with the join keys the
    Audit agent and the Security stage need: `run_id`, `contract_id`,
    `branch`, `commit_sha`, `base_branch`, `idempotency_key`, plus a
    `schema_version` constant.
    """
    schema_version: str
    plan_id: str                 # "tplan-<uuid>"
    run_id: str                  # ADR-0001 §7 run id; join key
    contract_id: str             # ADR-0001 §7 contract id; join key
    source_pr: str               # e.g. "FORA-org/checkout-api#482"
    branch: str                  # "qa/test-gen"
    commit_sha: str              # 40-char lowercase hex; ADR-0001 §7 join
    base_branch: str             # "main"
    target_branch: str           # e.g. "main" (where the merged PR landed)
    tiers: List[TierPlan] = field(default_factory=list)
    issued_at: str = field(default_factory=_now)
    issued_by: str = "agent:qa"
    idempotency_key: str = ""
    v1_marker: bool = False      # FORA-46: signal "v1 deterministic run";
                                 # future tiers are surfaced as
                                 # not_implemented rather than fabricated.

    def __post_init__(self) -> None:
        if not self.idempotency_key:
            # Derived from join keys; same plan = same key.
            self.idempotency_key = _deterministic_key(
                self.run_id, self.contract_id, self.branch, self.commit_sha
            )

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["tiers"] = [t.to_dict() for t in self.tiers]
        return out

    def validate(self) -> List[str]:
        """Returns a list of validation errors; empty list means the plan is valid.

        Implements the TestPlan half of the ADR-0004 §4 invariants.

        When ``v1_marker`` is True, tiers outside ``TIER_RUN_ORDER`` are
        accepted (treated as future tiers the v1 deterministic scaffold
        cannot service); the agent surfaces them as ``not_implemented``
        rather than rejecting the plan. This is the FORA-46 v1-limits
        path.
        """
        errors: List[str] = []
        if self.schema_version != SCHEMA_VERSION:
            errors.append(
                f"TestPlan.schema_version must be {SCHEMA_VERSION!r}, "
                f"got {self.schema_version!r}"
            )
        if not self.plan_id:
            errors.append("test_plan.plan_id is required")
        if not self.run_id:
            errors.append("test_plan.run_id is required (ADR-0001 §7 join)")
        if not self.contract_id:
            errors.append("test_plan.contract_id is required (ADR-0001 §7 join)")
        if not self.source_pr:
            errors.append("test_plan.source_pr is required (e.g. 'org/repo#N')")
        if not self.branch:
            errors.append("test_plan.branch is required")
        if not _is_hex_sha(self.commit_sha):
            errors.append(
                f"test_plan.commit_sha must be 40 lowercase hex chars, got {self.commit_sha!r}"
            )
        if not self.base_branch:
            errors.append("test_plan.base_branch is required")
        if not self.target_branch:
            errors.append("test_plan.target_branch is required")
        if not self.tiers:
            errors.append("test_plan.tiers must contain at least one tier")
        seen = set()
        for tp in self.tiers:
            if tp.tier in seen:
                errors.append(f"duplicate tier in test_plan: {tp.tier}")
            seen.add(tp.tier)
            if tp.tier not in TIER_RUN_ORDER and not self.v1_marker:
                errors.append(
                    f"unknown tier {tp.tier!r}; expected one of {TIER_RUN_ORDER} "
                    f"(set v1_marker=True to allow future tiers)"
                )
            if not tp.framework:
                errors.append(f"tier {tp.tier} has no framework (tech-stack.md may be missing)")
            if not tp.command:
                errors.append(f"tier {tp.tier} has no command line")
        if not _is_iso8601_utc(self.issued_at):
            errors.append(f"test_plan.issued_at must be ISO 8601 UTC, got {self.issued_at!r}")
        if not self.idempotency_key:
            errors.append("test_plan.idempotency_key is required")
        return errors


@dataclass
class TestRun:
    """The actual outcome of running every tier in the TestPlan.

    `verdict` is the gate token for the QA → Security transition
    (workspace/memory/qa.md §5, ADR-0004 §3.2). It is one of three
    Security-actionable values: pass, fail, needs_attention. The
    broader `status` field tracks the full RunStatus enum for
    observability.

    `publish_meta` (FORA-49) carries the GitHub publisher outcome
    when the run opened or updated a `qa/test-gen` PR. It defaults
    to `None` so the v1 sample path stays a no-op until the
    publisher is wired in.
    """
    schema_version: str
    test_run_id: str             # "trun-<uuid>"
    test_plan_id: str            # join back to TestPlan
    started_at: str = field(default_factory=_now)
    finished_at: str = ""
    duration_ms: int = 0         # ADR-0004: aggregate run duration
    status: str = RunStatus.PASSED.value
    verdict: str = ""            # ADR-0004: pass | fail | needs_attention
    failure_summary: str = ""    # ADR-0004: required when verdict != pass
    mode: str = "live"           # ADR-0004: "live" | "sample" (provenance)
    tier_results: List[TierResult] = field(default_factory=list)
    publish_meta: Optional[Dict[str, Any]] = None  # FORA-49

    def __post_init__(self) -> None:
        if not self.verdict:
            # Default the Security-facing verdict from the broader status.
            if self.status == RunStatus.PASSED.value:
                self.verdict = "pass"
            elif self.status == RunStatus.FAILED.value:
                self.verdict = "fail"
            elif self.status == RunStatus.PARTIAL.value:
                self.verdict = "needs_attention"
            elif self.status == RunStatus.NEEDS_ATTENTION.value:
                self.verdict = "needs_attention"
            else:
                self.verdict = "needs_attention"

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["tier_results"] = [t.to_dict() for t in self.tier_results]
        return out

    @property
    def tests_passed(self) -> bool:
        """True only if every required tier passed and nothing failed."""
        return self.status == RunStatus.PASSED.value

    def tiers_not_implemented(self) -> List[str]:
        return [t.tier for t in self.tier_results
                if t.status == TierStatus.NOT_IMPLEMENTED.value]

    def validate(self) -> List[str]:
        """Implements the TestRun half of the ADR-0004 §4 invariants.

        Returns a list of validation errors; empty list means the run
        is valid for emission.
        """
        errors: List[str] = []
        if self.schema_version != SCHEMA_VERSION:
            errors.append(
                f"TestRun.schema_version must be {SCHEMA_VERSION!r}, "
                f"got {self.schema_version!r}"
            )
        if not self.test_run_id:
            errors.append("test_run.test_run_id is required")
        if not self.test_plan_id:
            errors.append("test_run.test_plan_id is required")
        if not _is_iso8601_utc(self.started_at):
            errors.append(
                f"test_run.started_at must be ISO 8601 UTC, got {self.started_at!r}"
            )
        if self.finished_at and not _is_iso8601_utc(self.finished_at):
            errors.append(
                f"test_run.finished_at must be ISO 8601 UTC, got {self.finished_at!r}"
            )
        if (self.finished_at and _is_iso8601_utc(self.started_at)
                and _is_iso8601_utc(self.finished_at)
                and self.started_at > self.finished_at):
            errors.append(
                f"test_run.started_at ({self.started_at}) must be <= "
                f"finished_at ({self.finished_at})"
            )
        if self.duration_ms < 0:
            errors.append(f"test_run.duration_ms must be >= 0, got {self.duration_ms}")
        valid_run_statuses = [s.value for s in RunStatus]
        if self.status not in valid_run_statuses:
            errors.append(
                f"test_run.status must be one of {valid_run_statuses}, got {self.status!r}"
            )
        if self.verdict not in ("pass", "fail", "needs_attention"):
            errors.append(
                f"test_run.verdict must be one of ('pass','fail','needs_attention'), "
                f"got {self.verdict!r}"
            )
        # ADR-0004 §4 invariant 8: failure_summary is required when verdict != pass.
        if self.verdict != "pass" and not self.failure_summary:
            errors.append(
                f"test_run.failure_summary is required when verdict == {self.verdict!r}"
            )
        if self.mode not in ("live", "sample"):
            errors.append(
                f"test_run.mode must be 'live' or 'sample', got {self.mode!r}"
            )
        seen_tiers = set()
        for r in self.tier_results:
            errs = r.validate()
            errors.extend(f"tier_results[{r.tier}] {e}" for e in errs)
            if r.tier in seen_tiers:
                errors.append(f"test_run.tier_results has duplicate tier: {r.tier!r}")
            seen_tiers.add(r.tier)
        return errors


@dataclass
class TierCoverage:
    """Coverage numbers for a single tier. mutation_score is optional."""
    tier: str
    line_pct: float
    branch_pct: float
    mutation_pct: Optional[float] = None
    available: bool = True
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def validate(self) -> List[str]:
        errors: List[str] = []
        if self.tier not in TIER_RUN_ORDER:
            errors.append(
                f"TierCoverage.tier must be one of {TIER_RUN_ORDER}, got {self.tier!r}"
            )
        for name, val in (("line_pct", self.line_pct), ("branch_pct", self.branch_pct)):
            if val is not None and not (0.0 <= val <= 1.0):
                errors.append(
                    f"TierCoverage.{name} must be in [0.0, 1.0] or null, got {val!r}"
                )
        if self.mutation_pct is not None and not (0.0 <= self.mutation_pct <= 1.0):
            errors.append(
                f"TierCoverage.mutation_pct must be in [0.0, 1.0] or null, got {self.mutation_pct!r}"
            )
        return errors


@dataclass
class CoverageReport:
    """The coverage report attached to a TestRun.

    Per workspace/memory/qa.md §3, this is an artifact, not just a
    summary line in a comment. The Security stage consumes it.

    ADR-0004 extends the pre-existing shape with `schema_version`,
    `coverage_id` (the join key), and `test_run_id` (the explicit
    back-reference to TestRun). Per-tier numbers live in `by_tier`.
    """
    schema_version: str
    coverage_id: str             # "cov-<uuid>"
    test_run_id: str             # join back to TestRun
    line_pct: float = 0.0        # aggregate across the test run
    branch_pct: float = 0.0
    mutation_pct: Optional[float] = None
    by_tier: List[TierCoverage] = field(default_factory=list)
    notes: str = ""
    produced_at: str = field(default_factory=_now)

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["by_tier"] = [t.to_dict() for t in self.by_tier]
        return out

    def validate(self) -> List[str]:
        """Implements the CoverageReport half of the ADR-0004 §4 invariants."""
        errors: List[str] = []
        if self.schema_version != SCHEMA_VERSION:
            errors.append(
                f"CoverageReport.schema_version must be {SCHEMA_VERSION!r}, "
                f"got {self.schema_version!r}"
            )
        if not self.coverage_id:
            errors.append("coverage_report.coverage_id is required")
        if not self.test_run_id:
            errors.append("coverage_report.test_run_id is required")
        for name, val in (
            ("line_pct", self.line_pct),
            ("branch_pct", self.branch_pct),
        ):
            if val is not None and not (0.0 <= val <= 1.0):
                errors.append(
                    f"coverage_report.{name} must be in [0.0, 1.0] or null, got {val!r}"
                )
        if self.mutation_pct is not None and not (0.0 <= self.mutation_pct <= 1.0):
            errors.append(
                f"coverage_report.mutation_pct must be in [0.0, 1.0] or null, "
                f"got {self.mutation_pct!r}"
            )
        if not self.by_tier:
            errors.append("coverage_report.by_tier must contain at least one tier")
        seen = set()
        for tc in self.by_tier:
            errs = tc.validate()
            errors.extend(f"by_tier[{tc.tier}] {e}" for e in errs)
            if tc.tier in seen:
                errors.append(f"coverage_report.by_tier has duplicate tier: {tc.tier!r}")
            seen.add(tc.tier)
        if not _is_iso8601_utc(self.produced_at):
            errors.append(
                f"coverage_report.produced_at must be ISO 8601 UTC, got {self.produced_at!r}"
            )
        return errors


# ---------------------------------------------------------------------------
# ID factories
# ---------------------------------------------------------------------------

def new_plan_id() -> str:
    return f"tplan-{uuid.uuid4().hex[:12]}"


def new_test_run_id() -> str:
    return f"trun-{uuid.uuid4().hex[:12]}"


def new_coverage_id() -> str:
    return f"cov-{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Pre-existing helper, kept
# ---------------------------------------------------------------------------

def derive_run_status(tier_results: List[TierResult]) -> str:
    """Reduce per-tier status to a single RunStatus.

    Rules (matching workspace/memory/qa.md §2 and §5):

    * any FAILED tier -> FAILED
    * any PASSED tier and no FAILED, with NOT_IMPLEMENTED on a required tier -> BLOCKED
    * mix of PASSED and NOT_IMPLEMENTED only (no failures) -> PARTIAL
    * all PASSED -> PASSED
    * no results -> BLOCKED

    Note: `required` here is a plan-level concept, not a result-level
    one; we look it up via TierPlan when needed. For a per-result
    decision, callers can use the `verdict` field on TestRun.
    """
    if not tier_results:
        return RunStatus.BLOCKED.value
    statuses = [t.status for t in tier_results]
    if any(s == TierStatus.FAILED.value for s in statuses):
        return RunStatus.FAILED.value
    not_impl = [t for t in tier_results if t.status == TierStatus.NOT_IMPLEMENTED.value]
    if not_impl:
        return RunStatus.PARTIAL.value
    if any(s == TierStatus.PASSED.value for s in statuses):
        return RunStatus.PASSED.value
    return RunStatus.BLOCKED.value


# Public re-exports for `from agents.qa.schemas import ...`
__all__ = [
    "SCHEMA_VERSION",
    "TestTier",
    "TIER_RUN_ORDER",
    "TierStatus",
    "RunStatus",
    "TestCase",
    "TierPlan",
    "TierResult",
    "TestPlan",
    "TestRun",
    "TierCoverage",
    "CoverageReport",
    "derive_run_status",
    "new_plan_id",
    "new_test_run_id",
    "new_coverage_id",
]

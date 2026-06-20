"""
Schemas for the Coding Agent's input and output, and the Reviewer
Agent's input and output.

The Coding Agent (Sub-goal 3.2) converts an approved Story Plan
(Sub-goal 3.1) into a structured Code Diff — a set of file changes
plus a unified-diff string. The Reviewer Agent (Sub-goal 3.3) reads
that diff and emits a Review Report — findings by severity, an
inline-comment list for posting back to GitHub, and an APPROVE /
REQUEST_CHANGES verdict.

A change here is a breaking change to the Dev pipeline; the schema
version is the contract for that.
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class FileAction(str, Enum):
    """What the diff wants done with the file.

    v0.1 only emits CREATE. MODIFY and DELETE land in v0.2 when the
    Coding Agent is LLM-backed and can edit existing code.
    """

    CREATE = "create"
    MODIFY = "modify"
    DELETE = "delete"


class Language(str, Enum):
    """Language of a file. Used for stats and review heuristics."""

    PYTHON = "python"
    SQL = "sql"
    YAML = "yaml"
    MARKDOWN = "markdown"
    JSON = "json"
    UNKNOWN = "unknown"


@dataclass
class FileChange:
    """A single file change in the code diff.

    The traceability fields (task_id, task_type, ac_refs) are what the
    Reviewer (Sub-goal 3.3) uses to map files back to plan tasks and
    acceptance criteria.
    """

    path: str
    action: FileAction
    content: str
    language: Language
    task_id: str
    task_type: str  # the TaskType.value
    ac_refs: List[str] = field(default_factory=list)
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["action"] = self.action.value
        out["language"] = self.language.value
        return out


@dataclass
class CodeDiffSummary:
    """Aggregate stats for the diff."""

    total_files: int
    total_lines: int
    lines_added: int
    lines_removed: int
    by_language: Dict[str, int]  # language_value -> file count
    ac_coverage: List[str]  # sorted list of AC refs touched
    task_coverage: List[str]  # sorted list of task ids covered

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CodeDiff:
    """The Coding Agent's output: a structured diff with file changes.

    The unified_diff is ready for `git apply` (after a human review) or
    a GitHub MCP PR. The agent itself never applies or commits it; the
    orchestrator / operator owns the apply/commit step (per Epic 3's
    "no direct commit by the agent" rule).
    """

    diff_id: str
    plan_id: str
    story_id: str
    files: List[FileChange]
    unified_diff: str
    summary: CodeDiffSummary
    generated_at: str
    schema_version: str = "0.1.0"

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["files"] = [f.to_dict() for f in self.files]
        out["summary"] = self.summary.to_dict()
        return out

    def validate(self) -> List[str]:
        """Validate the diff. Returns a list of errors; empty = valid."""
        errors: List[str] = []
        if not self.story_id:
            errors.append("story_id is required")
        if not self.plan_id:
            errors.append("plan_id is required")
        if not self.diff_id:
            errors.append("diff_id is required")
        if not self.files:
            errors.append("diff must contain at least one file")

        seen_paths: set = set()
        for f in self.files:
            if not f.path:
                errors.append(f"file with empty path (task {f.task_id})")
                continue
            if f.path in seen_paths:
                errors.append(f"duplicate file path: {f.path}")
            seen_paths.add(f.path)
            if not f.content:
                errors.append(f"file {f.path}: content is empty")
            if not f.task_id:
                errors.append(f"file {f.path}: task_id is empty")

        if self.summary.total_files != len(self.files):
            errors.append(
                f"summary.total_files ({self.summary.total_files}) does not match "
                f"len(files) ({len(self.files)})"
            )

        return errors


# --- helpers -------------------------------------------------------------


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def derive_diff_id(plan_id: str) -> str:
    """Stable diff id derived from plan_id.

    Same plan_id → same diff_id. The Reviewer (3.3) can use this to
    join the Coding output with the Plan input without an explicit
    mapping field.
    """
    digest = hashlib.sha1(plan_id.encode("utf-8")).hexdigest()[:10]
    return f"diff-{digest}"


# ---------------------------------------------------------------------------
# Reviewer Agent (Sub-goal 3.3) schemas
# ---------------------------------------------------------------------------


class Severity(str, Enum):
    """How urgently a finding must be addressed.

    The contract (per FORA-19 plan §3.3) is:

      BLOCKER         — must be fixed before merge. Forces REQUEST_CHANGES.
      SUGGESTION      — non-blocking; address before approval is final.
      NIT             — cosmetic; safe to ignore or fix in a follow-up.

    Severity drives the verdict (one BLOCKER ⇒ REQUEST_CHANGES). The
    inline-comment mapping (blocker / suggestion / nit) is preserved
    in this enum's string values.
    """

    BLOCKER = "blocker"
    SUGGESTION = "suggestion"
    NIT = "nit"


class FindingCategory(str, Enum):
    """The six review lenses the FORA-19 plan §3.3 contract enumerates.

    Every finding carries exactly one category. The category drives
    routing in the orchestrator (security findings escalate, perf
    findings queue, nits batch).
    """

    CLEAN_CODE = "clean_code"
    ARCHITECTURE = "architecture"
    PERFORMANCE = "performance"
    SECURITY = "security"
    DUPLICATION = "duplication"
    TEST_QUALITY = "test_quality"


class Verdict(str, Enum):
    """The review verdict posted back to the PR.

    APPROVE           — no blockers; suggestions/nits may exist.
    REQUEST_CHANGES   — at least one blocker. Loop back to 3.2.

    The Reviewer never merges. Merge is a human action (per
    FORA-19 §3.3 "Never merges").
    """

    APPROVE = "APPROVE"
    REQUEST_CHANGES = "REQUEST_CHANGES"


@dataclass
class InlineLocation:
    """A single file:line anchor for an inline comment.

    line is 1-indexed. If the finding can't pin to a specific line
    (e.g. cross-file duplication), line is 0.
    """

    path: str
    line: int = 0


@dataclass
class ReviewFinding:
    """A single review finding.

    `rule_id` is the stable identifier of the rule that produced
    the finding (e.g. ``SEC001``). `locations` anchors the finding
    to specific file:line positions; multi-location findings (e.g.
    duplication) carry one location per file.
    """

    severity: Severity
    category: FindingCategory
    rule_id: str
    message: str
    locations: List[InlineLocation] = field(default_factory=list)
    suggestion: Optional[str] = None  # human-readable fix hint

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["severity"] = self.severity.value
        out["category"] = self.category.value
        return out


@dataclass
class ReviewSummary:
    """Aggregate counts for a review report."""

    total_findings: int
    blockers: int
    suggestions: int
    nits: int
    by_category: Dict[str, int]  # category_value -> count
    files_reviewed: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ReviewReport:
    """The Reviewer Agent's output: a verdict, findings, and inline
    comments ready to post back to the PR.

    The Report is what the orchestrator hands to the GitHub MCP to
    post comments and to flip the review state. It carries enough
    state to be replayable: same diff + same reviewer instance →
    same report bytes (when the v0.2 LLM-backed path lands, this
    will become best-effort instead of strict).
    """

    report_id: str
    diff_id: str
    story_id: str
    plan_id: str
    findings: List[ReviewFinding]
    verdict: Verdict
    summary: ReviewSummary
    generated_at: str
    schema_version: str = "0.1.0"

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["findings"] = [f.to_dict() for f in self.findings]
        out["summary"] = self.summary.to_dict()
        out["verdict"] = self.verdict.value
        return out

    def validate(self) -> List[str]:
        """Validate the report. Returns a list of errors; empty = valid."""
        errors: List[str] = []
        if not self.report_id:
            errors.append("report_id is required")
        if not self.diff_id:
            errors.append("diff_id is required")
        if not self.story_id:
            errors.append("story_id is required")
        if not self.plan_id:
            errors.append("plan_id is required")

        # Verdict invariant: any BLOCKER finding must produce REQUEST_CHANGES.
        has_blocker = any(f.severity == Severity.BLOCKER for f in self.findings)
        if has_blocker and self.verdict != Verdict.REQUEST_CHANGES:
            errors.append(
                f"verdict {self.verdict.value} is inconsistent with "
                f"{sum(1 for f in self.findings if f.severity == Severity.BLOCKER)} "
                f"blocker finding(s) — must be REQUEST_CHANGES"
            )

        # Summary counts must match the actual findings.
        actual_blockers = sum(1 for f in self.findings if f.severity == Severity.BLOCKER)
        actual_suggestions = sum(1 for f in self.findings if f.severity == Severity.SUGGESTION)
        actual_nits = sum(1 for f in self.findings if f.severity == Severity.NIT)
        if self.summary.blockers != actual_blockers:
            errors.append(
                f"summary.blockers ({self.summary.blockers}) does not match "
                f"actual ({actual_blockers})"
            )
        if self.summary.suggestions != actual_suggestions:
            errors.append(
                f"summary.suggestions ({self.summary.suggestions}) does not match "
                f"actual ({actual_suggestions})"
            )
        if self.summary.nits != actual_nits:
            errors.append(
                f"summary.nits ({self.summary.nits}) does not match "
                f"actual ({actual_nits})"
            )
        if self.summary.total_findings != len(self.findings):
            errors.append(
                f"summary.total_findings ({self.summary.total_findings}) does not "
                f"match len(findings) ({len(self.findings)})"
            )

        return errors


def derive_report_id(diff_id: str) -> str:
    """Stable report id derived from diff_id.

    Same diff_id → same report_id. Lets the orchestrator correlate a
    posted GitHub review with its underlying Coding Agent run without
    a separate mapping table.
    """
    digest = hashlib.sha1(diff_id.encode("utf-8")).hexdigest()[:10]
    return f"rev-{digest}"

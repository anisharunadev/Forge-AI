"""
Reviewer Agent core — deterministic CodeDiff → ReviewReport.

v0.1 implementation of Epic 3 / Sub-goal 3.3 (FORA-71). Consumes the
Coding Agent's CodeDiff output (Sub-goal 3.2, FORA-70) and emits a
ReviewReport with:

  - a list of ReviewFinding records (severity × category × rule_id)
  - a deterministic Verdict: any BLOCKER ⇒ REQUEST_CHANGES,
    otherwise APPROVE
  - a ReviewSummary with per-severity / per-category counts
  - inline-comment anchors ready for the GitHub MCP to post

The six review lenses from the FORA-19 plan §3.3 contract:

  clean_code, architecture, performance, security,
  duplication, test_quality

Hard rules (per FORA-19 §3.3):

  - Never merges. Merge is a human action.
  - On REQUEST_CHANGES, control returns to 3.2 (Coding); on
    APPROVE, the PR is ready for human merge.

v0.1 is rule-based and deterministic — same diff + same Reviewer
instance ⇒ same report bytes. v0.2 will swap the rule body for an
LLM call but keep the public API stable. The Reviewer does NOT
itself call out to GitHub / GitHub MCP; the orchestrator owns the
post step.

The Reviewer also does NOT touch the protected-branch rule (that is
enforced at the repo + GitHub + audit layer per FORA-19 §3.2). Its
job is purely the verdict + inline-comment payload.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from .schemas import (
    CodeDiff,
    FileAction,
    FileChange,
    FindingCategory,
    InlineLocation,
    ReviewFinding,
    ReviewReport,
    ReviewSummary,
    Severity,
    Verdict,
    _utcnow_iso,
    derive_report_id,
)


# ---------------------------------------------------------------------------
# Rule primitive — one check, one severity, one category
# ---------------------------------------------------------------------------


@dataclass
class Rule:
    """A single review rule.

    `check` returns a list of ``ReviewFinding``s. Empty list means
    the rule passed. The rule is responsible for emitting findings
    with stable ``rule_id``s so the orchestrator can dedupe / route
    them across runs.
    """

    rule_id: str
    severity: Severity
    category: FindingCategory
    description: str
    check: Callable[[CodeDiff], List[ReviewFinding]]


# ---------------------------------------------------------------------------
# Security rules (BLOCKERs)
# ---------------------------------------------------------------------------


_HARDCODED_SECRET_PATTERNS = [
    (re.compile(r"""(?ix)\b(password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{3,}['"]"""), "hardcoded_password"),
    (re.compile(r"""(?ix)\b(api[_-]?key|apikey)\s*[:=]\s*['"][^'"\s]{8,}['"]"""), "hardcoded_api_key"),
    (re.compile(r"""(?ix)\b(secret|secret[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]"""), "hardcoded_secret"),
    (re.compile(r"""(?ix)\b(token|access[_-]?token|bearer)\s*[:=]\s*['"][^'"\s]{12,}['"]"""), "hardcoded_token"),
]


def _check_hardcoded_secrets(diff: CodeDiff) -> List[ReviewFinding]:
    """Block any literal credentials checked into source."""
    findings: List[ReviewFinding] = []
    for f in diff.files:
        if f.language.value not in ("python", "yaml", "json"):
            continue
        for line_no, line in enumerate(f.content.splitlines(), start=1):
            for pattern, kind in _HARDCODED_SECRET_PATTERNS:
                if pattern.search(line):
                    findings.append(
                        ReviewFinding(
                            severity=Severity.BLOCKER,
                            category=FindingCategory.SECURITY,
                            rule_id="SEC001",
                            message=(
                                f"{kind} detected in {f.path}:{line_no}. "
                                "Load secrets via the secrets broker, never inline."
                            ),
                            locations=[InlineLocation(path=f.path, line=line_no)],
                            suggestion=(
                                "Replace the literal with a `secret.get(name)` call "
                                "and wire the secret through the tenant policy."
                            ),
                        )
                    )
    return findings


_DANGEROUS_CALL_PATTERNS = [
    (re.compile(r"""\beval\s*\("""), "eval_call"),
    (re.compile(r"""\bexec\s*\("""), "exec_call"),
    (re.compile(r"""\bos\.system\s*\("""), "os_system_call"),
    (re.compile(r"""\bsubprocess\.call\s*\("""), "subprocess_call"),
]


def _check_dangerous_calls(diff: CodeDiff) -> List[ReviewFinding]:
    """Block eval/exec/os.system — they bypass the audit boundary."""
    findings: List[ReviewFinding] = []
    for f in diff.files:
        if f.language.value != "python":
            continue
        for line_no, line in enumerate(f.content.splitlines(), start=1):
            for pattern, kind in _DANGEROUS_CALL_PATTERNS:
                if pattern.search(line):
                    findings.append(
                        ReviewFinding(
                            severity=Severity.BLOCKER,
                            category=FindingCategory.SECURITY,
                            rule_id="SEC002",
                            message=(
                                f"{kind} detected in {f.path}:{line_no}. "
                                "These bypass the agent audit boundary."
                            ),
                            locations=[InlineLocation(path=f.path, line=line_no)],
                            suggestion="Refactor to an explicit API call that the audit log can capture.",
                        )
                    )
    return findings


_SQL_INJECTION_PATTERNS = [
    re.compile(r"""['"]\s*SELECT\s+.*\+""", re.IGNORECASE),
    re.compile(r"""['"]\s*INSERT\s+.*\+""", re.IGNORECASE),
    re.compile(r"""['"]\s*UPDATE\s+.*\+""", re.IGNORECASE),
    re.compile(r"""['"]\s*DELETE\s+.*\+""", re.IGNORECASE),
    re.compile(r"""['"]\s*DROP\s+.*\+""", re.IGNORECASE),
    re.compile(r"""f['"]\s*(SELECT|INSERT|UPDATE|DELETE|DROP)\b""", re.IGNORECASE),
]


def _check_sql_injection(diff: CodeDiff) -> List[ReviewFinding]:
    """Block SQL string concatenation / f-string interpolation in code."""
    findings: List[ReviewFinding] = []
    for f in diff.files:
        if f.language.value != "python":
            continue
        for line_no, line in enumerate(f.content.splitlines(), start=1):
            for pattern in _SQL_INJECTION_PATTERNS:
                if pattern.search(line):
                    findings.append(
                        ReviewFinding(
                            severity=Severity.BLOCKER,
                            category=FindingCategory.SECURITY,
                            rule_id="SEC003",
                            message=(
                                f"possible SQL injection vector in {f.path}:{line_no}. "
                                "SQL must use parameterized statements."
                            ),
                            locations=[InlineLocation(path=f.path, line=line_no)],
                            suggestion=(
                                "Use a parameterized statement (cursor.execute(sql, params)) "
                                "or an ORM query."
                            ),
                        )
                    )
    return findings


# ---------------------------------------------------------------------------
# Architecture rules (BLOCKERs)
# ---------------------------------------------------------------------------


def _make_path_compliance_check(
    *,
    task_type: str,
    expected_substring: str,
    rule_id: str,
    kind_label: str,
    suggestion: str,
):
    """Build an ARC00x check that flags files of `task_type` whose path
    is missing `expected_substring` (e.g. `/models/`).

    Centralises the four near-identical ARC001-ARC004 functions that
    were copy-pasted in the initial commit.
    """

    def _check(diff: CodeDiff) -> List[ReviewFinding]:
        findings: List[ReviewFinding] = []
        for f in diff.files:
            if f.task_type != task_type:
                continue
            if expected_substring in f.path:
                continue
            findings.append(
                ReviewFinding(
                    severity=Severity.BLOCKER,
                    category=FindingCategory.ARCHITECTURE,
                    rule_id=rule_id,
                    message=(
                        f"{kind_label} task placed outside {expected_substring} "
                        f"— got {f.path}"
                    ),
                    locations=[InlineLocation(path=f.path)],
                    suggestion=suggestion,
                )
            )
        return findings

    return _check


_check_model_path = _make_path_compliance_check(
    task_type="model",
    expected_substring="/models/",
    rule_id="ARC001",
    kind_label="model",
    suggestion="Move to apps/<service>/src/models/<entity>.py",
)
_check_service_path = _make_path_compliance_check(
    task_type="service",
    expected_substring="/services/",
    rule_id="ARC002",
    kind_label="service",
    suggestion="Move to apps/<service>/src/services/<entity>_service.py",
)
_check_controller_path = _make_path_compliance_check(
    task_type="controller",
    expected_substring="/controllers/",
    rule_id="ARC003",
    kind_label="controller",
    suggestion="Move to apps/<service>/src/controllers/<entity>_controller.py",
)
_check_migration_path = _make_path_compliance_check(
    task_type="migration",
    expected_substring="/migrations/",
    rule_id="ARC004",
    kind_label="migration",
    suggestion="Move to apps/<service>/src/db/migrations/<seq>_<name>.sql",
)


def _check_model_id_field(diff: CodeDiff) -> List[ReviewFinding]:
    """ARC005 — Python models must declare `id: uuid.UUID`.

    We look for an actual dataclass field (line-start `id:` preceded by whitespace)
    so docstring mentions of "id:" don't trigger false positives.
    """
    field_re = re.compile(r"^\s+id\s*:\s*uuid\.UUID\b", flags=re.MULTILINE)
    findings: List[ReviewFinding] = []
    for f in diff.files:
        if f.task_type != "model" or f.language.value != "python":
            continue
        if not field_re.search(f.content):
            findings.append(
                ReviewFinding(
                    severity=Severity.BLOCKER,
                    category=FindingCategory.ARCHITECTURE,
                    rule_id="ARC005",
                    message=(
                        f"model {f.path} missing `id: uuid.UUID` field — "
                        "every persisted entity needs an id"
                    ),
                    locations=[InlineLocation(path=f.path)],
                    suggestion="Add `id: uuid.UUID` to the @dataclass.",
                )
            )
    return findings


def _check_migration_id_column(diff: CodeDiff) -> List[ReviewFinding]:
    """ARC006 — SQL migrations must declare `id UUID PRIMARY KEY`."""
    findings: List[ReviewFinding] = []
    for f in diff.files:
        if f.task_type != "migration" or f.language.value != "sql":
            continue
        if "id UUID PRIMARY KEY" not in f.content:
            findings.append(
                ReviewFinding(
                    severity=Severity.BLOCKER,
                    category=FindingCategory.ARCHITECTURE,
                    rule_id="ARC006",
                    message=(
                        f"migration {f.path} missing `id UUID PRIMARY KEY` column"
                    ),
                    locations=[InlineLocation(path=f.path)],
                    suggestion="Add `id UUID PRIMARY KEY` as the first column.",
                )
            )
    return findings


# ---------------------------------------------------------------------------
# Test quality rules
# ---------------------------------------------------------------------------


def _check_test_coverage(diff: CodeDiff) -> List[ReviewFinding]:
    """Every non-trivial implementation file should have a paired test."""
    findings: List[ReviewFinding] = []
    paths = {f.path for f in diff.files}
    for f in diff.files:
        if f.task_type in ("model", "service", "controller") and f.action == FileAction.CREATE:
            # Look for a corresponding test file.
            slug = f.path.rsplit("/", 1)[-1].replace(".py", "").replace("_service", "").replace("_controller", "")
            has_test = any(
                ("/test/" in p or "/tests/" in p) and slug in p
                for p in paths
            )
            if not has_test:
                findings.append(
                    ReviewFinding(
                        severity=Severity.BLOCKER,
                        category=FindingCategory.TEST_QUALITY,
                        rule_id="TST001",
                        message=(
                            f"no test file found for {f.path}. "
                            "Implementation without tests blocks merge."
                        ),
                        locations=[InlineLocation(path=f.path)],
                        suggestion=(
                            f"Add apps/<service>/test/unit/{slug}_test.py "
                            "with at least one happy-path test."
                        ),
                    )
                )
    return findings


# ---------------------------------------------------------------------------
# Performance rules (SUGGESTIONs)
# ---------------------------------------------------------------------------


def _check_sync_service(diff: CodeDiff) -> List[ReviewFinding]:
    """Service CRUD methods should be async to keep the event loop unblocked."""
    findings: List[ReviewFinding] = []
    for f in diff.files:
        if f.task_type != "service" or f.language.value != "python":
            continue
        # Match `def create(`, `def get(`, etc. — must be `async def` instead.
        sync_methods = re.findall(r"^(\s+)def\s+(create|get|list|update|delete)\s*\(", f.content, flags=re.MULTILINE)
        if sync_methods:
            # Group into one finding per file; the rule emits a single multi-location
            # finding so the inline-comment payload stays compact.
            locations = []
            for line_no, line in enumerate(f.content.splitlines(), start=1):
                for indent, name in sync_methods:
                    if re.search(rf"^{re.escape(indent)}def\s+{name}\s*\(", line):
                        locations.append(InlineLocation(path=f.path, line=line_no))
                        break
            findings.append(
                ReviewFinding(
                    severity=Severity.SUGGESTION,
                    category=FindingCategory.PERFORMANCE,
                    rule_id="PERF001",
                    message=(
                        f"service methods in {f.path} should be `async def` "
                        "to keep the FastAPI event loop unblocked"
                    ),
                    locations=locations,
                    suggestion="Add `async` to the method signatures and `await` the DB calls.",
                )
            )
    return findings


def _check_pagination(diff: CodeDiff) -> List[ReviewFinding]:
    """Service `.list()` should accept limit/offset (or cursor) for pagination."""
    findings: List[ReviewFinding] = []
    for f in diff.files:
        if f.task_type != "service" or f.language.value != "python":
            continue
        # Look for a `list` method that doesn't include `limit` or `offset` in its signature.
        m = re.search(r"def\s+list\s*\(\s*self\s*\)\s*->", f.content)
        if m:
            findings.append(
                ReviewFinding(
                    severity=Severity.SUGGESTION,
                    category=FindingCategory.PERFORMANCE,
                    rule_id="PERF002",
                    message=(
                        f"service.list() in {f.path} has no pagination — "
                        "unbounded queries can OOM the worker"
                    ),
                    locations=[InlineLocation(path=f.path)],
                    suggestion="Add `limit: int = 50, offset: int = 0` (or cursor) and apply at the DB.",
                )
            )
    return findings


# ---------------------------------------------------------------------------
# Duplication rules (SUGGESTIONs)
# ---------------------------------------------------------------------------


def _check_duplicate_files(diff: CodeDiff) -> List[ReviewFinding]:
    """Flag files with identical content (e.g. a copy-pasted controller)."""
    findings: List[ReviewFinding] = []
    by_hash: Dict[str, List[FileChange]] = {}
    for f in diff.files:
        if f.action != FileAction.CREATE:
            continue
        h = hashlib.sha1(f.content.encode("utf-8")).hexdigest()
        by_hash.setdefault(h, []).append(f)
    for h, group in by_hash.items():
        if len(group) > 1:
            paths = ", ".join(sorted(g.path for g in group))
            findings.append(
                ReviewFinding(
                    severity=Severity.SUGGESTION,
                    category=FindingCategory.DUPLICATION,
                    rule_id="DUP001",
                    message=(
                        f"{len(group)} files have byte-identical content: {paths}. "
                        "Extract a shared helper or template."
                    ),
                    locations=[InlineLocation(path=g.path) for g in group],
                    suggestion="Promote the shared body to a helper / base class.",
                )
            )
    return findings


# ---------------------------------------------------------------------------
# Clean-code rules (NITs)
# ---------------------------------------------------------------------------


def _check_line_length(diff: CodeDiff) -> List[ReviewFinding]:
    """Flag lines longer than 120 chars in Python files (PEP-8 + readability)."""
    findings: List[ReviewFinding] = []
    LIMIT = 120
    for f in diff.files:
        if f.language.value != "python":
            continue
        bad = [
            (line_no, line)
            for line_no, line in enumerate(f.content.splitlines(), start=1)
            if len(line) > LIMIT
        ]
        if not bad:
            continue
        # Coalesce into one finding per file with up to 3 example line numbers.
        sample = ", ".join(str(n) for n, _ in bad[:3])
        findings.append(
            ReviewFinding(
                severity=Severity.NIT,
                category=FindingCategory.CLEAN_CODE,
                rule_id="CLN001",
                message=(
                    f"{len(bad)} line(s) in {f.path} exceed {LIMIT} chars "
                    f"(first few: L{sample})"
                ),
                locations=[InlineLocation(path=f.path, line=n) for n, _ in bad[:5]],
                suggestion="Wrap long lines (strings, signatures, comments).",
            )
        )
    return findings


def _check_missing_trailing_newline(diff: CodeDiff) -> List[ReviewFinding]:
    """Every file should end with a single trailing newline."""
    findings: List[ReviewFinding] = []
    for f in diff.files:
        if not f.content:
            continue
        if not f.content.endswith("\n"):
            findings.append(
                ReviewFinding(
                    severity=Severity.NIT,
                    category=FindingCategory.CLEAN_CODE,
                    rule_id="CLN002",
                    message=f"{f.path} is missing a trailing newline",
                    locations=[InlineLocation(path=f.path)],
                    suggestion="Add a newline at EOF.",
                )
            )
        elif f.content.endswith("\n\n"):
            findings.append(
                ReviewFinding(
                    severity=Severity.NIT,
                    category=FindingCategory.CLEAN_CODE,
                    rule_id="CLN003",
                    message=f"{f.path} has more than one trailing newline",
                    locations=[InlineLocation(path=f.path)],
                    suggestion="Keep exactly one trailing newline.",
                )
            )
    return findings


def _check_todo_markers(diff: CodeDiff) -> List[ReviewFinding]:
    """Flag TODO markers in non-scaffold files (v0.1 scaffolds use TODO[3.2/v0.2])."""
    findings: List[ReviewFinding] = []
    todo_re = re.compile(r"TODO\[([^\]]+)\]|FIXME|XXX", re.IGNORECASE)
    for f in diff.files:
        matches = []
        for line_no, line in enumerate(f.content.splitlines(), start=1):
            if todo_re.search(line):
                matches.append((line_no, line.strip()))
        if not matches:
            continue
        # v0.1 scaffolds carry `TODO[3.2/v0.2]` by design — note as NIT, not BLOCKER.
        if all("TODO[3.2/v0.2]" in line for _, line in matches):
            findings.append(
                ReviewFinding(
                    severity=Severity.NIT,
                    category=FindingCategory.TEST_QUALITY,
                    rule_id="CLN004",
                    message=(
                        f"{f.path} contains {len(matches)} `TODO[3.2/v0.2]` marker(s) "
                        "— expected for v0.1 scaffold; resolved in v0.2"
                    ),
                    locations=[InlineLocation(path=f.path, line=n) for n, _ in matches[:3]],
                    suggestion="Fill in the bodies per the plan task's AC descriptions.",
                )
            )
        else:
            # Generic TODO / FIXME / XXX in production code — SUGGESTION.
            findings.append(
                ReviewFinding(
                    severity=Severity.SUGGESTION,
                    category=FindingCategory.CLEAN_CODE,
                    rule_id="CLN005",
                    message=(
                        f"{f.path} contains {len(matches)} generic TODO/FIXME marker(s); "
                        "file an issue and link it"
                    ),
                    locations=[InlineLocation(path=f.path, line=n) for n, _ in matches[:3]],
                    suggestion="Replace `TODO` with a tracked ticket reference.",
                )
            )
    return findings


# ---------------------------------------------------------------------------
# Rule registry
# ---------------------------------------------------------------------------


RULES: List[Rule] = [
    Rule("SEC001", Severity.BLOCKER, FindingCategory.SECURITY, "hardcoded credentials", _check_hardcoded_secrets),
    Rule("SEC002", Severity.BLOCKER, FindingCategory.SECURITY, "dangerous calls (eval/exec/os.system)", _check_dangerous_calls),
    Rule("SEC003", Severity.BLOCKER, FindingCategory.SECURITY, "SQL string concatenation / f-string", _check_sql_injection),
    Rule("ARC001", Severity.BLOCKER, FindingCategory.ARCHITECTURE, "model path compliance", _check_model_path),
    Rule("ARC002", Severity.BLOCKER, FindingCategory.ARCHITECTURE, "service path compliance", _check_service_path),
    Rule("ARC003", Severity.BLOCKER, FindingCategory.ARCHITECTURE, "controller path compliance", _check_controller_path),
    Rule("ARC004", Severity.BLOCKER, FindingCategory.ARCHITECTURE, "migration path compliance", _check_migration_path),
    Rule("ARC005", Severity.BLOCKER, FindingCategory.ARCHITECTURE, "model has id: uuid.UUID", _check_model_id_field),
    Rule("ARC006", Severity.BLOCKER, FindingCategory.ARCHITECTURE, "migration has id UUID PRIMARY KEY", _check_migration_id_column),
    Rule("TST001", Severity.BLOCKER, FindingCategory.TEST_QUALITY, "test file present for new code", _check_test_coverage),
    Rule("PERF001", Severity.SUGGESTION, FindingCategory.PERFORMANCE, "service methods async", _check_sync_service),
    Rule("PERF002", Severity.SUGGESTION, FindingCategory.PERFORMANCE, "list() paginated", _check_pagination),
    Rule("DUP001", Severity.SUGGESTION, FindingCategory.DUPLICATION, "duplicate file content", _check_duplicate_files),
    Rule("CLN001", Severity.NIT, FindingCategory.CLEAN_CODE, "line length >120", _check_line_length),
    Rule("CLN002", Severity.NIT, FindingCategory.CLEAN_CODE, "missing trailing newline", _check_missing_trailing_newline),
    Rule("CLN003", Severity.NIT, FindingCategory.CLEAN_CODE, "extra trailing newline", _check_missing_trailing_newline),
    Rule("CLN004", Severity.NIT, FindingCategory.TEST_QUALITY, "v0.1 scaffold TODO markers", _check_todo_markers),
    Rule("CLN005", Severity.SUGGESTION, FindingCategory.CLEAN_CODE, "generic TODO / FIXME / XXX", _check_todo_markers),
]


def all_rules() -> List[Rule]:
    """Flat list of every rule the Reviewer runs."""
    return list(RULES)


# ---------------------------------------------------------------------------
# Public input / output bundles
# ---------------------------------------------------------------------------


@dataclass
class ReviewerInputs:
    """Input bundle for the Reviewer Agent.

    `diff` is the Coding Agent's output (Sub-goal 3.2). `design_context`
    is optional and v0.1 ignores it; v0.2 will use it to compare the diff
    against the approved architecture (Epic 2). `report_id` is optional —
    defaults to a stable derivation from `diff_id`.
    """

    diff: CodeDiff
    design_context: Optional[Dict[str, Any]] = None
    report_id: Optional[str] = None


@dataclass
class ReviewerOutputs:
    """Output bundle — what the orchestrator hands to the GitHub MCP."""

    report: ReviewReport


# ---------------------------------------------------------------------------
# The Reviewer Agent
# ---------------------------------------------------------------------------


class Reviewer:
    """Deterministic CodeDiff → ReviewReport transformer. v0.1 is rule-based; no I/O.

    Usage:
        reviewer = Reviewer()
        out = reviewer.review(ReviewerInputs(diff=diff))
        # out.report is a ReviewReport with findings, verdict, and inline-comment anchors
    """

    def __init__(self, rules: Optional[List[Rule]] = None) -> None:
        # Allow a custom rule list for tests; default = all_rules().
        self._rules = list(rules) if rules is not None else all_rules()

    # --- public API -------------------------------------------------------

    def review(self, inputs: ReviewerInputs) -> ReviewerOutputs:
        diff = inputs.diff
        # design_context is wired in v0.2; v0.1 ignores it but reserves
        # the seam so the public API stays stable.
        _ = inputs.design_context

        findings: List[ReviewFinding] = []
        for rule in self._rules:
            findings.extend(rule.check(diff))

        # Stable order: by severity (BLOCKER first), then rule_id, then file path.
        severity_rank = {Severity.BLOCKER: 0, Severity.SUGGESTION: 1, Severity.NIT: 2}
        findings.sort(
            key=lambda f: (
                severity_rank[f.severity],
                f.rule_id,
                f.locations[0].path if f.locations else "",
                f.locations[0].line if f.locations else 0,
            )
        )

        verdict = self._compute_verdict(findings)
        summary = self._summarize(findings, diff)

        report = ReviewReport(
            report_id=inputs.report_id or derive_report_id(diff.diff_id),
            diff_id=diff.diff_id,
            story_id=diff.story_id,
            plan_id=diff.plan_id,
            findings=findings,
            verdict=verdict,
            summary=summary,
            generated_at=_utcnow_iso(),
        )

        errors = report.validate()
        if errors:
            raise ReviewerError(
                f"reviewer produced an invalid report for diff {diff.diff_id}: "
                + "; ".join(errors)
            )

        return ReviewerOutputs(report=report)

    # --- internals --------------------------------------------------------

    @staticmethod
    def _compute_verdict(findings: List[ReviewFinding]) -> Verdict:
        any_blocker = any(f.severity == Severity.BLOCKER for f in findings)
        return Verdict.REQUEST_CHANGES if any_blocker else Verdict.APPROVE

    @staticmethod
    def _summarize(findings: List[ReviewFinding], diff: CodeDiff) -> ReviewSummary:
        by_category: Dict[str, int] = {}
        for f in findings:
            key = f.category.value
            by_category[key] = by_category.get(key, 0) + 1
        return ReviewSummary(
            total_findings=len(findings),
            blockers=sum(1 for f in findings if f.severity == Severity.BLOCKER),
            suggestions=sum(1 for f in findings if f.severity == Severity.SUGGESTION),
            nits=sum(1 for f in findings if f.severity == Severity.NIT),
            by_category=by_category,
            files_reviewed=len(diff.files),
        )


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ReviewerError(RuntimeError):
    """Raised when the Reviewer cannot produce a valid report."""


# ---------------------------------------------------------------------------
# Convenience entry point — what the smoke test / orchestrator call
# ---------------------------------------------------------------------------


def review_diff(
    diff: CodeDiff, design_context: Optional[Dict[str, Any]] = None
) -> ReviewReport:
    """One-shot review. Equivalent to `Reviewer().review(ReviewerInputs(diff=diff))`."""
    return Reviewer().review(ReviewerInputs(diff=diff, design_context=design_context)).report
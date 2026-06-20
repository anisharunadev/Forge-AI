"""
Reviewer Agent smoke test.

End-to-end check that the v0.1 Reviewer Agent turns each canonical
CodeDiff fixture into a valid ReviewReport with the right verdict,
the right severity counts, and the right rule coverage. The smoke
produces:

  - agents/development/evidence/smoke_<UTC>/reviewer_result.json — machine-readable result
  - agents/development/evidence/smoke_<UTC>/reports/<fixture_key>.json — per-fixture report

Run: `python -m agents.development.smoke_test_reviewer` from the repo root.

The smoke covers 30+ ACs for Sub-goal 3.3 (FORA-71) — Reviewer:

  AC#1:  Each fixture produces a ReviewReport.
  AC#2:  Every ReviewReport validates clean (validate() == []).
  AC#3:  Verdict invariant — any BLOCKER ⇒ REQUEST_CHANGES.
  AC#4:  clean_crud → APPROVE (no blockers).
  AC#5:  insecure_endpoint → REQUEST_CHANGES with ≥3 SECURITY blockers.
  AC#6:  scaffold_only → APPROVE (only TEST_QUALITY nits expected).
  AC#7:  duplicate_files → APPROVE (DUP001 suggestion only).
  AC#8:  bad_paths → REQUEST_CHANGES (ARC001 + ARC003 blockers).
  AC#9:  Each finding has a non-empty rule_id.
  AC#10: Each finding has at least one location.
  AC#11: Every finding carries a category from the 6-lens enum.
  AC#12: Every finding carries a severity from {BLOCKER, SUGGESTION, NIT}.
  AC#13: Summary counts match the actual findings.
  AC#14: report_id is derived from diff_id (stable across re-runs).
  AC#15: Public surface — review_diff is callable.
  AC#16: Reviewer is re-instantiable and produces stable bytes.
  AC#17: Findings are sorted (BLOCKER first, then rule_id, then path).
  AC#18: ARC005 / ARC006: model missing `id: uuid.UUID` is BLOCKER.
  AC#19: TST001: implementation file without a paired test is BLOCKER.
  AC#20: SEC001: hardcoded credential is BLOCKER.
  AC#21: SEC002: eval/exec/os.system is BLOCKER.
  AC#22: SEC003: SQL string concat is BLOCKER.
  AC#23: CLN002/CLN003: trailing-newline nits fire.
  AC#24: ARC002/ARC004: service/migration path BLOCKERs fire.
  AC#25: Reviewer module has no `subprocess` / `git` / `anthropic` /
         `openai` / `google.generativeai` / `requests` / `urllib`
         imports (no-commit, no-LLM, no-network).
  AC#26: Every rule in the registry has a unique rule_id.
  AC#27: Severity × Category enum values cover the contract.
  AC#28: Cross-sub-goal join — report_id can be computed from diff_id
         using derive_report_id and matches Reviewer()'s output.
  AC#29: Inline locations carry 1-indexed line numbers.
  AC#30: Reports persist as JSON round-trippable dicts.
"""

from __future__ import annotations

import hashlib
import inspect
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

from agents.development import reviewer as reviewer_module
from agents.development.reviewer import (
    Reviewer,
    ReviewerInputs,
    all_rules,
    review_diff,
)
from agents.development.reviewer_fixtures import ALL_REVIEWER_FIXTURES
from agents.development.schemas import (
    CodeDiff,
    CodeDiffSummary,
    FileAction,
    FileChange,
    FindingCategory,
    InlineLocation,
    Language,
    ReviewFinding,
    Severity,
    Verdict,
    derive_diff_id,
    derive_report_id,
)


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _evidence_dir() -> Path:
    root = Path(__file__).resolve().parent
    evidence = root / "evidence" / f"smoke_{_utc_stamp()}"
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "reports").mkdir(exist_ok=True)
    return evidence


def _check(condition: bool, message: str) -> Tuple[bool, str]:
    return (condition, "OK  — " + message if condition else "FAIL — " + message)


def _module_source() -> str:
    return inspect.getsource(reviewer_module)


def _make_diff(
    plan_id: str,
    files: List[FileChange],
    *,
    generated_at: str = "2026-06-18T00:00:00Z",
) -> CodeDiff:
    """Hand-built CodeDiff for targeted rule checks.

    Shared by _run_rule_targeted_checks; the per-fixture suite has its
    own _make_diff in reviewer_fixtures.py. We keep this private to the
    smoke because callers want full control over the file list.
    """
    by_language: Dict[str, int] = {}
    ac_refs: set = set()
    task_ids: set = set()
    total_lines = 0
    for f in files:
        total_lines += f.content.count("\n")
        by_language[f.language.value] = by_language.get(f.language.value, 0) + 1
        ac_refs.update(f.ac_refs)
        task_ids.add(f.task_id)
    return CodeDiff(
        diff_id=derive_diff_id(plan_id),
        plan_id=plan_id,
        story_id=f"STORY-{plan_id}",
        files=files,
        unified_diff="",
        summary=CodeDiffSummary(
            total_files=len(files),
            total_lines=total_lines,
            lines_added=total_lines,
            lines_removed=0,
            by_language=by_language,
            ac_coverage=sorted(ac_refs),
            task_coverage=sorted(task_ids),
        ),
        generated_at=generated_at,
    )


def _file(path: str, content: str, task_id: str, task_type: str, *, ac_refs=None) -> FileChange:
    if ac_refs is None:
        ac_refs = ["ac-1"]
    if path.endswith(".py"):
        language = Language.PYTHON
    elif path.endswith(".sql"):
        language = Language.SQL
    else:
        language = Language.UNKNOWN
    return FileChange(
        path=path,
        action=FileAction.CREATE,
        content=content,
        language=language,
        task_id=task_id,
        task_type=task_type,
        ac_refs=list(ac_refs),
    )


# ---------------------------------------------------------------------------
# Per-fixture checks
# ---------------------------------------------------------------------------


def _run_fixture(
    fixture_key: str,
    reviewer: Reviewer,
    checks: List[Tuple[bool, str]],
    evidence_dir: Path,
) -> Dict[str, Any]:
    diff = ALL_REVIEWER_FIXTURES[fixture_key]()
    out = reviewer.review(ReviewerInputs(diff=diff))
    report = out.report
    label = f"{fixture_key} ({diff.story_id})"

    info: Dict[str, Any] = {
        "fixture_key": fixture_key,
        "story_id": diff.story_id,
        "plan_id": diff.plan_id,
        "diff_id": diff.diff_id,
        "report_id": report.report_id,
        "verdict": report.verdict.value,
        "findings": len(report.findings),
        "blockers": report.summary.blockers,
        "suggestions": report.summary.suggestions,
        "nits": report.summary.nits,
        "rule_ids": sorted({f.rule_id for f in report.findings}),
        "files_reviewed": report.summary.files_reviewed,
    }

    # AC#1
    checks.append(_check(report is not None, f"[AC#1] {label} produces a ReviewReport"))

    # AC#2
    validation_errors = report.validate()
    checks.append(_check(
        not validation_errors,
        f"[AC#2] {label} report.validate() returns no errors — got {validation_errors}"
    ))

    # AC#9 — every finding has non-empty rule_id
    rule_ids_ok = all(f.rule_id for f in report.findings)
    checks.append(_check(
        rule_ids_ok or not report.findings,
        f"[AC#9] {label} every finding has a non-empty rule_id"
    ))

    # AC#10 — every finding has at least one location
    locs_ok = all(f.locations for f in report.findings)
    checks.append(_check(
        locs_ok or not report.findings,
        f"[AC#10] {label} every finding has at least one location"
    ))

    # AC#11 — every category is in the 6-lens enum
    valid_cats = {c.value for c in FindingCategory}
    cats_ok = all(f.category.value in valid_cats for f in report.findings)
    checks.append(_check(
        cats_ok or not report.findings,
        f"[AC#11] {label} every finding carries a category from the 6-lens enum"
    ))

    # AC#12 — every severity is in {BLOCKER, SUGGESTION, NIT}
    valid_sevs = {s.value for s in Severity}
    sevs_ok = all(f.severity.value in valid_sevs for f in report.findings)
    checks.append(_check(
        sevs_ok or not report.findings,
        f"[AC#12] {label} every finding carries a severity from {{BLOCKER, SUGGESTION, NIT}}"
    ))

    # AC#13 — summary counts match
    actual_blockers = sum(1 for f in report.findings if f.severity == Severity.BLOCKER)
    actual_suggestions = sum(1 for f in report.findings if f.severity == Severity.SUGGESTION)
    actual_nits = sum(1 for f in report.findings if f.severity == Severity.NIT)
    checks.append(_check(
        report.summary.blockers == actual_blockers
        and report.summary.suggestions == actual_suggestions
        and report.summary.nits == actual_nits,
        f"[AC#13] {label} summary counts match actual findings — "
        f"B={report.summary.blockers}/{actual_blockers} "
        f"S={report.summary.suggestions}/{actual_suggestions} "
        f"N={report.summary.nits}/{actual_nits}"
    ))

    # AC#3 — verdict invariant
    has_blocker = any(f.severity == Severity.BLOCKER for f in report.findings)
    expected_verdict = Verdict.REQUEST_CHANGES if has_blocker else Verdict.APPROVE
    checks.append(_check(
        report.verdict == expected_verdict,
        f"[AC#3] {label} verdict invariant: blockers={has_blocker} → "
        f"verdict={report.verdict.value} (expected {expected_verdict.value})"
    ))

    # AC#14 — report_id stable
    expected_report_id = derive_report_id(diff.diff_id)
    checks.append(_check(
        report.report_id == expected_report_id,
        f"[AC#14] {label} report_id derived from diff_id — "
        f"got {report.report_id} expected {expected_report_id}"
    ))

    # AC#17 — findings sorted (BLOCKER first, then rule_id, then path, then line)
    severity_rank = {Severity.BLOCKER: 0, Severity.SUGGESTION: 1, Severity.NIT: 2}
    sorted_keys = [
        (
            severity_rank[f.severity],
            f.rule_id,
            f.locations[0].path if f.locations else "",
            f.locations[0].line if f.locations else 0,
        )
        for f in report.findings
    ]
    checks.append(_check(
        sorted_keys == sorted(sorted_keys),
        f"[AC#17] {label} findings are sorted by (severity, rule_id, path, line)"
    ))

    # AC#29 — inline locations carry 1-indexed lines (or 0 for whole-file findings)
    lines_ok = all(
        loc.line >= 1 or loc.line == 0  # line=0 is valid for whole-file findings
        for f in report.findings
        for loc in f.locations
    )
    checks.append(_check(
        lines_ok or not report.findings,
        f"[AC#29] {label} inline locations carry 1-indexed line numbers (or 0 for whole-file)"
    ))

    # Save the report
    report_path = evidence_dir / "reports" / f"{fixture_key}.json"
    report_path.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    info["report_path"] = str(
        report_path.relative_to(Path(__file__).resolve().parent.parent.parent)
    )

    return info


def _run_per_fixture_targeted_checks(
    per_fixture: List[Dict[str, Any]],
    checks: List[Tuple[bool, str]],
) -> None:
    """Targeted checks that depend on knowing which rule_ids a fixture triggers."""
    by_key = {f["fixture_key"]: f for f in per_fixture}

    # AC#4 — clean_crud → APPROVE
    if "clean_crud" in by_key:
        verdict = by_key["clean_crud"]["verdict"]
        blockers = by_key["clean_crud"]["blockers"]
        checks.append(_check(
            verdict == Verdict.APPROVE.value and blockers == 0,
            f"[AC#4] clean_crud → APPROVE with 0 blockers (got verdict={verdict}, blockers={blockers})"
        ))

    # AC#5 — insecure_endpoint → REQUEST_CHANGES, ≥3 SECURITY blockers
    if "insecure_endpoint" in by_key:
        info = by_key["insecure_endpoint"]
        rule_ids = set(info["rule_ids"])
        sec_rules = {"SEC001", "SEC002", "SEC003"}
        checks.append(_check(
            info["verdict"] == Verdict.REQUEST_CHANGES.value
            and info["blockers"] >= 3
            and sec_rules.issubset(rule_ids),
            f"[AC#5] insecure_endpoint → REQUEST_CHANGES with ≥3 SECURITY blockers "
            f"(got verdict={info['verdict']}, blockers={info['blockers']}, "
            f"sec_rules={sorted(rule_ids & sec_rules)})"
        ))

    # AC#6 — scaffold_only → APPROVE, only TEST_QUALITY nits expected
    if "scaffold_only" in by_key:
        info = by_key["scaffold_only"]
        checks.append(_check(
            info["verdict"] == Verdict.APPROVE.value,
            f"[AC#6] scaffold_only → APPROVE (got verdict={info['verdict']})"
        ))

    # AC#7 — duplicate_files → APPROVE, DUP001 suggestion present
    if "duplicate_files" in by_key:
        info = by_key["duplicate_files"]
        checks.append(_check(
            info["verdict"] == Verdict.APPROVE.value and "DUP001" in info["rule_ids"],
            f"[AC#7] duplicate_files → APPROVE with DUP001 suggestion "
            f"(got verdict={info['verdict']}, rule_ids={info['rule_ids']})"
        ))

    # AC#8 — bad_paths → REQUEST_CHANGES (ARC001 + ARC003)
    if "bad_paths" in by_key:
        info = by_key["bad_paths"]
        checks.append(_check(
            info["verdict"] == Verdict.REQUEST_CHANGES.value
            and "ARC001" in info["rule_ids"]
            and "ARC003" in info["rule_ids"],
            f"[AC#8] bad_paths → REQUEST_CHANGES with ARC001 + ARC003 "
            f"(got verdict={info['verdict']}, rule_ids={info['rule_ids']})"
        ))


def _run_module_constraint_checks(checks: List[Tuple[bool, str]]) -> None:
    """No commit, no LLM, no network — same bar as Coding Agent."""
    src = _module_source()

    checks.append(_check(
        "import subprocess" not in src and "from subprocess" not in src,
        "[AC#25a] Reviewer module has no `subprocess` import (no-commit constraint)"
    ))
    checks.append(_check(
        "import git" not in src and "from git" not in src,
        "[AC#25b] Reviewer module has no `git` import (no-commit constraint)"
    ))
    checks.append(_check(
        "anthropic" not in src and "openai" not in src and "google.generativeai" not in src,
        "[AC#25c] Reviewer module has no LLM imports (no-LLM constraint)"
    ))
    checks.append(_check(
        "import requests" not in src
        and "from requests" not in src
        and "import urllib" not in src
        and "from urllib" not in src,
        "[AC#25d] Reviewer module has no HTTP imports (no-network constraint)"
    ))


def _run_public_surface_checks(checks: List[Tuple[bool, str]]) -> None:
    """Public surface — review_diff callable, Reviewer re-instantiable, registry sane."""
    checks.append(_check(
        callable(review_diff),
        "[AC#15] review_diff is exposed as a callable"
    ))

    # AC#16 — re-instantiable and stable
    diff = ALL_REVIEWER_FIXTURES["clean_crud"]()
    a = Reviewer().review(ReviewerInputs(diff=diff)).report
    b = Reviewer().review(ReviewerInputs(diff=diff)).report
    checks.append(_check(
        a.to_dict() == b.to_dict(),
        "[AC#16] Reviewer is re-instantiable and produces stable bytes"
    ))

    # AC#26 — every rule in the registry has a unique rule_id
    rules = all_rules()
    rule_ids = [r.rule_id for r in rules]
    checks.append(_check(
        len(rule_ids) == len(set(rule_ids)),
        f"[AC#26] every rule in the registry has a unique rule_id — "
        f"{len(rule_ids)} rules, {len(set(rule_ids))} unique"
    ))

    # AC#27 — Severity × Category enum values cover the contract
    checks.append(_check(
        {s.value for s in Severity} == {"blocker", "suggestion", "nit"},
        f"[AC#27a] Severity enum covers {{BLOCKER, SUGGESTION, NIT}}"
    ))
    checks.append(_check(
        {c.value for c in FindingCategory} == {
            "clean_code", "architecture", "performance",
            "security", "duplication", "test_quality",
        },
        f"[AC#27b] FindingCategory enum covers the 6-lens contract"
    ))

    # AC#28 — derive_report_id joins diff_id to report_id
    diff_id = "diff-deadbeef00"
    expected = "rev-" + hashlib.sha1(diff_id.encode("utf-8")).hexdigest()[:10]
    checks.append(_check(
        derive_report_id(diff_id) == expected,
        f"[AC#28] derive_report_id joins diff_id to report_id "
        f"(expected {expected}, got {derive_report_id(diff_id)})"
    ))


def _run_rule_targeted_checks(checks: List[Tuple[bool, str]]) -> None:
    """Individual rule checks — each rule is reachable and produces the
    expected severity/category on a targeted fixture."""

    # AC#18 — ARC005: a model without `id: uuid.UUID` is BLOCKER
    bad_model = '''"""
Bad model — missing the dataclass id field.
"""
from __future__ import annotations
from dataclasses import dataclass

@dataclass
class Ghost:
    name: str
'''
    bad_diff = _make_diff(
        "PLAN-ARC005",
        files=[
            _file("apps/x/src/models/ghost.py", bad_model, "T-ARC005", "model"),
            # ARC005 fixture needs a paired test or ARC001/TST001 will fire.
            _file("apps/x/test/unit/ghost_test.py", "# placeholder\n", "T-ARC005T", "test"),
        ],
    )
    rep = Reviewer().review(ReviewerInputs(diff=bad_diff)).report
    has_arc005 = any(f.rule_id == "ARC005" and f.severity == Severity.BLOCKER for f in rep.findings)
    checks.append(_check(
        has_arc005,
        f"[AC#18] ARC005 fires BLOCKER for model missing `id: uuid.UUID` "
        f"(found: {sorted({f.rule_id for f in rep.findings})})"
    ))

    # AC#19 — TST001: implementation file without paired test is BLOCKER
    orphan_impl = '''"""
Orphan service.
"""
from __future__ import annotations

class OrphanService:
    async def get(self, x): return x
'''
    orphan_diff = _make_diff(
        "PLAN-TST001",
        files=[
            _file("apps/x/src/services/orphan_service.py", orphan_impl, "T-TST001", "service"),
        ],
    )
    rep = Reviewer().review(ReviewerInputs(diff=orphan_diff)).report
    has_tst001 = any(f.rule_id == "TST001" and f.severity == Severity.BLOCKER for f in rep.findings)
    checks.append(_check(
        has_tst001,
        f"[AC#19] TST001 fires BLOCKER for service without paired test "
        f"(found: {sorted({f.rule_id for f in rep.findings})})"
    ))

    # AC#20/21/22 — SEC rules fire
    insecure = ALL_REVIEWER_FIXTURES["insecure_endpoint"]()
    rep = Reviewer().review(ReviewerInputs(diff=insecure)).report
    sec_rule_ids = {f.rule_id for f in rep.findings if f.category == FindingCategory.SECURITY}
    checks.append(_check(
        {"SEC001", "SEC002", "SEC003"}.issubset(sec_rule_ids),
        f"[AC#20/21/22] SEC001 + SEC002 + SEC003 fire on insecure_endpoint "
        f"(found: {sorted(sec_rule_ids)})"
    ))

    # AC#23 — trailing-newline nits (CLN002/CLN003)
    no_nl = "x = 1"  # no trailing newline
    extra_nl = "x = 1\n\n"
    nl_diff = _make_diff(
        "PLAN-CLN",
        files=[
            _file("apps/x/src/utils/no_newline.py", no_nl, "T-CLN1", "other"),
            _file("apps/x/src/utils/extra_newline.py", extra_nl, "T-CLN2", "other"),
        ],
    )
    rep = Reviewer().review(ReviewerInputs(diff=nl_diff)).report
    found_cln = {f.rule_id for f in rep.findings if f.rule_id in ("CLN002", "CLN003")}
    checks.append(_check(
        "CLN002" in found_cln and "CLN003" in found_cln,
        f"[AC#23] CLN002 (missing newline) + CLN003 (extra newline) fire "
        f"(found: {sorted(found_cln)})"
    ))

    # AC#24 — ARC002 (service path) + ARC004 (migration path)
    misplaced = _make_diff(
        "PLAN-PATH",
        files=[
            _file("apps/x/src/controllers/uh_oh_service.py", "# scaffold\n", "T-P1", "service"),
            _file("apps/x/src/models/uh_oh_migration.sql", "CREATE TABLE x (id UUID PRIMARY KEY);\n", "T-P2", "migration"),
            # Pair test so ARC002/ARC004 fire cleanly without TST001 interference.
            _file("apps/x/test/unit/uh_oh_service_test.py", "# placeholder\n", "T-P1T", "test"),
        ],
    )
    rep = Reviewer().review(ReviewerInputs(diff=misplaced)).report
    found_path = {f.rule_id for f in rep.findings if f.rule_id in ("ARC002", "ARC004")}
    checks.append(_check(
        "ARC002" in found_path and "ARC004" in found_path,
        f"[AC#24] ARC002 (service path) + ARC004 (migration path) fire "
        f"(found: {sorted(found_path)})"
    ))


def _run_round_trip_check(checks: List[Tuple[bool, str]]) -> None:
    """AC#30 — reports persist as JSON round-trippable dicts."""
    diff = ALL_REVIEWER_FIXTURES["clean_crud"]()
    rep = Reviewer().review(ReviewerInputs(diff=diff)).report
    blob = json.dumps(rep.to_dict())
    parsed = json.loads(blob)
    checks.append(_check(
        parsed["report_id"] == rep.report_id
        and parsed["verdict"] == rep.verdict.value
        and isinstance(parsed["findings"], list),
        f"[AC#30] report.to_dict() round-trips through JSON "
        f"(keys={sorted(parsed.keys())[:6]})"
    ))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    started = time.time()
    evidence_dir = _evidence_dir()
    reviewer = Reviewer()

    all_checks: List[Tuple[bool, str]] = []
    per_fixture: List[Dict[str, Any]] = []

    # Per-fixture checks
    for fixture_key in ALL_REVIEWER_FIXTURES.keys():
        info = _run_fixture(fixture_key, reviewer, all_checks, evidence_dir)
        per_fixture.append(info)

    # Targeted per-fixture expectations
    _run_per_fixture_targeted_checks(per_fixture, all_checks)

    # Module constraint checks
    _run_module_constraint_checks(all_checks)

    # Public surface checks
    _run_public_surface_checks(all_checks)

    # Per-rule targeted checks
    _run_rule_targeted_checks(all_checks)

    # Round-trip check
    _run_round_trip_check(all_checks)

    ok = all(c[0] for c in all_checks)
    passed = sum(1 for c in all_checks if c[0])
    failed = len(all_checks) - passed

    result = {
        "issue": "FORA-71",
        "sub_goal": "3.3 — Reviewer",
        "smoke_utc": _utc_stamp(),
        "elapsed_ms": int((time.time() - started) * 1000),
        "passed": passed,
        "failed": failed,
        "ok": ok,
        "checks": [{"ok": c[0], "message": c[1]} for c in all_checks],
        "per_fixture": per_fixture,
    }

    result_path = evidence_dir / "reviewer_result.json"
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    repo_root = Path(__file__).resolve().parent.parent.parent
    print(f"FORA-71 Reviewer Agent smoke — {'PASS' if ok else 'FAIL'}")
    print(f"  passed={passed}  failed={failed}  elapsed={result['elapsed_ms']}ms")
    for c in all_checks:
        print(f"  {c[1]}")
    print(f"  evidence: {result_path.relative_to(repo_root)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
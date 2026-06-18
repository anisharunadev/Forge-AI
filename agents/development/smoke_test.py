"""
Coding Agent smoke test.

End-to-end check that the v0.1 Coding Agent turns each canonical plan
shape (from the Story Planner, Sub-goal 3.1) into a valid, structured
Code Diff with the right file count, AC coverage, and no-commit
constraints. The smoke produces:

  - agents/development/evidence/smoke_<UTC>/result.json — machine-readable result
  - agents/development/evidence/smoke_<UTC>/diffs/<story_id>.diff — unified diff per fixture

Run: `python -m agents.development.smoke_test` from the repo root.

The smoke covers 30+ ACs for Sub-goal 3.2 (FORA-70) — Coding:

  AC#1: Plan → CodeDiff produces one FileChange per (task × files_touched) entry.
  AC#2: Every FileChange has non-empty content.
  AC#3: Every FileChange carries its source task_id.
  AC#4: Every FileChange carries its AC refs from the plan.
  AC#5: The unified_diff is non-empty.
  AC#6: The unified_diff contains the right number of `+++ b/` headers.
  AC#7-11: Templates produce language-appropriate bodies (SQL/Python/...).
  AC#12: Every plan's AC refs appear in at least one FileChange's ac_refs.
  AC#13-16: No-commit / no-LLM / no-network constraints in the Coding module.
  AC#17-18: Determinism — same plan + re-instantiation yields same bytes.
  AC#19-21: Summary consistency, validate() clean.
  AC#22-23: Public surface (code_for_plan) + e2e planner+coding pipeline.
  AC#24-30: Project conventions, traceability, version pinning, multi-shape coverage.
"""

from __future__ import annotations

import hashlib
import inspect
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

from agents.development import coding as coding_module
from agents.development.coding import Coding, CodeInputs, code_for_plan
from agents.development.mock_data import ALL_FIXTURES, build_plan_for
from agents.development.schemas import CodeDiff, FileAction


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _evidence_dir() -> Path:
    root = Path(__file__).resolve().parent
    evidence = root / "evidence" / f"smoke_{_utc_stamp()}"
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "diffs").mkdir(exist_ok=True)
    return evidence


def _check(condition: bool, message: str) -> Tuple[bool, str]:
    return (condition, "OK  — " + message if condition else "FAIL — " + message)


def _module_source() -> str:
    return inspect.getsource(coding_module)


# ---------------------------------------------------------------------------
# Per-fixture checks
# ---------------------------------------------------------------------------

def _run_fixture(
    fixture_key: str,
    coding: Coding,
    checks: List[Tuple[bool, str]],
    per_fixture: List[Dict[str, Any]],
    evidence_dir: Path,
) -> None:
    plan = build_plan_for(fixture_key)
    actual_story_id = plan.story_id
    out = coding.code(CodeInputs(plan=plan))
    diff = out.diff

    fixture: Dict[str, Any] = {
        "fixture_key": fixture_key,
        "story_id": actual_story_id,
        "plan_id": plan.plan_id,
        "diff_id": diff.diff_id,
        "file_count": len(diff.files),
        "task_count": len(plan.tasks),
    }

    expected_file_count = sum(len(t.files_touched) for t in plan.tasks)
    label = f"{fixture_key} ({actual_story_id})"
    checks.append(_check(
        len(diff.files) == expected_file_count,
        f"[AC#1] {label} produces one FileChange per (task × files_touched) — "
        f"got {len(diff.files)}, expected {expected_file_count}"
    ))

    all_non_empty = all(f.content.strip() for f in diff.files)
    checks.append(_check(all_non_empty, f"[AC#2] {label} every FileChange has non-empty content"))

    all_have_task_id = all(f.task_id for f in diff.files)
    checks.append(_check(all_have_task_id, f"[AC#3] {label} every FileChange carries its source task_id"))

    all_have_ac_refs = all(f.ac_refs for f in diff.files)
    checks.append(_check(all_have_ac_refs, f"[AC#4] {label} every FileChange carries AC refs from the plan"))

    checks.append(_check(bool(diff.unified_diff), f"[AC#5] {label} unified_diff is non-empty"))

    plus_headers = diff.unified_diff.count("\n+++ b/")
    checks.append(_check(
        plus_headers == len(diff.files),
        f"[AC#6] {label} unified_diff has {len(diff.files)} `+++ b/` headers — got {plus_headers}"
    ))

    # AC#7 — SQL migrations
    sql_files = [f for f in diff.files if f.language.value == "sql"]
    if sql_files:
        sql_ok = all("CREATE TABLE" in f.content and "id UUID PRIMARY KEY" in f.content for f in sql_files)
        checks.append(_check(sql_ok, f"[AC#7] {label} SQL migrations contain CREATE TABLE + id UUID"))

    # AC#8 — Python files (all have either @dataclass or TODO marker)
    py_files = [f for f in diff.files if f.language.value == "python"]
    if py_files:
        model_ok = all(("@dataclass" in f.content) or ("TODO[3.2/v0.2]" in f.content) for f in py_files)
        checks.append(_check(model_ok, f"[AC#8] {label} Python files contain @dataclass or TODO marker"))

    # AC#9 — services
    service_files = [f for f in diff.files if "/services/" in f.path]
    if service_files:
        service_ok = all("async def create" in f.content and "async def get" in f.content for f in service_files)
        checks.append(_check(service_ok, f"[AC#9] {label} service files contain async def create + get"))

    # AC#10 — controllers
    controller_files = [f for f in diff.files if "/controllers/" in f.path]
    if controller_files:
        ctrl_ok = all("@router." in f.content for f in controller_files)
        checks.append(_check(ctrl_ok, f"[AC#10] {label} controller files contain @router. decorators"))

    # AC#11 — tests
    test_files = [f for f in diff.files if "/test/" in f.path or "/tests/" in f.path]
    if test_files:
        test_ok = all("class Test" in f.content and "def test_" in f.content for f in test_files)
        checks.append(_check(test_ok, f"[AC#11] {label} test files contain class Test + def test_"))

    # AC#12 — AC coverage
    plan_acs = {r for t in plan.tasks for r in t.acceptance_criteria_refs}
    covered = {r for f in diff.files for r in f.ac_refs}
    checks.append(_check(
        plan_acs == covered and bool(plan_acs),
        f"[AC#12] {label} every plan AC ref appears in at least one FileChange — "
        f"plan={sorted(plan_acs)} covered={sorted(covered)}"
    ))

    # AC#17 — determinism (same plan, two runs)
    out2 = coding.code(CodeInputs(plan=plan))
    diff_stable = diff.unified_diff == out2.diff.unified_diff and diff.files == out2.diff.files
    checks.append(_check(diff_stable, f"[AC#17] {label} diff is byte-stable across two runs"))

    # AC#19 — summary.total_files == len(files)
    checks.append(_check(
        diff.summary.total_files == len(diff.files),
        f"[AC#19] {label} summary.total_files == len(files) — "
        f"summary={diff.summary.total_files} actual={len(diff.files)}"
    ))

    # AC#20 — summary.ac_coverage matches plan ACs
    checks.append(_check(
        set(diff.summary.ac_coverage) == plan_acs,
        f"[AC#20] {label} summary.ac_coverage matches plan ACs — "
        f"summary={sorted(diff.summary.ac_coverage)} plan={sorted(plan_acs)}"
    ))

    # AC#21 — validate() clean
    validation_errors = diff.validate()
    checks.append(_check(
        not validation_errors,
        f"[AC#21] {label} CodeDiff.validate() returns no errors — got {validation_errors}"
    ))

    # AC#24 — paths start with apps/
    apps_paths = all(f.path.startswith("apps/") for f in diff.files)
    checks.append(_check(apps_paths, f"[AC#24] {label} all file paths start with apps/"))

    # AC#25 — TODO[3.2/v0.2] markers
    todos = all("TODO[3.2/v0.2]" in f.content for f in diff.files)
    checks.append(_check(todos, f"[AC#25] {label} every file contains a TODO[3.2/v0.2] marker"))

    # AC#26 — header traceability (check using the plan's actual story_id)
    trace_ok = all(
        plan.plan_id in f.content and actual_story_id in f.content and f.task_id in f.content
        for f in diff.files
    )
    checks.append(_check(trace_ok, f"[AC#26] {label} headers include plan_id, story_id, task_id"))

    # AC#28 — schema version pinned
    checks.append(_check(
        diff.schema_version == "0.1.0",
        f"[AC#28] {label} schema_version is pinned to 0.1.0 — got {diff.schema_version}"
    ))

    # Save the diff
    diff_path = evidence_dir / "diffs" / f"{actual_story_id}.diff"
    diff_path.write_text(diff.unified_diff, encoding="utf-8")
    fixture["diff_path"] = str(
        diff_path.relative_to(Path(__file__).resolve().parent.parent.parent)
    )

    per_fixture.append(fixture)


def _run_shape_specific_checks(
    per_fixture: List[Dict[str, Any]],
    checks: List[Tuple[bool, str]],
) -> None:
    """Per-shape sanity checks on the fixtures as a whole."""
    by_key = {f["fixture_key"]: f for f in per_fixture}

    # AC#29: migration-only fixture produces only migration + test files
    if "migration_only" in by_key:
        m_plan = build_plan_for("migration_only")
        m_types = {t.type.value for t in m_plan.tasks}
        checks.append(_check(
            m_types <= {"migration", "test"},
            f"[AC#29] migration-only fixture emits only migration + test task types — got {m_types}"
        ))

    # AC#30: API endpoint fixture produces no migration/model tasks
    if "api_login" in by_key:
        a_plan = build_plan_for("api_login")
        a_types = {t.type.value for t in a_plan.tasks}
        checks.append(_check(
            "migration" not in a_types and "model" not in a_types,
            f"[AC#30] api-endpoint fixture emits no migration/model tasks — got {a_types}"
        ))


def _run_module_constraint_checks(checks: List[Tuple[bool, str]]) -> None:
    """Module-level checks — no commit, no LLM, no network."""
    src = _module_source()

    checks.append(_check(
        "import subprocess" not in src and "from subprocess" not in src,
        "[AC#13] Coding module has no `subprocess` import (no-commit constraint)"
    ))
    checks.append(_check(
        "import git" not in src and "from git" not in src,
        "[AC#14] Coding module has no `git` import (no-commit constraint)"
    ))
    checks.append(_check(
        "anthropic" not in src and "openai" not in src and "google.generativeai" not in src,
        "[AC#15] Coding module has no LLM imports (no-LLM constraint)"
    ))
    checks.append(_check(
        "import requests" not in src
        and "from requests" not in src
        and "import urllib" not in src
        and "from urllib" not in src,
        "[AC#16] Coding module has no HTTP imports (no-network constraint)"
    ))


def _run_public_surface_checks(checks: List[Tuple[bool, str]]) -> None:
    """Public surface checks — code_for_plan exists, Coding is re-instantiable."""
    checks.append(_check(
        callable(code_for_plan),
        "[AC#22] code_for_plan is exposed as a callable"
    ))

    # AC#18: Coding is re-instantiable
    plan = build_plan_for(ALL_FIXTURES[0])
    a = Coding().code(CodeInputs(plan=plan)).diff
    b = Coding().code(CodeInputs(plan=plan)).diff
    checks.append(_check(
        a.unified_diff == b.unified_diff,
        "[AC#18] Coding is re-instantiable and produces stable bytes"
    ))

    # AC#23: end-to-end pipeline (planner → coding)
    from agents.planner import Planner, PlannerInputs
    e2e_plan = Planner().plan(PlannerInputs(
        story_id="STORY-301",
        story_title="Add widget entity",
        story_description="Create the widget CRUD.",
        acceptance_criteria=[{"id": "ac-1", "description": "POST /widgets creates a widget"}],
    )).plan
    e2e_diff = code_for_plan(e2e_plan)
    checks.append(_check(
        e2e_diff.validate() == [],
        "[AC#23] end-to-end planner + coding pipeline produces a valid diff"
    ))

    # AC#27: diff_id is derived from plan_id
    expected = "diff-" + hashlib.sha1(plan.plan_id.encode("utf-8")).hexdigest()[:10]
    checks.append(_check(
        a.diff_id == expected,
        f"[AC#27] diff_id is derived from plan_id (expected {expected}, got {a.diff_id})"
    ))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    started = time.time()
    evidence_dir = _evidence_dir()
    coding = Coding()

    all_checks: List[Tuple[bool, str]] = []
    per_fixture: List[Dict[str, Any]] = []

    # Per-fixture checks
    for fixture_key in ALL_FIXTURES:
        _run_fixture(fixture_key, coding, all_checks, per_fixture, evidence_dir)

    # Shape-specific (cross-fixture) checks
    _run_shape_specific_checks(per_fixture, all_checks)

    # Module constraint checks (run once)
    _run_module_constraint_checks(all_checks)

    # Public surface checks (run once)
    _run_public_surface_checks(all_checks)

    ok = all(c[0] for c in all_checks)
    passed = sum(1 for c in all_checks if c[0])
    failed = len(all_checks) - passed

    result = {
        "issue": "FORA-70",
        "sub_goal": "3.2 — Coding",
        "smoke_utc": _utc_stamp(),
        "elapsed_ms": int((time.time() - started) * 1000),
        "passed": passed,
        "failed": failed,
        "ok": ok,
        "checks": [{"ok": c[0], "message": c[1]} for c in all_checks],
        "per_fixture": per_fixture,
    }

    result_path = evidence_dir / "result.json"
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    repo_root = Path(__file__).resolve().parent.parent.parent
    print(f"FORA-70 Coding Agent smoke — {'PASS' if ok else 'FAIL'}")
    print(f"  passed={passed}  failed={failed}  elapsed={result['elapsed_ms']}ms")
    for c in all_checks:
        print(f"  {c[1]}")
    print(f"  evidence: {result_path.relative_to(repo_root)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

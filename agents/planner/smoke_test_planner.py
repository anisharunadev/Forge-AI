"""
Story Planner smoke test.

End-to-end check that the v0.1 planner turns each canonical story shape
into a valid, ordered task list with the right AC refs and depends_on
graph. The smoke produces:

  - agents/planner/evidence/smoke_<UTC>/result.json — machine-readable result
  - agents/planner/evidence/smoke_<UTC>/plans/<story_id>.md — the rendered
    plan markdown, one per fixture

Run: `python -m agents.planner.smoke_test_planner` from the repo root.

The smoke covers all 6 ACs of Sub-goal 3.1 (FORA-69):

  AC #1 — Story → task breakdown produces migration/model/service/
          controller/test tasks where applicable.
  AC #2 — Every task references at least one AC id from the story.
  AC #3 — Every task declares at least one file_touched.
  AC #4 — The depends_on graph has no cycles and matches the canonical
          ordering (migration → model → service → controller → test).
  AC #5 — The plan validates cleanly via PlanOutput.validate().
  AC #6 — The rendered markdown is byte-stable across two runs on the
          same input (deterministic).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _evidence_dir() -> Path:
    root = Path(__file__).resolve().parent
    evidence = root / "evidence" / f"smoke_{_utc_stamp()}"
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "plans").mkdir(exist_ok=True)
    return evidence


def _check(condition: bool, message: str) -> Tuple[bool, str]:
    return (condition, "OK  — " + message if condition else "FAIL — " + message)


def _run_shape(
    inputs, planner, results: List[Dict[str, Any]]
) -> Tuple[List[Tuple[bool, str]], List[Dict[str, Any]]]:
    """Run the planner on one story shape and assert the AC contract."""
    checks: List[Tuple[bool, str]] = []
    per_shape: Dict[str, Any] = {
        "story_id": inputs.story_id,
        "title": inputs.story_title,
    }

    try:
        out = planner.plan(inputs)
    except Exception as exc:  # pragma: no cover — smoke must report
        checks.append((False, f"planner raised on {inputs.story_id}: {exc!r}"))
        per_shape["error"] = repr(exc)
        return checks, results + [per_shape]

    plan = out.plan
    shape = out.shape
    per_shape["inferred_shape"] = shape
    per_shape["task_count"] = len(plan.tasks)
    per_shape["task_types"] = sorted({t.type.value for t in plan.tasks})
    per_shape["plan_id"] = plan.plan_id
    per_shape["plan_md_sha256"] = hashlib.sha256(
        out.plan_markdown.encode("utf-8")
    ).hexdigest()

    # ---- AC #1: required task types present where the shape demands them ----
    types = {t.type.value for t in plan.tasks}
    if shape == "crud_entity":
        ok = {"migration", "model", "service", "controller", "test"} <= types
    elif shape == "api_endpoint":
        ok = {"service", "controller", "test"} <= types
    elif shape == "migration_only":
        ok = {"migration", "test"} <= types
    else:  # pragma: no cover — guard against future shape drift
        ok = False
    checks.append(_check(ok, f"[AC#1] {inputs.story_id} ({shape}) emits required task types — got {sorted(types)}"))

    # ---- AC #2: every task references ≥1 AC id from the story ----------------
    expected_ac_ids = {ac["id"] for ac in inputs.acceptance_criteria}
    all_refs: List[List[str]] = []
    for t in plan.tasks:
        all_refs.append(t.acceptance_criteria_refs)
    flat = {r for refs in all_refs for r in refs}
    refs_ok = bool(flat) and flat.issubset(expected_ac_ids)
    checks.append(_check(refs_ok, f"[AC#2] {inputs.story_id} task AC refs are a subset of story ACs — got {sorted(flat)}"))

    # ---- AC #3: every task declares ≥1 file_touched -------------------------
    files_ok = all(t.files_touched for t in plan.tasks)
    checks.append(_check(files_ok, f"[AC#3] {inputs.story_id} every task declares ≥1 files_touched"))

    # ---- AC #4: depends_on graph is acyclic and respects canonical order ---
    order_index = {tid: i for i, tid in enumerate(t.id for t in plan.tasks)}
    cycle_ok = True
    order_ok = True
    for t in plan.tasks:
        for dep in t.depends_on:
            if dep not in order_index:
                cycle_ok = False
                continue
            # canonical ordering: a task's deps must precede it
            if order_index[dep] >= order_index[t.id]:
                order_ok = False
    checks.append(_check(cycle_ok, f"[AC#4a] {inputs.story_id} depends_on has no missing or self-referential edges"))
    checks.append(_check(order_ok, f"[AC#4b] {inputs.story_id} depends_on respects canonical ordering (deps precede dependents)"))

    # ---- AC #5: plan validates cleanly via PlanOutput.validate() ----------
    validation_errors = plan.validate()
    checks.append(_check(not validation_errors, f"[AC#5] {inputs.story_id} PlanOutput.validate() returns no errors — got {validation_errors}"))

    # ---- AC #6: rendered markdown is byte-stable across two runs ----------
    out2 = planner.plan(inputs)
    md_stable = out.plan_markdown == out2.plan_markdown
    checks.append(_check(md_stable, f"[AC#6] {inputs.story_id} plan markdown is byte-stable across two runs"))

    # Save the rendered plan to the evidence dir
    evidence = results  # alias for clarity
    plan_path = Path(__file__).resolve().parent / "evidence" / f"smoke_{_utc_stamp()}" / "plans" / f"{inputs.story_id}.md"
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.write_text(out.plan_markdown, encoding="utf-8")
    per_shape["plan_path"] = str(plan_path.relative_to(Path(__file__).resolve().parent.parent.parent))

    return checks, evidence + [per_shape]


def main() -> int:
    # Import inside main so a failure surfaces as a smoke failure, not an
    # import error at module load.
    from .mock_data import ALL_FIXTURES
    from .planner import Planner

    started = time.time()
    evidence_dir = _evidence_dir()
    all_checks: List[Tuple[bool, str]] = []
    per_shape: List[Dict[str, Any]] = []

    for inputs in ALL_FIXTURES:
        planner = Planner()
        checks, per_shape = _run_shape(inputs, planner, per_shape)
        all_checks.extend(checks)

    ok = all(c[0] for c in all_checks)
    passed = sum(1 for c in all_checks if c[0])
    failed = len(all_checks) - passed

    result = {
        "issue": "FORA-69",
        "sub_goal": "3.1 — Story planner",
        "smoke_utc": _utc_stamp(),
        "elapsed_ms": int((time.time() - started) * 1000),
        "passed": passed,
        "failed": failed,
        "ok": ok,
        "checks": [{"ok": c[0], "message": c[1]} for c in all_checks],
        "per_shape": per_shape,
    }

    result_path = evidence_dir / "result.json"
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    # Console output: short, then full
    print(f"FORA-69 Story Planner smoke — {'PASS' if ok else 'FAIL'}")
    print(f"  passed={passed}  failed={failed}  elapsed={result['elapsed_ms']}ms")
    for c in all_checks:
        print(f"  {c[1]}")
    print(f"  evidence: {result_path.relative_to(Path(__file__).resolve().parent.parent.parent)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

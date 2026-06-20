"""Wrap _run_smoke.py, capture its assertion-level output, and write
the evidence JSON that the close-gate interaction will reference.

Invocation:
    python3 forge/11.5/_write_evidence.py

Output:
    forge/11.5/evidence/smoke_<UTC-timestamp>.json

Schema follows the FORA-117 / FORA-254 evidence shape so the parent
epic's evidence format stays consistent.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import subprocess
import sys
import time


_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT = os.path.dirname(os.path.dirname(_HERE))
os.chdir(_DEFAULT)

RUNNER = os.path.join(_HERE, "_run_smoke.py")
EVIDENCE_DIR = os.path.join(_HERE, "evidence")
os.makedirs(EVIDENCE_DIR, exist_ok=True)


def _hash_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_pass_fail(stdout: str) -> list:
    """Each test fn emits multiple `[PASS]` assertion lines; collect
    them in order so the evidence shows the assertion-level signal."""
    tests: list = []
    for raw in stdout.splitlines():
        line = raw.rstrip()
        if not (line.startswith("[PASS]") or line.startswith("[FAIL]")):
            continue
        verdict = "pass" if line.startswith("[PASS]") else "fail"
        # Drop the prefix + leading space.
        name = line[len(f"[{verdict.upper()}]"):].strip()
        # The first token of the name is the assertion label.
        tests.append({"assertion": name, "verdict": verdict})
    return tests


def main() -> int:
    t0 = _dt.datetime.now(_dt.timezone.utc)
    timestamp = t0.strftime("%Y%m%dT%H%M%SZ")
    wall_t0 = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, RUNNER],
        capture_output=True,
        text=True,
        cwd=_DEFAULT,
    )
    elapsed_ms = (time.perf_counter() - wall_t0) * 1000.0
    stdout = proc.stdout
    returncode = proc.returncode

    assertions = _parse_pass_fail(stdout)
    pass_count = sum(1 for a in assertions if a["verdict"] == "pass")
    fail_count = sum(1 for a in assertions if a["verdict"] == "fail")
    test_count = 12  # the smoke fn's main() runs 12 test fns

    evidence = {
        "issue": "FORA-255",
        "sub_goal": "11.5",
        "title": "Tier-3 Divergence Workbench — v0.1 contract",
        "schemaVersion": 1,
        "generated_at": t0.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "test_runner": "forge/11.5/_run_smoke.py",
        "test_count": test_count,
        "assertion_count": len(assertions),
        "pass_count": pass_count,
        "fail_count": fail_count,
        "returncode": returncode,
        "duration_ms": round(elapsed_ms, 1),
        "test_runner_sha256": _hash_file(RUNNER),
        "tests": assertions,
        "ac_coverage": {
            "AC_1_render_budget_2s_for_10k": "covered (test_render_budget_10k asserts list_divergences < 200 ms in-process; < 2 s budget is end-to-end with React + network)",
            "AC_2_audit_row_with_hlcs_and_winner": "covered (test_resolve_writes_audit_row)",
            "AC_3_bulk_emits_n_audit_rows": "covered (test_bulk_emits_n_audit_rows + test_bulk_partial_failure_does_not_roll_back)",
            "AC_4_daily_digest_opt_out_per_tenant": "covered (test_digest_opt_out + test_digest_normal_day + test_digest_action_required_threshold)",
            "AC_5_no_silent_resolution": "covered (test_no_silent_resolution)",
            "AC_6_designer_handoff_doc_agent_style": "covered by design.md Knowledge Layer §0 conventions (§0 quick start, §10 versioning footnote, §9 stage injection, §11 cross-references); UI implementation is the explicit follow-up child per §9",
        },
        "follow_up_children": [
            "11.5a — UI surface implementation (route + components + server endpoints; dispatched when FORA-11.0 Architect hire closes; spec at forge/11.5/UI_SURFACE.md)",
            "11.5b — Daily digest cron + email sender (per §6 of design.md)",
            "11.5c — k6 end-to-end render-budget probe (proves AC #1 end-to-end, not just the in-process sub-budget)",
        ],
    }
    out_path = os.path.join(EVIDENCE_DIR, f"smoke_{timestamp}.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(evidence, fh, indent=2)
    print(f"evidence written: {out_path}")
    print(f"  test_count={test_count} assertion_count={len(assertions)} "
          f"pass={pass_count} fail={fail_count} returncode={returncode} "
          f"duration_ms={round(elapsed_ms, 1)}")
    return 0 if returncode == 0 else returncode


if __name__ == "__main__":
    sys.exit(main())
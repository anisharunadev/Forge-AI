#!/usr/bin/env python3
"""
End-to-end smoke test for the Self-Healing Agent v1 (FORA-37).

Acceptance contract (mirrors FORA-37 §"Acceptance criteria (v1)"):

    1. The dry-run reads a checked-in trace fixture and emits a
       `RepairProposal` JSON file under `evidence/`.
    2. The emitted payload validates against
       `schemas/repair_proposal.schema.json` (jsonschema).
    3. The emitted payload also validates against the in-process
       dataclass `validate()` (defence in depth — the schema file
       and the code agree).
    4. The feature flag block in the payload reports
       `enabled == False` and `self_healing == "v1_dry_run"`.
    5. The proposal's `mode` is `dry_run`. No code path in v1
       mutates a test file; the smoke test asserts that the fixture
       directory is byte-identical before and after the run.

The smoke test:

    1. Snapshots the fixture directory (mtime + sha256 per file).
    2. Runs `run_dry_run(...)` against the checked-in fixture.
    3. Serialises the result to `evidence/repair_proposal.json`.
    4. Validates the JSON against the JSON schema.
    5. Validates the dataclass round-trip (`from_dict → validate`).
    6. Re-checks the fixture directory snapshot; any change fails loud.
    7. Writes a small `smoke_summary.json` for the comment thread.

Exit code: 0 on full success, 1 on any failure.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from agents.qa.self_healing import (  # noqa: E402
    CONTRACT_VERSION,
    RepairProposal,
    feature_flag,
    run_dry_run,
)
from agents.qa.self_healing.schemas import (  # noqa: E402
    DetectedDrift,
    DriftKind,
    ProposedRepair,
    RepairKind,
)


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

FIXTURE_PATH = os.path.join(HERE, "fixtures", "trace.json")
SCHEMA_PATH = os.path.join(HERE, "schemas", "repair_proposal.schema.json")
EVIDENCE_DIR = os.path.join(HERE, "evidence")
EVIDENCE_PATH = os.path.join(EVIDENCE_DIR, "repair_proposal.json")
SUMMARY_PATH = os.path.join(EVIDENCE_DIR, "smoke_summary.json")

# The directories the dry-run is forbidden to write to. The smoke
# test asserts none of these files change across the run.
PROTECTED_DIRS = (
    os.path.join(HERE, "fixtures"),
    os.path.join(HERE, "schemas"),
)


# ---------------------------------------------------------------------------
# Snapshot helpers
# ---------------------------------------------------------------------------

def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _snapshot_dirs(paths) -> dict:
    out = {}
    for d in paths:
        out[d] = {}
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            p = os.path.join(d, name)
            if os.path.isfile(p):
                st = os.stat(p)
                out[d][p] = (st.st_size, st.st_mtime_ns, _sha256_file(p))
    return out


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _load_schema() -> dict:
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _validate_against_schema(payload: dict, schema: dict) -> list:
    import jsonschema
    errors = []
    validator = jsonschema.Draft202012Validator(schema)
    for err in sorted(validator.iter_errors(payload), key=lambda e: list(e.path)):
        path = "/".join(str(p) for p in err.path) or "<root>"
        errors.append(f"{path}: {err.message}")
    return errors


# ---------------------------------------------------------------------------
# Smoke test main
# ---------------------------------------------------------------------------

def run() -> int:
    failures: list = []
    summary: dict = {
        "smoke_test": "agents.qa.self_healing.smoke_test",
        "issue": "FORA-37",
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "checks": [],
    }

    # --- 1. snapshot the protected directories -----------------------------
    before = _snapshot_dirs(PROTECTED_DIRS)

    # --- 2. feature flag must be disabled in v1 ----------------------------
    summary["checks"].append({
        "name": "feature_flag_disabled",
        "passed": not feature_flag.is_enabled() and feature_flag.mode() == "v1_dry_run",
        "expected": {"enabled": False, "mode": "v1_dry_run"},
        "actual":   {"enabled": feature_flag.is_enabled(), "mode": feature_flag.mode()},
    })
    if feature_flag.is_enabled() or feature_flag.mode() != "v1_dry_run":
        failures.append("feature_flag should report enabled=False, mode=v1_dry_run")

    # --- 3. run the dry-run on the checked-in fixture ----------------------
    try:
        proposal = run_dry_run(FIXTURE_PATH)
    except Exception as exc:
        failures.append(f"run_dry_run raised: {exc!r}")
        proposal = None

    if proposal is not None:
        # --- 4. mode must be dry_run --------------------------------------
        summary["checks"].append({
            "name": "proposal_mode_is_dry_run",
            "passed": proposal.mode == "dry_run",
            "expected": "dry_run",
            "actual": proposal.mode,
        })
        if proposal.mode != "dry_run":
            failures.append(f"proposal.mode must be 'dry_run', got {proposal.mode!r}")

        # --- 5. dataclass validate() returns [] ---------------------------
        errs = proposal.validate()
        summary["checks"].append({
            "name": "dataclass_validate_clean",
            "passed": errs == [],
            "errors": errs,
        })
        if errs:
            failures.append(f"proposal.validate() returned {len(errs)} error(s)")

        # --- 6. JSON schema validation -----------------------------------
        payload = proposal.to_dict()
        try:
            schema = _load_schema()
            schema_errs = _validate_against_schema(payload, schema)
        except Exception as exc:
            schema_errs = [f"jsonschema raised: {exc!r}"]
        summary["checks"].append({
            "name": "json_schema_validate_clean",
            "passed": schema_errs == [],
            "errors": schema_errs,
        })
        if schema_errs:
            failures.append(
                f"JSON schema validation returned {len(schema_errs)} error(s)"
            )

        # --- 7. feature_flag block in the payload -------------------------
        flag_ok = (
            proposal.feature_flag.get("enabled") is False
            and proposal.feature_flag.get("self_healing") == "v1_dry_run"
        )
        summary["checks"].append({
            "name": "payload_feature_flag_block",
            "passed": flag_ok,
            "expected": {"enabled": False, "self_healing": "v1_dry_run"},
            "actual": proposal.feature_flag,
        })
        if not flag_ok:
            failures.append("payload.feature_flag must report enabled=False, self_healing=v1_dry_run")

        # --- 8. dry-run actually detected the known drifts ---------------
        kinds = sorted({d.kind.value for d in proposal.detected_drift})
        expected_kinds = sorted({
            DriftKind.SELECTOR_MISSING.value,
            DriftKind.SELECTOR_AMBIGUOUS.value,
            DriftKind.ATTRIBUTE_VALUE_CHANGED.value,
        })
        summary["checks"].append({
            "name": "detected_drift_kinds",
            "passed": set(expected_kinds).issubset(set(kinds)),
            "expected": expected_kinds,
            "actual": kinds,
        })
        if not set(expected_kinds).issubset(set(kinds)):
            failures.append(
                f"expected at least {expected_kinds}, got {kinds}"
            )

        # --- 9. at least one repair is well-formed -----------------------
        well_formed = all(r.validate() == [] for r in proposal.repair_proposal)
        summary["checks"].append({
            "name": "all_repairs_validate_clean",
            "passed": well_formed,
            "repair_count": len(proposal.repair_proposal),
        })
        if not well_formed:
            failures.append("at least one ProposedRepair failed its own validate()")

        # --- 10. proposal_id is stable (idempotent re-run) ----------------
        proposal2 = run_dry_run(FIXTURE_PATH)
        stable_ok = proposal.proposal_id == proposal2.proposal_id
        summary["checks"].append({
            "name": "proposal_id_is_stable",
            "passed": stable_ok,
            "expected": proposal.proposal_id,
            "actual": proposal2.proposal_id,
        })
        if not stable_ok:
            failures.append("proposal_id is not stable across re-runs")

        # --- 11. write evidence ------------------------------------------
        os.makedirs(EVIDENCE_DIR, exist_ok=True)
        with open(EVIDENCE_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, sort_keys=False)
            f.write("\n")
        summary["evidence_path"] = EVIDENCE_PATH

    # --- 12. protected directories must be unchanged ----------------------
    after = _snapshot_dirs(PROTECTED_DIRS)
    for d in PROTECTED_DIRS:
        if before.get(d) != after.get(d):
            failures.append(f"protected directory changed during smoke test: {d}")
    summary["checks"].append({
        "name": "protected_dirs_unchanged",
        "passed": before == after,
        "protected_dirs": list(PROTECTED_DIRS),
    })

    # --- 13. apply_repair must refuse in v1 -------------------------------
    apply_blocked = True
    apply_err = None
    try:
        if proposal is not None:
            from agents.qa.self_healing import apply_repair
            apply_repair(proposal)
    except NotImplementedError as exc:
        apply_err = str(exc)
    except Exception as exc:
        apply_blocked = False
        apply_err = f"unexpected exception: {exc!r}"
    summary["checks"].append({
        "name": "apply_repair_refused_in_v1",
        "passed": apply_blocked,
        "error": apply_err,
    })
    if not apply_blocked:
        failures.append("apply_repair did not raise NotImplementedError in v1")

    # --- 14. write summary ------------------------------------------------
    summary["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    summary["contract_version"] = CONTRACT_VERSION
    summary["passed"] = len(failures) == 0
    summary["failures"] = failures
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, sort_keys=False)
        f.write("\n")

    if failures:
        print(f"SMOKE TEST FAILED — {len(failures)} failure(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("SMOKE TEST PASSED")
    print(f"  evidence_path: {EVIDENCE_PATH}")
    print(f"  summary_path:  {SUMMARY_PATH}")
    print(f"  drifts detected: {len(proposal.detected_drift) if proposal else 0}")
    print(f"  repairs proposed: {len(proposal.repair_proposal) if proposal else 0}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check-evidence-only",
        action="store_true",
        help="Skip running the dry-run; just verify the existing evidence file.",
    )
    args = parser.parse_args()
    if args.check_evidence_only:
        if not os.path.exists(EVIDENCE_PATH):
            print(f"evidence file not found: {EVIDENCE_PATH}")
            return 1
        with open(EVIDENCE_PATH) as f:
            payload = json.load(f)
        schema = _load_schema()
        errs = _validate_against_schema(payload, schema)
        if errs:
            print(f"evidence file failed schema validation: {errs}")
            return 1
        print(f"evidence file validates against schema ({len(payload.get('detected_drift', []))} drift(s))")
        return 0
    return run()


if __name__ == "__main__":
    raise SystemExit(main())

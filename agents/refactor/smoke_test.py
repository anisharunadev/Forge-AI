#!/usr/bin/env python3
"""
Smoke test for the code analyzer (FORA-82, sub-goal 8.1).

Acceptance contract:

    1. The analyzer consumes a `RepoScope` (normalized GitHub repo).
    2. It emits a `MigrationScope` covering all files with
       category, risk, and transform mapping.
    3. It is deterministic: two runs produce byte-identical output
       modulo `analyzer_runtime_ms` and `report_id`.
    4. Every file carries a category + risk + transform mapping.
    5. Cost bound: < 10 s, $0 spend.
    6. Output is written to:
         - forge/8.1/migration-scope.json   (canonical deliverable)
         - forge/8.1/risk-register.md       (human-readable)
         - forge/8.1/transform-mapping.json (AWS Transform unit map)
         - agents/refactor/evidence/smoke_<ts>/result.json
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
import time
from typing import Any, Dict


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents.refactor import (  # noqa: E402
    CATEGORIES,
    RISK_LEVELS,
    TRANSFORM_TIERS,
    TRANSFORM_UNITS,
    analyze_scope,
    render_risk_register,
    sample_legacy_monolith,
)


OUT_DIR = os.path.join(ROOT, "forge", "8.1")
EVIDENCE_DIR = os.path.join(HERE, "evidence")


def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(2)


def _strip_volatile(d: Dict[str, Any]) -> Dict[str, Any]:
    """Remove fields that legitimately vary across runs (timing, uuid)."""
    d.pop("report_id", None)
    d.pop("analyzer_runtime_ms", None)
    return d


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    run_stamp = _ts()
    run_dir = os.path.join(EVIDENCE_DIR, f"smoke_{run_stamp}")
    os.makedirs(run_dir, exist_ok=True)

    print(f"[smoke] run stamp: {run_stamp}")
    print(f"[smoke] out dir:   {OUT_DIR}")
    print(f"[smoke] evidence:  {run_dir}")

    # --- 1. load the canonical fixture ----------------------------------
    t_load = time.perf_counter()
    repo = sample_legacy_monolith()
    print(f"[smoke] fixture:    {repo.file_count} files, "
          f"{repo.total_loc} LoC, {len(repo.services)} services "
          f"({(time.perf_counter() - t_load) * 1000:.1f} ms to construct)")

    # --- 2. run analyzer twice for determinism --------------------------
    t_an = time.perf_counter()
    r1 = analyze_scope(repo)
    r2 = analyze_scope(repo)
    elapsed_ms = (time.perf_counter() - t_an) * 1000.0
    print(f"[smoke] analyzer:   2 runs in {elapsed_ms:.1f} ms "
          f"(single run = {r1.analyzer_runtime_ms} ms)")

    # AC #3: deterministic
    d1 = _strip_volatile(r1.to_dict())
    d2 = _strip_volatile(r2.to_dict())
    if d1 != d2:
        _fail("non-deterministic: two runs produced different output.")
    print("[smoke] determinism: OK")

    # AC #5: cost bound
    if elapsed_ms > 10_000:
        _fail(f"cost bound exceeded: {elapsed_ms:.1f} ms > 10,000 ms.")
    if r1.cost_usd != 0.0:
        _fail(f"cost_usd must be 0 (no model spend); got {r1.cost_usd}.")
    print(f"[smoke] cost bound:  OK ({elapsed_ms:.1f} ms < 10,000 ms, $0 spend)")

    # AC #2 + #4: every file has a category + risk + transform mapping
    paths_in = {f.path for f in repo.files}
    paths_cat = {c.path for c in r1.categorizations}
    paths_risk = {r.path for r in r1.risk_assessments}
    paths_map = {m.path for m in r1.transform_mappings}
    missing_cat = paths_in - paths_cat
    missing_risk = paths_in - paths_risk
    missing_map = paths_in - paths_map
    if missing_cat:
        _fail(f"files missing categorization: {sorted(missing_cat)}")
    if missing_risk:
        _fail(f"files missing risk assessment: {sorted(missing_risk)}")
    if missing_map:
        _fail(f"files missing transform mapping: {sorted(missing_map)}")
    print(f"[smoke] coverage:    OK (all {len(paths_in)} files have cat/risk/map)")

    # AC #2: every category in the closed set is reachable
    seen_cats = {c.category for c in r1.categorizations}
    if set(CATEGORIES) - seen_cats:
        _fail(f"analyzer never emitted categories: "
              f"{sorted(set(CATEGORIES) - seen_cats)}")
    print(f"[smoke] categories:  OK (all {len(CATEGORIES)} categories reachable)")

    # AC #2: every transform tier reachable
    seen_tiers = {m.tier for m in r1.transform_mappings}
    if set(TRANSFORM_TIERS) - seen_tiers:
        _fail(f"analyzer never emitted tiers: "
              f"{sorted(set(TRANSFORM_TIERS) - seen_tiers)}")
    print(f"[smoke] tiers:       OK (all {len(TRANSFORM_TIERS)} tiers reachable)")

    # AC #2: every transform unit reachable
    seen_units = {m.unit for m in r1.transform_mappings}
    if set(TRANSFORM_UNITS) - seen_units:
        _fail(f"analyzer never emitted units: "
              f"{sorted(set(TRANSFORM_UNITS) - seen_units)}")
    print(f"[smoke] units:       OK (all {len(TRANSFORM_UNITS)} units reachable)")

    # AC #2: every risk level reachable
    seen_risks = {r.risk_level for r in r1.risk_assessments}
    if set(RISK_LEVELS) - seen_risks:
        _fail(f"analyzer never emitted risks: "
              f"{sorted(set(RISK_LEVELS) - seen_risks)}")
    print(f"[smoke] risks:       OK (all {len(RISK_LEVELS)} risk levels reachable)")

    # AC: every confidence / score in expected range
    for r in r1.risk_assessments:
        if not (0.0 <= r.score <= 10.0):
            _fail(f"file {r.path!r} risk score {r.score} out of [0, 10].")
        if r.estimated_effort_days < 0:
            _fail(f"file {r.path!r} effort {r.estimated_effort_days} negative.")
    print("[smoke] ranges:      OK (all scores in [0, 10], effort >= 0)")

    # --- 3. write deliverable artefacts ---------------------------------
    canonical = os.path.join(OUT_DIR, "migration-scope.json")
    rationale_path = os.path.join(OUT_DIR, "risk-register.md")
    transform_path = os.path.join(OUT_DIR, "transform-mapping.json")
    with open(canonical, "w", encoding="utf-8") as fh:
        json.dump(r1.to_dict(), fh, indent=2, sort_keys=True)
    with open(rationale_path, "w", encoding="utf-8") as fh:
        fh.write(render_risk_register(r1))
    # Slimmer transform-only artefact: 8.3 reads this to plan jobs.
    transform_only = {
        "schema_version": r1.schema_version,
        "report_id": r1.report_id,
        "source": r1.source,
        "generated_at": r1.generated_at,
        "analyzer_version": r1.analyzer_version,
        "repo_fingerprint": r1.repo_fingerprint,
        "summary": {
            "total_files": r1.summary.total_files,
            "transform_tier": r1.summary.transform_tier,
            "unit_counts": r1.summary.unit_counts,
            "tier_counts": r1.summary.tier_counts,
        },
        "mappings": [m.to_dict() for m in r1.transform_mappings],
    }
    with open(transform_path, "w", encoding="utf-8") as fh:
        json.dump(transform_only, fh, indent=2, sort_keys=True)
    print(f"[smoke] wrote:       {canonical}")
    print(f"[smoke] wrote:       {rationale_path}")
    print(f"[smoke] wrote:       {transform_path}")

    # --- 4. evidence: result.json + report summary ----------------------
    result = {
        "run_stamp": run_stamp,
        "analyzer_version": r1.analyzer_version,
        "repo_fingerprint": r1.repo_fingerprint,
        "repo_source": repo.source,
        "elapsed_ms_total": round(elapsed_ms, 3),
        "elapsed_ms_analyzer_single_run": r1.analyzer_runtime_ms,
        "cost_usd": r1.cost_usd,
        "deterministic": True,
        "ac_checks": {
            "ac1_consumes_repo_scope": True,
            "ac2_emits_full_scope": (
                not missing_cat and not missing_risk and not missing_map
                and seen_cats == set(CATEGORIES)
                and seen_tiers == set(TRANSFORM_TIERS)
                and seen_units == set(TRANSFORM_UNITS)
                and seen_risks == set(RISK_LEVELS)
            ),
            "ac3_deterministic": True,
            "ac4_full_coverage": (
                not missing_cat and not missing_risk and not missing_map
            ),
            "ac5_cost_bounded": elapsed_ms < 10_000 and r1.cost_usd == 0.0,
            "ac6_artefacts_written": (
                os.path.exists(canonical)
                and os.path.exists(rationale_path)
                and os.path.exists(transform_path)
            ),
        },
        "summary": r1.summary.to_dict(),
    }
    with open(os.path.join(run_dir, "result.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, sort_keys=True)
    print(f"[smoke] evidence:    {run_dir}/result.json")

    # --- 5. top-line summary --------------------------------------------
    top5 = r1.top_risks(5)
    print()
    print("Top 5 risk files:")
    for r in top5:
        print(f"  - {r.risk_level:6s} {r.score:5.2f}  {r.path}")
    print()
    print(f"Dominant tier:  {r1.summary.transform_tier}")
    print(f"Dominant risk:  {r1.summary.risk_level}")
    print(f"Effort:         {r1.summary.estimated_effort_days:.2f} person-days")
    print()
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

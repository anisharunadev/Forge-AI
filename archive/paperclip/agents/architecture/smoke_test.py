#!/usr/bin/env python3
"""
Smoke test for the architecture-style detector (FORA-29, sub-goal 2.2).

Acceptance contract:

    1. The detector consumes the FORA-27 codebase-graph.json.
    2. It emits a `StyleReport` covering all 10 styles
       (monolith, microservices, event-driven, cqrs, ddd, layered,
       hexagonal-clean, modular-monolith, serverless, pipeline).
    3. It is deterministic (two runs produce byte-identical tag output).
    4. Each tag carries at least one evidence item.
    5. Runtime is < 10 s; cost = $0 (no model spend).
    6. Output is written to:
         - forge/2.2/arch-style-tags.json   (the canonical deliverable)
         - forge/2.2/rationale.md           (the human-readable rationale)
         - agents/architecture/evidence/<timestamp>/result.json
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
from typing import Any, Dict


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents.architecture import detect_styles, render_rationale  # noqa: E402
from agents.architecture.schemas import ALL_STYLES  # noqa: E402


GRAPH_PATH = os.path.join(
    ROOT,
    "forge",
    "2.2",
    "input",
    "codebase-graph.json",
)

OUT_DIR = os.path.join(ROOT, "forge", "2.2")
EVIDENCE_DIR = os.path.join(HERE, "evidence")


def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(2)


def _ensure_graph_available() -> Dict[str, Any]:
    """Load the 2.1 graph artefact.

    Resolution order:
      1. The committed local copy at forge/2.2/input/codebase-graph.json
         (CTO workflow: copy from FORA-27 attachment into the workspace
         before running the detector).
      2. The Paperclip attachment cache at /tmp/fora27/codebase-graph.json
         (recovery path during development).
    """
    candidates = [
        GRAPH_PATH,
        "/tmp/fora27/codebase-graph.json",
    ]
    for p in candidates:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as fh:
                return json.load(fh)
    _fail(
        "codebase-graph.json not found. Copy it from FORA-27 attachment "
        f"into {GRAPH_PATH} (or /tmp/fora27/codebase-graph.json for dev)."
    )


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    run_stamp = _ts()
    run_dir = os.path.join(EVIDENCE_DIR, f"smoke_{run_stamp}")
    os.makedirs(run_dir, exist_ok=True)

    print(f"[smoke] run stamp: {run_stamp}")
    print(f"[smoke] graph:     {GRAPH_PATH}")
    print(f"[smoke] out dir:   {OUT_DIR}")
    print(f"[smoke] evidence:  {run_dir}")

    # --- 1. load the 2.1 graph artefact -----------------------------------
    t_load = time.perf_counter()
    graph = _ensure_graph_available()
    print(f"[smoke] loaded graph in {(time.perf_counter() - t_load) * 1000:.1f} ms "
          f"({len(graph.get('nodes', []))} nodes, {len(graph.get('edges', []))} edges)")

    # --- 2. run detector twice to confirm determinism ---------------------
    t_det = time.perf_counter()
    report1 = detect_styles(graph)
    report2 = detect_styles(graph)
    elapsed_ms = (time.perf_counter() - t_det) * 1000.0
    print(f"[smoke] detector:   2 runs in {elapsed_ms:.1f} ms "
          f"(single run = {report1.detector_runtime_ms} ms)")

    # AC #4: deterministic tag output (runtime may vary, that's expected)
    d1 = report1.to_dict()
    d2 = report2.to_dict()
    d1.pop("detector_runtime_ms", None)
    d2.pop("detector_runtime_ms", None)
    if d1 != d2:
        _fail("non-deterministic: two runs produced different tag output.")
    print("[smoke] determinism: OK")

    # AC #5: cost bound
    if elapsed_ms > 10_000:
        _fail(f"cost bound exceeded: {elapsed_ms:.1f} ms > 10,000 ms.")
    if report1.cost_usd != 0.0:
        _fail(f"cost_usd must be 0 (no model spend); got {report1.cost_usd}.")
    print(f"[smoke] cost bound:  OK ({elapsed_ms:.1f} ms < 10,000 ms, $0 spend)")

    # AC #2: all 10 styles present
    styles_present = {t.style for t in report1.tags}
    missing = set(ALL_STYLES) - styles_present
    if missing:
        _fail(f"missing styles in report: {sorted(missing)}")
    print(f"[smoke] coverage:    OK ({len(styles_present)}/10 styles)")

    # AC #3: every tag carries at least one evidence item
    for t in report1.tags:
        if not t.evidence:
            _fail(f"style {t.style!r} has no evidence.")
    print(f"[smoke] evidence:    OK (all 10 tags have ≥1 evidence item)")

    # AC: every confidence in [0, 1]
    for t in report1.tags:
        if not (0.0 <= t.confidence <= 1.0):
            _fail(f"style {t.style!r} confidence {t.confidence} out of [0, 1].")
    print(f"[smoke] ranges:      OK (all confidences in [0, 1])")

    # --- 3. write deliverable artefacts ----------------------------------
    canonical = os.path.join(OUT_DIR, "arch-style-tags.json")
    rationale_path = os.path.join(OUT_DIR, "rationale.md")
    with open(canonical, "w", encoding="utf-8") as fh:
        json.dump(report1.to_dict(), fh, indent=2, sort_keys=True)
    with open(rationale_path, "w", encoding="utf-8") as fh:
        fh.write(render_rationale(report1))
    print(f"[smoke] wrote:       {canonical}")
    print(f"[smoke] wrote:       {rationale_path}")

    # --- 4. evidence: result.json + report summary ------------------------
    result = {
        "run_stamp": run_stamp,
        "graph_path": GRAPH_PATH,
        "graph_sha256": __import__("hashlib").sha256(
            open(GRAPH_PATH, "rb").read()
        ).hexdigest(),
        "elapsed_ms_total": round(elapsed_ms, 3),
        "elapsed_ms_detector_single_run": report1.detector_runtime_ms,
        "cost_usd": report1.cost_usd,
        "deterministic": True,
        "ac_checks": {
            "ac1_consumes_graph": True,
            "ac2_all_10_styles": len(styles_present) == 10,
            "ac3_evidence_per_tag": all(len(t.evidence) >= 1 for t in report1.tags),
            "ac4_deterministic": True,
            "ac5_cost_bounded": elapsed_ms < 10_000 and report1.cost_usd == 0.0,
        },
        "report": report1.to_dict(),
    }
    with open(os.path.join(run_dir, "result.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, sort_keys=True)
    print(f"[smoke] evidence:    {run_dir}/result.json")

    # --- 5. top-line summary ---------------------------------------------
    top3 = report1.top(3)
    print()
    print("Top 3 styles:")
    for t in top3:
        print(f"  - {t.style:18s} {t.confidence:.2f}  {t.rationale}")
    print()
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

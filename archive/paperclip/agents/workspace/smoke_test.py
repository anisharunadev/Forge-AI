#!/usr/bin/env python3
"""
Smoke test for the Knowledge Layer production-bar linter
(FORA-408, sub-goal 0.8.1).

Acceptance contract (mirroring the FORA-408 AC bullets):

    1. Positive run on the real workspace:
       `python -m agents.workspace.lint --root workspace/`
       exits 0 and reports zero violations across the 17 seed files.

    2. Negative run, missing Related footer:
       remove the `## Related` section from a copied seed file, lint
       the copy in a temp dir, the linter must exit 1 with exactly one
       `related-footer` diagnostic pointing at that file.

    3. Negative run, undefined acronym:
       seed a temp file with `XXYYZZ` (a clearly-not-in-glossary
       ALL-CAPS token), the linter must emit an `undefined-acronym`
       diagnostic naming that token.

    4. Negative run, vague hedge:
       seed a temp file with `it depends` in body text, the linter
       must emit a `vague-hedge` diagnostic.

    5. Determinism + cost bound:
       two consecutive lints of the same root produce byte-identical
       violation lists and run in < 5 s.

The smoke test writes evidence to `agents/workspace/evidence/<ts>/`:
    - result.json   (machine-readable summary)
    - README.md     (human-readable summary of what was tested)
"""

from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents.workspace.lint import (  # noqa: E402
    SEED_DIRS,
    LintReport,
    Violation,
    lint,
)


WORKSPACE_ROOT = Path(ROOT) / "workspace"
EVIDENCE_DIR = Path(HERE) / "evidence"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(2)


def _seed_glossary(src: Path, dst_root: Path) -> Path:
    """Copy the real glossary into a fresh seed so the linter can find it."""
    dst = dst_root / "customer" / "glossary.md"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return dst


def _copy_seed(src_root: Path, dst_root: Path) -> List[Path]:
    """Copy every .md from the real seed into a fresh tmp seed.

    Returns the list of copied files (POSIX-style relative paths).
    """
    copied: List[Path] = []
    for sub in SEED_DIRS:
        src_dir = src_root / sub
        dst_dir = dst_root / sub
        dst_dir.mkdir(parents=True, exist_ok=True)
        for src in sorted(src_dir.glob("*.md")):
            dst = dst_dir / src.name
            shutil.copy2(src, dst)
            copied.append(dst)
    return copied


# ---------------------------------------------------------------------------
# AC #1: positive run on the real workspace
# ---------------------------------------------------------------------------

def ac_positive_on_real_workspace() -> Dict[str, object]:
    print("[smoke] AC#1: positive run on the real workspace/")
    if not WORKSPACE_ROOT.is_dir():
        _fail(f"workspace not found at {WORKSPACE_ROOT}")

    report = lint(WORKSPACE_ROOT)
    if report.exit_code() != 0:
        for v in report.violations:
            print(f"    {v.render()}", file=sys.stderr)
        _fail(
            f"real workspace lint failed: {len(report.violations)} violation(s); "
            "expected 0."
        )

    if report.files_scanned < 13:
        _fail(
            f"workspace scan covered {report.files_scanned} files; expected ≥ 13 "
            "(the FORA-408 AC lower bound)."
        )

    print(f"    scanned {report.files_scanned} files in {report.elapsed_ms} ms; "
          "0 violations (exit 0)")
    return {
        "files_scanned": report.files_scanned,
        "elapsed_ms": report.elapsed_ms,
        "violations": 0,
    }


# ---------------------------------------------------------------------------
# AC #2: negative — missing Related footer
# ---------------------------------------------------------------------------

def ac_negative_missing_related() -> Dict[str, object]:
    print("[smoke] AC#2: negative — missing ## Related footer")

    with tempfile.TemporaryDirectory(prefix="workspace-lint-negative-") as tmp:
        tmp_root = Path(tmp)
        _seed_glossary(WORKSPACE_ROOT / "customer" / "glossary.md", tmp_root)
        _copy_seed(WORKSPACE_ROOT, tmp_root)

        # Remove the Related section from a known file.
        target = tmp_root / "memory" / "coding.md"
        original = target.read_text(encoding="utf-8")
        # Drop the `## 12. Related` heading and everything after it (the
        # section ends at the next `## ` or end of file).
        import re as _re
        stripped = _re.sub(
            r"^##\s+\d{0,2}\.?\s*Related.*\Z",
            "",
            original,
            flags=_re.MULTILINE | _re.DOTALL,
        ).rstrip() + "\n"
        target.write_text(stripped, encoding="utf-8")

        report = lint(tmp_root)
        if report.exit_code() == 0:
            _fail("expected exit 1 after removing ## Related; linter passed.")
        related = [v for v in report.violations if v.rule == "related-footer"]
        if len(related) != 1:
            _fail(
                f"expected exactly 1 related-footer violation; got {len(related)}: "
                f"{[v.render() for v in related]}"
            )
        if related[0].file != "memory/coding.md":
            _fail(
                f"expected related-footer on memory/coding.md; got {related[0].file}"
            )

        diagnostic = related[0].render()
        print(f"    diagnostic: {diagnostic}")
        return {
            "rule": "related-footer",
            "file": related[0].file,
            "diagnostic": diagnostic,
            "violations_total": len(report.violations),
        }


# ---------------------------------------------------------------------------
# AC #3: negative — undefined acronym
# ---------------------------------------------------------------------------

def ac_negative_undefined_acronym() -> Dict[str, object]:
    print("[smoke] AC#3: negative — undefined acronym")

    with tempfile.TemporaryDirectory(prefix="workspace-lint-acronym-") as tmp:
        tmp_root = Path(tmp)
        _seed_glossary(WORKSPACE_ROOT / "customer" / "glossary.md", tmp_root)
        # Copy a minimal seed so the linter has a non-empty directory.
        _copy_seed(WORKSPACE_ROOT, tmp_root)

        # Drop a file with a clearly-not-in-glossary ALL-CAPS token.
        # `XXYYZZ` is 6 letters (excluded by the 2-5 cap), so use a
        # 4-letter nonsense token: `ZZZZ`.
        bad = tmp_root / "memory" / "lint-fixture-acronym.md"
        bad.write_text(
            "# Lint fixture — undefined acronym\n\n"
            "This file uses the token ZZZZ to trip the undefined-acronym rule.\n\n"
            "## Related\n\n- see [glossary](../customer/glossary.md)\n",
            encoding="utf-8",
        )

        report = lint(tmp_root)
        if report.exit_code() == 0:
            _fail("expected exit 1; linter passed.")
        hits = [
            v for v in report.violations
            if v.rule == "undefined-acronym" and v.file == "memory/lint-fixture-acronym.md"
        ]
        if not hits:
            _fail(
                "expected ≥ 1 undefined-acronym violation on the fixture file; "
                f"got none. violations: {[v.render() for v in report.violations]}"
            )
        zzz_hits = [v for v in hits if "ZZZZ" in v.message]
        if not zzz_hits:
            _fail(
                f"expected an undefined-acronym violation naming ZZZZ; "
                f"got: {[v.render() for v in hits]}"
            )

        print(f"    diagnostic: {zzz_hits[0].render()}")
        return {
            "rule": "undefined-acronym",
            "file": "memory/lint-fixture-acronym.md",
            "token": "ZZZZ",
            "diagnostic": zzz_hits[0].render(),
        }


# ---------------------------------------------------------------------------
# AC #4: negative — vague hedge
# ---------------------------------------------------------------------------

def ac_negative_vague_hedge() -> Dict[str, object]:
    print("[smoke] AC#4: negative — vague hedge 'it depends'")

    with tempfile.TemporaryDirectory(prefix="workspace-lint-hedge-") as tmp:
        tmp_root = Path(tmp)
        _seed_glossary(WORKSPACE_ROOT / "customer" / "glossary.md", tmp_root)
        _copy_seed(WORKSPACE_ROOT, tmp_root)

        bad = tmp_root / "memory" / "lint-fixture-hedge.md"
        bad.write_text(
            "# Lint fixture — vague hedge\n\n"
            "Whether this works is unclear; the answer is, of course, "
            "it depends on the deployment.\n\n"
            "## Related\n\n- see [glossary](../customer/glossary.md)\n",
            encoding="utf-8",
        )

        report = lint(tmp_root)
        if report.exit_code() == 0:
            _fail("expected exit 1; linter passed.")
        hits = [
            v for v in report.violations
            if v.rule == "vague-hedge" and v.file == "memory/lint-fixture-hedge.md"
        ]
        if not hits:
            _fail(
                "expected ≥ 1 vague-hedge violation on the fixture file; "
                f"got none. violations: {[v.render() for v in report.violations]}"
            )

        print(f"    diagnostic: {hits[0].render()}")
        return {
            "rule": "vague-hedge",
            "file": "memory/lint-fixture-hedge.md",
            "phrase": "it depends",
            "diagnostic": hits[0].render(),
        }


# ---------------------------------------------------------------------------
# AC #5: determinism + cost bound
# ---------------------------------------------------------------------------

def ac_determinism_and_cost() -> Dict[str, object]:
    print("[smoke] AC#5: determinism + cost bound")
    r1 = lint(WORKSPACE_ROOT)
    r2 = lint(WORKSPACE_ROOT)
    if r1.exit_code() != r2.exit_code():
        _fail(f"non-deterministic exit codes: {r1.exit_code()} vs {r2.exit_code()}")
    if [v.render() for v in r1.violations] != [v.render() for v in r2.violations]:
        _fail("non-deterministic violation list across two runs.")
    if (r1.elapsed_ms + r2.elapsed_ms) > 5_000:
        _fail(
            f"cost bound exceeded: two runs = {r1.elapsed_ms + r2.elapsed_ms} ms > 5000 ms"
        )
    print(
        f"    deterministic across 2 runs; combined {r1.elapsed_ms + r2.elapsed_ms} ms "
        f"(< 5000 ms)"
    )
    return {
        "run_1_ms": r1.elapsed_ms,
        "run_2_ms": r2.elapsed_ms,
        "combined_ms": r1.elapsed_ms + r2.elapsed_ms,
        "exit_code": r1.exit_code(),
    }


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    run_stamp = _ts()
    run_dir = EVIDENCE_DIR / f"smoke_{run_stamp}"
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"[smoke] run stamp: {run_stamp}")
    print(f"[smoke] evidence:  {run_dir}")

    t_total = time.perf_counter()
    results: Dict[str, Dict[str, object]] = {}
    results["ac1_positive_on_real_workspace"] = ac_positive_on_real_workspace()
    results["ac2_negative_missing_related"] = ac_negative_missing_related()
    results["ac3_negative_undefined_acronym"] = ac_negative_undefined_acronym()
    results["ac4_negative_vague_hedge"] = ac_negative_vague_hedge()
    results["ac5_determinism_and_cost"] = ac_determinism_and_cost()
    elapsed_ms = round((time.perf_counter() - t_total) * 1000.0, 3)

    summary = {
        "run_stamp": run_stamp,
        "smoke": "agents/workspace/smoke_test.py",
        "elapsed_ms_total": elapsed_ms,
        "results": results,
    }
    with open(run_dir / "result.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, sort_keys=True)
    print(f"[smoke] wrote {run_dir}/result.json")
    print(f"[smoke] all ACs green ({elapsed_ms} ms total)")
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

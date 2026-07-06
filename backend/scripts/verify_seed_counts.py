#!/usr/bin/env python3
"""verify_seed_counts.py — T1.4 (M1 Infrastructure & Seed).

Verify that every declared row count in each installed seed package's
``manifest.json`` matches the actual number of rows in the
corresponding ``data/*.json`` file.

This script does NOT boot Postgres, LiteLLM, or any backing service.
It only reads:

  - ``backend/seeds/packages/<name>/manifest.json``
  - ``backend/seeds/packages/<name>/data/*.json``

Each data file is a top-level JSON object whose ``rows`` key carries
a JSON array. We count those rows and compare against
``manifest.row_counts_expected[<table>]``.

Exit codes:
  0 — all packages pass
  1 — at least one mismatch
  2 — manifest / data file missing / unreadable
  3 — no packages found (sanity check on the seed root)

Usage:
  python backend/scripts/verify_seed_counts.py             # all packages
  python backend/scripts/verify_seed_counts.py acme-corp   # one package
  python backend/scripts/verify_seed_counts.py --json      # machine-readable
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# Resolve relative to this file so the script works from any cwd.
SCRIPT_PATH = Path(__file__).resolve()
BACKEND_ROOT = SCRIPT_PATH.parents[1]  # .../backend
SEEDS_ROOT = BACKEND_ROOT / "seeds" / "packages"


# ---------------------------------------------------------------------------
# Result DTO (plain dict so we can JSON-serialize trivially)
# ---------------------------------------------------------------------------


def _read_json(path: Path) -> Any:
    """Read a JSON file or raise a descriptive error."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:  # noqa: PERF203 — clarity over perf
        raise FileNotFoundError(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON in {path}: {exc}") from exc


def _load_package(package_dir: Path) -> dict[str, Any]:
    """Load one package's manifest + data files."""
    manifest_path = package_dir / "manifest.json"
    if not manifest_path.exists():
        return {
            "name": package_dir.name,
            "ok": False,
            "error": f"manifest.json missing at {manifest_path}",
            "tables": [],
            "totals": {"expected": 0, "actual": 0, "delta": 0},
        }

    try:
        manifest = _read_json(manifest_path)
    except (FileNotFoundError, ValueError) as exc:
        return {
            "name": package_dir.name,
            "ok": False,
            "error": str(exc),
            "tables": [],
            "totals": {"expected": 0, "actual": 0, "delta": 0},
        }

    expected_map: dict[str, int] = manifest.get("row_counts_expected", {}) or {}
    manifest_name = manifest.get("name", package_dir.name)

    tables: list[dict[str, Any]] = []
    total_expected = 0
    total_actual = 0

    for entry in manifest.get("data_files", []) or []:
        table = entry.get("table", "<unknown>")
        file_name = entry.get("file", "")
        data_path = package_dir / "data" / file_name
        expected = int(expected_map.get(table, 0))
        try:
            payload = _read_json(data_path)
        except (FileNotFoundError, ValueError) as exc:
            tables.append(
                {
                    "table": table,
                    "file": file_name,
                    "expected": expected,
                    "actual": None,
                    "ok": False,
                    "error": str(exc),
                }
            )
            total_expected += expected
            continue

        # The seed runner expects {"rows": [...]} or a flat list.
        if isinstance(payload, dict) and "rows" in payload:
            rows = payload["rows"]
        elif isinstance(payload, list):
            rows = payload
        else:
            tables.append(
                {
                    "table": table,
                    "file": file_name,
                    "expected": expected,
                    "actual": 0,
                    "ok": False,
                    "error": (
                        f"unexpected JSON shape at {data_path}: "
                        f"expected dict-with-rows or list, got {type(payload).__name__}"
                    ),
                }
            )
            total_expected += expected
            continue

        actual = len(rows)
        ok = actual == expected
        tables.append(
            {
                "table": table,
                "file": file_name,
                "expected": expected,
                "actual": actual,
                "ok": ok,
            }
        )
        total_expected += expected
        total_actual += actual

    all_ok = all(t["ok"] for t in tables)
    return {
        "name": manifest_name,
        "ok": all_ok,
        "error": None,
        "tables": tables,
        "totals": {
            "expected": total_expected,
            "actual": total_actual,
            "delta": total_actual - total_expected,
        },
    }


def discover_packages(root: Path) -> list[Path]:
    """Return all installed seed package directories."""
    if not root.exists():
        return []
    return sorted(p for p in root.iterdir() if p.is_dir() and (p / "manifest.json").exists())


def render_text(reports: list[dict[str, Any]]) -> str:
    """Human-readable rendering for terminal output."""
    lines: list[str] = []
    lines.append("Seed manifest verification")
    lines.append(f"  seeds root : {SEEDS_ROOT}")
    lines.append(f"  packages   : {len(reports)}")
    lines.append("")

    overall_ok = True
    for report in reports:
        name = report["name"]
        status = "OK " if report["ok"] else "FAIL"
        totals = report["totals"]
        lines.append(
            f"[{status}] {name}  (rows actual={totals['actual']}, expected={totals['expected']})"
        )
        if report["error"]:
            lines.append(f"        error: {report['error']}")
        for table in report["tables"]:
            mark = "ok " if table["ok"] else "!! "
            actual = table["actual"]
            expected = table["expected"]
            line = (
                f"        {mark}{table['table']:<28} {expected:>5} expected, {actual!s:>5} actual"
            )
            if not table["ok"]:
                if actual is None:
                    line += f"  ({table['error']})"
                else:
                    line += f"  (delta {actual - expected:+d})"
            lines.append(line)
        if not report["ok"]:
            overall_ok = False
        lines.append("")

    lines.append(f"Overall: {'PASS' if overall_ok else 'FAIL'}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="verify_seed_counts.py",
        description=(
            "Compare every seed package's declared row_counts_expected "
            "against the actual JSON row count in the data files. "
            "Does not require Postgres / any backing service."
        ),
    )
    parser.add_argument(
        "packages",
        nargs="*",
        help="Specific package names to verify (default: all packages).",
    )
    parser.add_argument(
        "--seeds-root",
        type=Path,
        default=SEEDS_ROOT,
        help=f"Override seed packages root (default: {SEEDS_ROOT}).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a JSON report instead of human-readable text.",
    )
    args = parser.parse_args(argv)

    seeds_root: Path = args.seeds_root
    if not seeds_root.exists():
        print(f"verify_seed_counts: seeds root not found: {seeds_root}", file=sys.stderr)
        return 2

    if args.packages:
        package_dirs = [seeds_root / name for name in args.packages]
        for d in package_dirs:
            if not d.exists() or not (d / "manifest.json").exists():
                print(
                    f"verify_seed_counts: package not found or missing manifest: {d}",
                    file=sys.stderr,
                )
                return 2
    else:
        package_dirs = discover_packages(seeds_root)
        if not package_dirs:
            print(
                f"verify_seed_counts: no seed packages found under {seeds_root}",
                file=sys.stderr,
            )
            return 3

    reports = [_load_package(d) for d in package_dirs]

    if args.json:
        print(json.dumps(reports, indent=2))
    else:
        print(render_text(reports))

    return 0 if all(r["ok"] for r in reports) else 1


if __name__ == "__main__":
    sys.exit(main())

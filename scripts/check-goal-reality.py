#!/usr/bin/env python3
"""Verify 'implemented' goal docs point to real code paths.

Rules:
  1. Skip 'in-progress' and 'cancelled' goals.
  2. For every 'implemented' goal:
     a. Parse 'Files:' / 'Targets:' / 'Routes:' / 'Models:' lines.
        Accept any line containing a backtick-quoted path matching
        (a) a real file in the repo, OR
        (b) a real route in backend/app/api/v1/.
     b. Find at least one PR reference in the doc, OR (fallback)
        find at least one test file that exercises the goal's primary
        feature (heuristic: the goal's slug in lowercase appears in a
        .py or .ts file under tests/).

Usage:
    ./scripts/check-goal-reality.sh
"""
from __future__ import annotations

import argparse
import ast
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GOALS = REPO / "docs" / "goals"
V1 = REPO / "backend" / "app" / "api" / "v1"

STATUS_RE = re.compile(
    r"""^(?:>\s*)?\*\*Status:\*\*\s+(?P<raw>.+?)\s*$""",
    re.IGNORECASE | re.MULTILINE,
)

# Lines like "- Files: `backend/app/foo.py`, `apps/forge/lib/x.ts`"
TARGETS_RE = re.compile(r"(?:Files|Targets|Routes|Models|Endpoints|Paths):\s*`([^`]+)`", re.IGNORECASE)
PR_RE = re.compile(r"#\d{2,6}\b")
SLUG_RE = re.compile(r"\bstep-(\d+)\b")


def status_of(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8")
    head = "\n".join(text.splitlines()[:10])
    m = STATUS_RE.search(head)
    if not m:
        return None
    raw = m.group("raw").strip().rstrip(".").lower()
    if raw in {"implemented", "in-progress", "cancelled"}:
        return raw
    return raw


def all_routes() -> set[str]:
    out: set[str] = set()
    for py in V1.rglob("*.py"):
        if py.name in {"__init__.py", "router.py", "_package_wiring.py"}:
            continue
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                call = dec if isinstance(dec, ast.Call) else None
                if call is None or not isinstance(call.func, ast.Attribute):
                    continue
                if call.func.attr not in {"get", "post", "put", "patch", "delete"}:
                    continue
                if call.args and isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
                    val = call.args[0].value
                    out.add(val if val.startswith("/api") else f"/api/v1{val}" if val.startswith("/") else f"/api/v1/{val}")
    return out


def _index_source_files() -> set[str]:
    out: set[str] = set()
    skip_dirs = {
        "node_modules", ".next", "dist", "coverage", "__pycache__",
        ".venv", "venv", ".git", "test-results",
    }
    for p in REPO.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(REPO).as_posix()
        if any(s in rel.split("/") for s in skip_dirs):
            continue
        if rel.startswith("repomix-output") or rel.endswith(".xml"):
            continue
        out.add(rel)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    routes = all_routes()
    files = _index_source_files()
    if args.verbose:
        print(f"indexed {len(routes)} routes, {len(files)} files")

    problems: list[str] = []
    checked = 0
    step_files = sorted(GOALS.glob("step-*.md"))
    primaries = [
        p for p in step_files
        if not re.search(r"-(deliverable|verification|rationale|v\d)\.md$", p.name, re.IGNORECASE)
    ]
    for p in primaries:
        state = status_of(p)
        if state != "implemented":
            continue
        checked += 1
        text = p.read_text(encoding="utf-8")
        targets = TARGETS_RE.findall(text)
        if not targets:
            problems.append(f"{p}: 'implemented' but no Files/Targets/Routes/Models/Endpoints/Paths line")
            continue
        missing = [t for t in targets if t not in files and t not in routes and not any(t in r or r in t for r in routes)]
        if missing:
            problems.append(
                f"{p}: 'implemented' but targets missing in code: {', '.join(missing)}"
            )
            continue
        has_pr = bool(PR_RE.search(text))
        slug = SLUG_RE.search(p.name)
        if not has_pr and slug:
            slug_id = slug.group(1)
            test_dirs = [
                REPO / "backend" / "tests",
                REPO / "apps" / "forge" / "tests",
            ]
            existing = [str(d) for d in test_dirs if d.exists()]
            if existing:
                try:
                    r = subprocess.run(
                        ["grep", "-rl", f"step-{slug_id}", *existing],
                        capture_output=True, text=True, check=False,
                    )
                    if not r.stdout.strip():
                        problems.append(
                            f"{p}: 'implemented' has no PR reference and no test file references step-{slug_id}"
                        )
                except FileNotFoundError:
                    pass

    if args.verbose:
        print(f"checked {checked} implemented goal docs")
    if problems:
        print("\n".join(f"::error::{p}" for p in problems), file=sys.stderr)
        return 1
    print(f"✅ All {checked} 'implemented' goal docs reference real code paths.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

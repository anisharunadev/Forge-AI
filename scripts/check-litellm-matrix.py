#!/usr/bin/env python3
"""Verify the §2 endpoint matrix in
docs/litellm/forge-litellm-integration.md does not name a /api/v1/ path
that doesn't exist in backend/app/api/v1/.

§2 is a Forge-feature → LiteLLM-endpoint matrix. Some entries are LiteLLM
passthroughs — those are exempt (paths not starting with /api/v1/).

Rule: any path in column 3 starting with '/api/v1/' MUST exist as a
router path in backend/app/api/v1/.

Usage:
    ./scripts/check-litellm-matrix.sh
"""
from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOC = REPO / "docs" / "litellm" / "forge-litellm-integration.md"
V1 = REPO / "backend" / "app" / "api" / "v1"

SEC2_HEADER = re.compile(r"^##\s*2\.\s", re.MULTILINE)
SEC3_HEADER = re.compile(r"^##\s*3\.\s", re.MULTILINE)
# 3- or 4-column table row; capture column 3.
ROW_RE = re.compile(r"^\|\s*[^|]+\s*\|\s*[^|]+\s*\|\s*(?P<c3>[^|]+?)\s*(?:\|\s*[^|]*\s*\|)?\s*$")
PATH_RE = re.compile(r"`(/[a-zA-Z_][a-zA-Z0-9_/{}\-]*)`")


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
                    if val.startswith("/api"):
                        out.add(val)
                    elif val.startswith("/"):
                        out.add(f"/api/v1{val}")
                    else:
                        out.add(f"/api/v1/{val}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if not DOC.exists():
        print(f"::error::{DOC} not found", file=sys.stderr)
        return 1
    text = DOC.read_text(encoding="utf-8")

    sec2 = SEC2_HEADER.search(text)
    if not sec2:
        print(f"::error::{DOC} has no '## 2.' section", file=sys.stderr)
        return 1
    sec3 = SEC3_HEADER.search(text)
    body = text[sec2.end():sec3.start() if sec3 else None]

    routes = all_routes()
    problems: list[str] = []
    checked = 0

    for line in body.splitlines():
        if not line.startswith("|"):
            continue
        m = ROW_RE.match(line)
        if not m:
            continue
        c3 = m.group("c3")
        for path_match in PATH_RE.finditer(c3):
            path = path_match.group(1)
            if not path.startswith("/api/v1/"):
                continue
            stripped = re.sub(r"\{[^}]+\}", "{id}", path)
            checked += 1
            if path in routes or stripped in routes:
                continue
            problems.append(f"{DOC}: §2 mentions '{path}' but no router defines it")

    if args.verbose:
        print(f"checked {checked} /api/v1/ path mentions in §2")
    if problems:
        print("\n".join(f"::error::{p}" for p in problems), file=sys.stderr)
        return 1
    print(f"✅ §2 endpoint matrix references {checked} /api/v1/ paths, all real.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

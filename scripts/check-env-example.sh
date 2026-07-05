#!/usr/bin/env bash
# scripts/check-env-example.sh — fail CI when .env.example is missing a
# Settings field declared in backend/app/core/config.py.
# Phase 7 SC-7.7.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

python3 - <<'PY'
"""Enumerate Settings fields and compare against .env.example."""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

CFG = Path("backend/app/core/config.py")
ENV = Path(".env.example")

src = CFG.read_text(encoding="utf-8")
tree = ast.parse(src)

settings_cls = next(
    n for n in tree.body
    if isinstance(n, ast.ClassDef) and n.name == "Settings"
)

declared: set[str] = set()
for stmt in settings_cls.body:
    if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
        declared.add(stmt.target.id.upper())

example_keys: set[str] = set()
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(r"^([A-Z_][A-Z0-9_]*)\s*=", line)
    if m:
        example_keys.add(m.group(1))

missing = sorted(declared - example_keys)
if missing:
    print(f"::error::.env.example is missing {len(missing)} Settings field(s):")
    for key in missing:
        print(f"  - {key}")
    sys.exit(1)
print(f"env-example: {len(declared)} Settings fields, {len(example_keys)} example keys, 0 missing")
PY

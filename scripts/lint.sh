#!/usr/bin/env bash
# scripts/lint.sh — run ruff + mypy on the FastAPI backend.
#
# Usage:
#   scripts/lint.sh                # ruff check + ruff format check + mypy
#   scripts/lint.sh --fix          # ruff check --fix + ruff format
#
# Exits non-zero on the first failure. CI runs this script
# verbatim; keep the surface small and dependency-free.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

if ! command -v ruff >/dev/null 2>&1; then
    echo "[lint] ruff not installed; install with: pip install ruff" >&2
    exit 1
fi

mode="check"
for arg in "$@"; do
    case "$arg" in
        --fix) mode="fix" ;;
    esac
done

echo "[lint] ruff check ($mode)"
if [[ "$mode" == "fix" ]]; then
    ruff check --fix .
    ruff format .
else
    ruff check .
    ruff format --check .
fi

if command -v mypy >/dev/null 2>&1; then
    echo "[lint] mypy"
    mypy app
else
    echo "[lint] mypy not installed; skipping (install with: pip install mypy)" >&2
fi

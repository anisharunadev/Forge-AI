#!/usr/bin/env bash
#
# Regenerate the Built Features table in .claude/CLAUDE.md from
# built-features.yaml. Run this after editing the YAML, or use
# `generate-built-features.sh --check` in CI to detect drift.
#
# Usage:
#   ./scripts/generate-built-features.sh           # rewrite table
#   ./scripts/generate-built-features.sh --check   # exit 1 on drift
#   ./scripts/generate-built-features.sh --dry-run # print to stdout
#
# Requires: python3, PyYAML
#   pip install pyyaml

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${PYTHON:-python3}"

cd "$REPO_ROOT"

if [ ! -f "built-features.yaml" ]; then
    echo "error: built-features.yaml not found at repo root" >&2
    exit 2
fi

if ! "$PY" -c "import yaml" 2>/dev/null; then
    echo "error: PyYAML not installed. Install with: pip install pyyaml" >&2
    exit 2
fi

exec "$PY" scripts/generate-built-features.py "$@"
#!/usr/bin/env bash
#
# scripts/check-page-dod.sh — M15-2 wrapper for check-page-dod.py
#
# Local:   ./scripts/check-page-dod.sh
# CI:      ./scripts/check-page-dod.sh --route <one>   # per-page annotations
# Debug:   ./scripts/check-page-dod.sh --verbose
#
# Exit 0  every page meets its declared verdicts
# Exit 1  one or more pages regressed
# Exit 2  setup error (manifest/structure invalid)
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Run from a venv if it exists (matches backend/test workflow).
if [ -d ".venv" ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

exec python3 scripts/check-page-dod.py "$@"

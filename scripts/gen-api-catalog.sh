#!/usr/bin/env bash
#
# Wrapper for scripts/gen-api-catalog.py.
#
#   ./scripts/gen-api-catalog.sh           # rewrite docs/reference/api-catalog.md
#   ./scripts/gen-api-catalog.sh --check   # exit 1 if drift
#   ./scripts/gen-api-catalog.sh --dry-run # print to stdout
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec python3 scripts/gen-api-catalog.py "$@"

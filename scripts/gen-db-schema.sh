#!/usr/bin/env bash
#
# Wrapper for scripts/gen-db-schema.py.
#
#   ./scripts/gen-db-schema.sh           # rewrite docs/reference/db-schema.md
#   ./scripts/gen-db-schema.sh --check   # exit 1 if drift
#   ./scripts/gen-db-schema.sh --dry-run # print to stdout
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec python3 scripts/gen-db-schema.py "$@"

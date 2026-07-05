#!/usr/bin/env bash
# Verify the §2 endpoint matrix in docs/litellm/forge-litellm-integration.md
# does not name a /api/v1/ path that doesn't exist.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec python3 scripts/check-litellm-matrix.py "$@"

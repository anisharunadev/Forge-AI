#!/usr/bin/env bash
# Verify 'implemented' goal docs reference real code paths.
# See scripts/check-goal-reality.py for the rule set.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec python3 scripts/check-goal-reality.py "$@"

#!/usr/bin/env bash
#
# Verify every docs/goals/step-*.md has a top-of-file Status header.
# See scripts/check-goal-status.py for the rule set.
#
# Usage:
#   bash scripts/check-goal-status.sh            # CI mode (exit 1 on fail)
#   bash scripts/check-goal-status.sh --list     # show every goal + status
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec python3 scripts/check-goal-status.py "$@"

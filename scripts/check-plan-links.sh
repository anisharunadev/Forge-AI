#!/usr/bin/env bash
# Verify docs/plan/README.md checklist items link bidirectionally to phase docs.
# See scripts/check-plan-links.py for the rule set.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec python3 scripts/check-plan-links.py "$@"

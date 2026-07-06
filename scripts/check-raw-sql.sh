#!/usr/bin/env bash
# scripts/check-raw-sql.sh — bandit B608 gate.
#
# Catches the 3 patterns the Phase 4 brief enumerates (rls.py:86,87
# and knowledge_graph.py:575) plus any other text() call that
# interpolates a value via f-string. Pre-existing inventory-based
# helpers (e.g. ``gdpr_cascade.py``) interpolate hard-coded constants
# — those are NOT bandit B608 hits, so we exclude them.
#
# Run by pre-commit and by python-ci.yml::pre-commit.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Whitelist of files where f-string SQL is intentional (hard-coded
# table/column inventories — bandit won't flag them).
ALLOWLIST='(gdpr_cascade\.py)'

# Catch: text(f"...SQL_KEYWORD...") — the canonical bandit B608 pattern.
hits=$(grep -rnE 'text\(\s*f["\x27](SELECT|INSERT|UPDATE|DELETE)' "$ROOT/backend/app" \
  --include='*.py' \
  | grep -v __pycache__ \
  | grep -Ev "/($ALLOWLIST):" || true)
if [[ -n "$hits" ]]; then
  echo "::error::text(f\"SQL...\") detected in backend/app (B608):"
  echo "$hits"
  exit 1
fi

echo "raw-sql-audit: 0 hits"

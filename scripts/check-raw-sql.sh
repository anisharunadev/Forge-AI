#!/usr/bin/env bash
# scripts/check-raw-sql.sh — companion grep for bandit B608.
# Run by pre-commit and by python-ci.yml::pre-commit.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hits=$(grep -rnE "f['\"](SELECT|INSERT|UPDATE|DELETE)" "$ROOT/backend/app" \
  --include='*.py' | grep -v __pycache__ || true)
if [[ -n "$hits" ]]; then
  echo "::error::Raw f-string SQL detected in backend/app (B608):"
  echo "$hits"
  exit 1
fi
echo "raw-sql-audit: 0 hits"

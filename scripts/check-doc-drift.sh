#!/usr/bin/env bash
#
# Detect drift between generated docs and code.
#
# Runs every gen-*.sh in --check mode and exits 1 if any report drift.
# Wired into .github/workflows/docs.yml. Run locally:
#
#   bash scripts/check-doc-drift.sh
#
# To regenerate docs after a code change:
#
#   bash scripts/gen-api-catalog.sh
#   bash scripts/gen-db-schema.sh
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

fail=0
for gen in scripts/gen-api-catalog.sh scripts/gen-db-schema.sh; do
  echo "==> $gen --check"
  if ! bash "$gen" --check; then
    echo "::error::$gen reported drift. Run $gen to regenerate."
    fail=1
  fi
done

if (( fail )); then
  echo
  echo "One or more generated docs are out of date. Fix:"
  echo "  bash scripts/gen-api-catalog.sh"
  echo "  bash scripts/gen-db-schema.sh"
  exit 1
fi

echo "✅ No drift in generated docs."

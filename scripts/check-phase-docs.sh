#!/usr/bin/env bash
#
# Verify every docs/plan/phase-N.md (N = 1..8) has the required sections.
#
# Required sections:
#   - "Phase Close-out" — any H2/H3 heading containing "Phase Close-out".
#
# Usage:
#   bash scripts/check-phase-docs.sh
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

fail=0
for n in 1 2 3 4 5 6 7 8; do
  doc="docs/plan/phase-${n}.md"
  [[ -f "$doc" ]] || { echo "::error::$doc missing"; fail=1; continue; }
  if ! grep -qiE '^##.*phase close-out' "$doc"; then
    echo "::error::$doc is missing a 'Phase Close-out' section"
    fail=1
  fi
done

if (( fail )); then
  echo
  echo "One or more phase docs are missing the Phase Close-out section."
  exit 1
fi

echo "✅ All phase-1..phase-8 docs have a Phase Close-out section."

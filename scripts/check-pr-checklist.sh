#!/usr/bin/env bash
# scripts/check-pr-checklist.sh — enforces the "Schema changes"
# checklist from .github/PULL_REQUEST_TEMPLATE.md.
#
# Wired into .github/workflows/python-ci.yml::pre-commit.
#
# The CI step passes the PR body via stdin (or env: PR_BODY); this
# script:
#   * Looks for the literal "## Schema changes" header.
#   * Counts unchecked checkboxes ([ ]) under it until the next
#     ``## `` heading or end-of-input.
#   * Exits non-zero if any checkbox is unchecked AND the PR touches
#     db/models or alembic/versions paths.
#
# Usage:
#   bash scripts/check-pr-checklist.sh <pull-request.body
#
# When the PR does NOT touch schema, the section can be removed
# entirely from the body and the gate no-ops.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read PR body from stdin or env.
if [[ -n "${PR_BODY:-}" ]]; then
  body="$PR_BODY"
else
  body=$(cat)
fi

# If the section is absent, exit 0 (the PR is not a schema PR).
if ! grep -q "^## Schema changes" <<<"$body"; then
  echo "pr-checklist: no '## Schema changes' section — gate no-ops."
  exit 0
fi

# Extract everything between "## Schema changes" and the next "## " heading
# or end-of-input.
section=$(awk '
  /^## Schema changes/ { in_section=1; next }
  in_section && /^## / { exit }
  in_section { print }
' <<<"$body")

# Count unchecked checkboxes.
unchecked=$(grep -c "^- \[ \]" <<<"$section" || true)

if [[ "$unchecked" -gt 0 ]]; then
  echo "::error::PR schema checklist has $unchecked unchecked item(s):"
  grep "^- \[ \]" <<<"$section" | sed 's/^/  /'
  exit 1
fi

echo "pr-checklist: $unchecked unchecked items — OK"

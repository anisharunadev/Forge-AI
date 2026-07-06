#!/usr/bin/env bash
# scripts/check-master-checklist.sh - verify every master-checklist
# item in docs/plan/README.md has an evidence row in
# docs/plan/phase-8-signoff.md.
#
# Exit 0 if all 22 rows are "Verified"; 1 otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKLIST="$ROOT/docs/plan/README.md"
SIGNOFF="$ROOT/docs/plan/phase-8-signoff.md"

# Count rows in the master checklist (excluding header rows).
# Only rows in the master checklist table (1..22). The README also
# has numbered rows in other sections (anti-patterns, etc.). The
# simplest discriminator: the owner-phase column ranges from 1..8.
# Only rows in the master checklist table. The README has the master
# checklist under the "A reviewer can mark the project 10/10 when"
# heading; rows after that have 22 entries numbered 1..22.
# Master checklist table is between "## Definition of "10/10"" and
# "## Anti-Patterns Forbidden". We slice the file at those headings and
# count numbered rows.
master_total=$(awk '
  /^## Definition of "10\/10"/ {in_table=1; next}
  /^## Anti-Patterns/ {in_table=0}
  in_table && /^\| [0-9]+ \|/ {n=$2; gsub(/ /,"",n); print n}
' "$CHECKLIST" | sort -un | wc -l)

# Count "Verified" rows in the signoff.
signoff_verified=$(grep -cE "^\| [0-9]+ \|.*\| Verified \|" "$SIGNOFF" || true)

if [[ "$master_total" -ne 22 ]]; then
  echo "X expected 22 master-checklist items, found $master_total"
  exit 1
fi

if [[ "$signoff_verified" -lt 22 ]]; then
  echo "X expected 22 'Verified' rows in signoff, found $signoff_verified"
  exit 1
fi

echo "OK master-checklist verification: 22/22 verified"

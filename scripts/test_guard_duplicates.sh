#!/usr/bin/env bash
# test_guard_duplicates.sh — FORA-548 verification suite
#
# Runs the guard against a small set of representative issues and
# checks exit codes. Use this after any change to
# `guard-duplicate-issue.sh` to confirm the contract still holds.
#
# Pass criteria (printed at the end):
#   - FORA-482  → exit 1  (duplicate of FORA-488)
#   - FORA-488  → exit 0  (canonical, not its own duplicate)
#   - FORA-500  → exit 0  (different child of FORA-393)
#   - FORA-501  → exit 0  (different child of FORA-393)
#   - FORA-393  → exit 0  (parent plan, not a duplicate of itself)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/guard-duplicate-issue.sh"

if [[ ! -x "$GUARD" ]]; then
  echo "FATAL: $GUARD is missing or not executable" >&2
  exit 2
fi

PASS=0
FAIL=0
FAILURES=()

expect_exit() {
  local label="$1"
  local issue="$2"
  local want="$3"
  local got
  bash "$GUARD" "$issue" >/dev/null 2>&1
  got=$?
  if [[ "$got" == "$want" ]]; then
    echo "  PASS  $label  ($issue → exit $got)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label  ($issue → exit $got, wanted $want)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label")
  fi
}

echo "guard-duplicate-issue.sh verification suite"
echo "==========================================="
expect_exit "FORA-482 should be flagged as duplicate of FORA-488" "FORA-482" "1"
expect_exit "FORA-488 (canonical F1) is NOT a duplicate of itself"  "FORA-488" "0"
expect_exit "FORA-500 (Center #1) is NOT a duplicate of FORA-501"  "FORA-500" "0"
expect_exit "FORA-501 (Center #2) is NOT a duplicate of FORA-500"  "FORA-501" "0"
expect_exit "FORA-393 (parent plan) is NOT a duplicate of itself"   "FORA-393" "0"

echo ""
echo "result: $PASS pass, $FAIL fail"
if [[ $FAIL -gt 0 ]]; then
  echo "failures: ${FAILURES[*]}" >&2
  exit 1
fi
exit 0

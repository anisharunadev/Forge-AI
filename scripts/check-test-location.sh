#!/usr/bin/env bash
# scripts/check-test-location.sh
#
# Enforces the contract documented in apps/forge/CLAUDE.md and apps/forge/vitest.config.ts:
#
#   > `pnpm test` only picks up files matching `tests/**/*.test.{ts,tsx}`
#   > (see `vitest.config.ts`). Tests in `__tests__/` … are not in the
#   > glob — invoke them by file path or move them under `tests/`.
#
# This script fails (exit 1) when a *.test.ts / *.test.tsx file is found
# outside apps/forge/tests/ so the violation is caught in CI, not
# silently skipped at test time.
#
# Wired into .github/workflows/test.yml. Run locally:
#   bash scripts/check-test-location.sh

set -euo pipefail

ROOT="${1:-apps/forge}"
if [[ ! -d "$ROOT" ]]; then
  echo "::error::Root '$ROOT' does not exist."
  exit 1
fi

# Discover orphan vitest test files (anywhere under ROOT, NOT under ROOT/tests/,
# NOT inside node_modules / .next / dist / coverage).
mapfile -t hits < <(
  find "$ROOT" \
    -type f \
    \( -name '*.test.ts' -o -name '*.test.tsx' \) \
    -not -path "$ROOT/tests/*" \
    -not -path "$ROOT/node_modules/*" \
    -not -path "$ROOT/.next/*" \
    -not -path "$ROOT/dist/*" \
    -not -path "$ROOT/coverage/*" \
    -not -path "$ROOT/.next-build/*" \
    -not -path "$ROOT/.next.old/*" \
    -not -path "$ROOT/.next.rootowned/*" \
    -not -path "$ROOT/test-results/*"
)

# Also catch __tests__/ directories — files inside are by convention
# also orphans (and the directory itself is dead weight).
mapfile -t orphan_dirs < <(
  find "$ROOT" -type d -name '__tests__' \
    -not -path "$ROOT/node_modules/*"
)

if (( ${#hits[@]} > 0 || ${#orphan_dirs[@]} > 0 )); then
  echo "::error::Orphan vitest test files / __tests__/ directories found."
  if (( ${#hits[@]} > 0 )); then
    echo "::error::Move these files under ${ROOT}/tests/:"
    for h in "${hits[@]}"; do
      echo "  - $h"
    done
  fi
  if (( ${#orphan_dirs[@]} > 0 )); then
    echo "::error::Remove these __tests__/ directories (move contents to ${ROOT}/tests/):"
    for d in "${orphan_dirs[@]}"; do
      echo "  - $d"
    done
  fi
  echo "::error::See apps/forge/CLAUDE.md 'Hook test location' and 'pnpm test' notes."
  exit 1
fi

echo "✅ All vitest tests live under ${ROOT}/tests/."

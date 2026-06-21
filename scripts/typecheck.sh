#!/usr/bin/env bash
# scripts/typecheck.sh — run `tsc --noEmit` on the Next.js frontend.
#
# Usage:
#   scripts/typecheck.sh
#
# Exits non-zero on the first type error. The forge-ui workspace is
# the only TypeScript surface in v2.0; the orchestrator-side TS
# packages were retired with the v1 stack.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$REPO_ROOT/apps/forge" ]]; then
    echo "[typecheck] apps/forge not present yet (parallel work in progress); nothing to do" >&2
    exit 0
fi

cd "$REPO_ROOT/apps/forge"

if ! command -v pnpm >/dev/null 2>&1; then
    echo "[typecheck] pnpm not installed; install with: npm i -g pnpm" >&2
    exit 1
fi

echo "[typecheck] tsc --noEmit (apps/forge)"
pnpm exec tsc --noEmit

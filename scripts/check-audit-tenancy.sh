#!/usr/bin/env bash
# scripts/check-audit-tenancy.sh — wraps audit-tenancy with --strict.
#
# Local: bash scripts/check-audit-tenancy.sh
# CI:    .github/workflows/python-ci.yml::audit-tenancy
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec python3 scripts/audit-tenancy.py --strict --require-composite-index

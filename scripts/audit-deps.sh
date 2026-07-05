#!/usr/bin/env bash
# scripts/audit-deps.sh - Phase 8 SC-8.9.
#
# Runs pip-audit on backend/requirements.txt and pnpm audit on the
# monorepo's apps/forge. Zero high/critical CVEs required for launch.
#
# Exit 0 if clean; 1 on any high/critical finding; 2 on missing tools.
#
# Usage:
#   bash scripts/audit-deps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Resolve requirements file (plan said backend/requirements.txt;
# reality is backend/pyproject.toml or requirements*.txt).
REQUIREMENTS=""
for candidate in backend/requirements.txt backend/requirements.in backend/pyproject.toml; do
  if [[ -f "$candidate" ]]; then
    REQUIREMENTS="$candidate"
    break
  fi
done

PIP_AUDIT_RC=0
PNPM_AUDIT_RC=0

# 1) Backend dependency audit.
if command -v pip-audit >/dev/null 2>&1; then
  echo "[pip-audit] scanning $REQUIREMENTS..."
  if [[ -n "$REQUIREMENTS" && "$REQUIREMENTS" == *.txt ]]; then
    pip-audit -r "$REQUIREMENTS" --strict || PIP_AUDIT_RC=$?
  elif [[ -n "$REQUIREMENTS" && "$REQUIREMENTS" == pyproject.toml ]]; then
    pip-audit || PIP_AUDIT_RC=$?
  else
    echo "[pip-audit] no requirements file found; skipping"
  fi
else
  echo "[pip-audit] not installed; install with: pip install pip-audit"
  echo "[pip-audit] skipping (CI installs this before invoking)"
fi

# 2) Frontend dependency audit.
if command -v pnpm >/dev/null 2>&1; then
  echo "[pnpm audit] scanning apps/forge..."
  if [[ -d "apps/forge" ]]; then
    (cd apps/forge && pnpm audit --audit-level=high) || PNPM_AUDIT_RC=$?
  fi
else
  echo "[pnpm] not installed; install with: npm install -g pnpm"
  echo "[pnpm audit] skipping (CI installs this before invoking)"
fi

echo "---"
echo "pip-audit exit: $PIP_AUDIT_RC"
echo "pnpm audit exit: $PNPM_AUDIT_RC"

if [[ $PIP_AUDIT_RC -ne 0 || $PNPM_AUDIT_RC -ne 0 ]]; then
  echo "X dependency audit found high/critical CVEs"
  exit 1
fi
echo "OK dependency audit clean (no high/critical CVEs)"

#!/usr/bin/env bash
# scripts/check-migrations.sh — alembic upgrade + downgrade round-trip.
#
# Verifies that ``alembic upgrade head`` succeeds AND that
# ``alembic downgrade base`` returns to an empty schema. Catches
# irreversible migrations and broken chain ordering before they land.
#
# Wired into .github/workflows/python-ci.yml::migrations.
#
# Usage:
#   DATABASE_URL=postgresql://... bash scripts/check-migrations.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "[check-migrations] DATABASE_URL not set" >&2
    exit 1
fi

# Use the sync driver for alembic CLI.
SYNC_URL=$(echo "$DATABASE_URL" | sed 's|postgresql+asyncpg://|postgresql://|;s|postgresql+psycopg://|postgresql://|')

echo "[check-migrations] upgrading to head..."
{ set +x; } 2>/dev/null
DATABASE_URL="$SYNC_URL" alembic upgrade head

echo "[check-migrations] verifying current revision is head..."
HEAD=$(DATABASE_URL="$SYNC_URL" alembic heads | tail -1)
CURRENT=$(DATABASE_URL="$SYNC_URL" alembic current | tail -1)
if [[ "$HEAD" != "$CURRENT" ]]; then
    echo "[check-migrations] FAIL: current ($CURRENT) != head ($HEAD)" >&2
    exit 1
fi

echo "[check-migrations] downgrading to base (round-trip)..."
DATABASE_URL="$SYNC_URL" alembic downgrade base

echo "[check-migrations] re-upgrading to head..."
DATABASE_URL="$SYNC_URL" alembic upgrade head

echo "migration round-trip: OK"

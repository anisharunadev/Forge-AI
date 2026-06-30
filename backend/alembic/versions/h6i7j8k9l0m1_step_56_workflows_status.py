"""step_56_workflows_status

Step 56 — Phase 4 Workflows + Runs wiring. Adds:

* workflows.status           — VARCHAR(32) NOT NULL DEFAULT 'draft'

This column was introduced as a runtime in-place ALTER TABLE in the
seeder (scripts/seed_workflows.py). Promoting it to a real migration
ensures production deployments (and any environment that runs only
``alembic upgrade head`` without invoking the seeder) get the column.

Per Rule 2 the table is already tenant-scoped; no policy changes needed.

Revision ID: h6i7j8k9l0m1
Revises: g5h6i7j8k9l0
Create Date: 2026-06-29 12:30:00.000000
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


revision: str = "h6i7j8k9l0m1"
down_revision: Union[str, None] = "g5h6i7j8k9l0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add ``workflows.status`` if it doesn't already exist.

    The seed script also performs this ALTER in-place for older DBs.
    Guard with ``IF NOT EXISTS`` so re-running the migration after the
    in-place patch is a no-op rather than an error.
    """
    op.execute(
        "ALTER TABLE workflows "
        "ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'draft'"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_tenant_project_status "
        "ON workflows (tenant_id, project_id, status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_workflows_tenant_project_status")
    op.execute("ALTER TABLE workflows DROP COLUMN IF EXISTS status")


__all__ = ["upgrade", "downgrade", "revision", "down_revision"]
"""step_93_p8_approval_expiry

Phase 8 SC-8.2 - approval expiry.

Adds ``expires_at`` (timestamp, nullable) to ``ideation_approval_items``
so the approval service can reject decisions on stale items. The
column is nullable for back-compat; existing rows keep ``expires_at =
NULL`` which is treated as "no expiry" until a migration sets a
default SLA window per tenant.

A composite index ``ix_approval_items_status_expires`` is added so
the scheduler job that scans for expired items (``approval_timeout_scan``)
runs efficiently at scale.

Revision ID: step_93_p8_approval_expiry
Revises: step_92_p5_tenant_settings
Create Date: 2026-07-06 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "step_93_p8_approval_expiry"
down_revision: str | None = "step_92_p5_tenant_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ideation_approval_items",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_approval_items_status_expires",
        "ideation_approval_items",
        ["status", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_approval_items_status_expires", table_name="ideation_approval_items")
    op.drop_column("ideation_approval_items", "expires_at")

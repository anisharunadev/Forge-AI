"""step_78_f15_observability

Step 78 — Phase 3 F15 Audit / Health / Compliance: AlertConfig table.

Adds the ``alert_configs`` table that stores per-tenant budget
thresholds (``warn_pct``, ``exceed_pct``) and notification channels
(``email``, ``slack``). The alert engine reads this table on every
budget check; the dashboard writes it via /api/forge/orgs/{id}/alerts.

Schema is tenant-scoped (Rule 2) with a composite index on
``(tenant_id, warn_pct)`` so the most-frequent read path
("firing alerts at warn% or higher") stays a single-index probe.

Revision ID: step_78_f15_observability
Revises: step_78_f14_async
Create Date: 2026-07-02 13:30:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "step_78_f15_observability"
down_revision: Union[str, None] = "step_78_f14_async"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "alert_configs",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("warn_pct", sa.Integer(), nullable=False, server_default="80"),
        sa.Column("exceed_pct", sa.Integer(), nullable=False, server_default="95"),
        sa.Column("channels", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", name="uq_alert_configs_tenant"),
    )
    op.create_index(
        "ix_alert_configs_tenant_warn", "alert_configs", ["tenant_id", "warn_pct"]
    )


def downgrade() -> None:
    op.drop_index("ix_alert_configs_tenant_warn", table_name="alert_configs")
    op.drop_table("alert_configs")
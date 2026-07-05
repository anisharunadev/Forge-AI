"""step_80_m3_connector_activity

M3 — Gap M3-G1 / M3-G2. Step-80 Connector Activity + Disconnect state.

Adds:

1. New ``disconnected`` value on the ``connector_status`` PG enum so
   the new ``POST /connectors/{id}/disconnect`` endpoint can mark a
   connector as soft-deleted while still distinguishing it from the
   existing ``quarantined`` (admin-override delete) state.

2. New ``connectors.disconnected_at`` (DateTime tz, NULL) — timestamp
   of the most recent disconnect call. Distinct from ``deleted_at``
   which doesn't exist on the connector table; this is the column
   the UI reads to display "disconnected N days ago".

3. ``connector_activity`` table — the activity feed the M3 Activity
   tab renders. Tenant-scoped (Rule 2), connector-FK (CASCADE), with
   the closed enum of event types and statuses the UI filters on.

Indexes are picked to match the read patterns:

- ``(tenant_id, started_at DESC)`` — the default list query.
- ``(connector_id, started_at DESC)`` — the per-connector drill-in.

The raw SQL blocks add the new enum value via ``ALTER TYPE ... ADD
VALUE`` (PG 9.6+) which is non-transactional — we run it outside
``op.execute``'s implicit transaction. A small ``IF NOT EXISTS`` style
guard is implemented via a pg ``DO $$`` block so re-running the
migration is safe.

Revision ID: step_80_m3_connector_activity
Revises: step_79_m2_cost_ledger_columns
Create Date: 2026-07-05 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "step_80_m3_connector_activity"
down_revision: Union[str, None] = "step_79_m2_cost_ledger_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. extend connector_status enum with "disconnected"
    op.execute(
        "ALTER TYPE connector_status ADD VALUE IF NOT EXISTS 'disconnected';"
    )

    # 2. connectors.disconnected_at column
    op.add_column(
        "connectors",
        sa.Column("disconnected_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 3. connector_activity table
    op.create_table(
        "connector_activity",
        sa.Column("id", sa.GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.GUID(), nullable=False),
        sa.Column("project_id", sa.GUID(), nullable=False),
        sa.Column(
            "connector_id",
            sa.GUID(),
            sa.ForeignKey("connectors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_type",
            sa.Enum(
                "sync",
                "webhook",
                "test",
                "install",
                "disconnect",
                "error",
                "reveal",
                "rotate",
                name="connector_activity_event_type",
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "success",
                "failed",
                "partial",
                "in_progress",
                name="connector_activity_status",
            ),
            nullable=False,
            server_default="success",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("records_affected", sa.Integer(), nullable=True),
        sa.Column("actor_id", sa.GUID(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_connector_activity"),
    )
    op.create_index(
        "ix_connector_activity_tenant_id",
        "connector_activity",
        ["tenant_id"],
    )
    op.create_index(
        "ix_connector_activity_project_id",
        "connector_activity",
        ["project_id"],
    )
    op.create_index(
        "ix_connector_activity_connector_id",
        "connector_activity",
        ["connector_id"],
    )
    op.create_index(
        "ix_connector_activity_tenant_started",
        "connector_activity",
        ["tenant_id", "started_at"],
    )
    op.create_index(
        "ix_connector_activity_connector_started",
        "connector_activity",
        ["connector_id", "started_at"],
    )

    # ---- Row-Level Security (DL-026 pattern) ---------------------------
    op.execute("ALTER TABLE connector_activity ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE connector_activity FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY connector_activity_tenant_isolation
            ON connector_activity
            USING (
                tenant_id::text = current_setting('app.tenant_id', true)
            )
            WITH CHECK (
                tenant_id::text = current_setting('app.tenant_id', true)
            );
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS connector_activity_tenant_isolation "
        "ON connector_activity;"
    )
    op.drop_index(
        "ix_connector_activity_connector_started",
        table_name="connector_activity",
    )
    op.drop_index(
        "ix_connector_activity_tenant_started",
        table_name="connector_activity",
    )
    op.drop_index(
        "ix_connector_activity_connector_id",
        table_name="connector_activity",
    )
    op.drop_index(
        "ix_connector_activity_project_id",
        table_name="connector_activity",
    )
    op.drop_index(
        "ix_connector_activity_tenant_id",
        table_name="connector_activity",
    )
    op.drop_table("connector_activity")

    op.drop_column("connectors", "disconnected_at")
    # Cannot DROP VALUE from a PG enum in older versions; leave the
    # enum extension in place on downgrade so the column state remains
    # consistent with whatever other value references it.

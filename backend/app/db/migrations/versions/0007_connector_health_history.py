"""connector_health_history + Connector healthcheck columns (Pillar 1 — Phase 4).

Adds:
- ``connectors.last_healthcheck_at`` (DateTime tz, NULL) — timestamp of the
  most recent reachability probe. Distinct from ``last_sync_at`` (which
  records a successful data pull); a healthcheck is a lightweight,
  non-destructive probe.
- ``connectors.last_healthcheck_status`` (String 32, NULL) — short string
  describing the most recent probe outcome (e.g. ``"ok"`` / ``"unreachable"``).

Plus a new append-only history table:
- ``connector_health_history`` — one row per probe. Backs the Connector
  Center "last N healthchecks" surface and lets the alerting layer
  threshold on a rolling window without re-running probes.

The probe result shape mirrors :class:`app.services.connector_manager.TestResult`
so the connector-lifecycle service can write history rows with no
shape translation.

Revision ID: 0007_connector_health_history
Revises: 0006_ideation_ingest_runs
Create Date: 2026-06-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0007_connector_health_history"
down_revision = "0006_ideation_ingest_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add healthcheck columns + history table + RLS."""
    op.add_column(
        "connectors",
        sa.Column("last_healthcheck_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "connectors",
        sa.Column(
            "last_healthcheck_status",
            sa.String(length=32),
            nullable=True,
        ),
    )

    op.create_table(
        "connector_health_history",
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
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_connector_health_history"),
    )
    op.create_index(
        "ix_connector_health_history_tenant_id",
        "connector_health_history",
        ["tenant_id"],
    )
    op.create_index(
        "ix_connector_health_history_project_id",
        "connector_health_history",
        ["project_id"],
    )
    op.create_index(
        "ix_connector_health_history_connector_id",
        "connector_health_history",
        ["connector_id"],
    )
    op.create_index(
        "ix_connector_health_history_connector_checked",
        "connector_health_history",
        ["connector_id", "checked_at"],
    )

    # ---- Row-Level Security (DL-026 pattern) ----------------------------
    op.execute("ALTER TABLE connector_health_history ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE connector_health_history FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY connector_health_history_tenant_isolation
            ON connector_health_history
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
        "DROP POLICY IF EXISTS connector_health_history_tenant_isolation "
        "ON connector_health_history;"
    )
    op.drop_index(
        "ix_connector_health_history_connector_checked",
        table_name="connector_health_history",
    )
    op.drop_index(
        "ix_connector_health_history_connector_id",
        table_name="connector_health_history",
    )
    op.drop_index(
        "ix_connector_health_history_project_id",
        table_name="connector_health_history",
    )
    op.drop_index(
        "ix_connector_health_history_tenant_id",
        table_name="connector_health_history",
    )
    op.drop_table("connector_health_history")

    op.drop_column("connectors", "last_healthcheck_status")
    op.drop_column("connectors", "last_healthcheck_at")

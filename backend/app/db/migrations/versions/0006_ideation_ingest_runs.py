"""ideation_ingest_runs table (Pillar 1 — Phase 3 — daily ingest observability).

One row per daily ideation ingest run. The dashboard indicator
("Last daily ingest: N new ideas") reads from this table. The
``degraded_budget`` flag surfaces when the $0.50 ceiling tripped
and the heuristic fallback path was used instead of LLM clustering.

Revision ID: 0006_ideation_ingest_runs
Revises: 0005_persona_memory_history
Create Date: 2026-06-22
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0006_ideation_ingest_runs"
down_revision = "0005_persona_memory_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the ``ideation_ingest_runs`` table + indexes + RLS."""
    op.create_table(
        "ideation_ingest_runs",
        sa.Column("id", sa.GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.GUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("signals_seen", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ideas_created", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="running"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "degraded_budget",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ideation_ingest_runs"),
    )
    op.create_index(
        "ix_ideation_ingest_runs_tenant_id",
        "ideation_ingest_runs",
        ["tenant_id"],
    )
    op.create_index(
        "ix_ideation_ingest_runs_tenant_started",
        "ideation_ingest_runs",
        ["tenant_id", "started_at"],
    )

    # ---- Row-Level Security (DL-026 pattern) ----------------------------
    op.execute("ALTER TABLE ideation_ingest_runs ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE ideation_ingest_runs FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY ideation_ingest_runs_tenant_isolation
            ON ideation_ingest_runs
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
        "DROP POLICY IF EXISTS ideation_ingest_runs_tenant_isolation ON ideation_ingest_runs;"
    )
    op.drop_index("ix_ideation_ingest_runs_tenant_started", table_name="ideation_ingest_runs")
    op.drop_index("ix_ideation_ingest_runs_tenant_id", table_name="ideation_ingest_runs")
    op.drop_table("ideation_ingest_runs")

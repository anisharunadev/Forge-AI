"""ideation_source_signals table (Pillar 1 — Phase 3 — daily ingest).

Stores raw signals ingested from external sources (Confluence,
Zendesk, Slack) before synthesis into Ideas. The unique constraint
on ``(tenant_id, source, external_id)`` makes idempotent ingestion
trivial — pullers use ``INSERT ... ON CONFLICT DO NOTHING``.

Revision ID: 0004_ideation_source_signals
Revises: 0003_idea_analysis_editor_note
Create Date: 2026-06-22
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0004_ideation_source_signals"
down_revision = "0003_idea_analysis_editor_note"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the ``ideation_source_signals`` table + indexes + RLS."""
    op.create_table(
        "ideation_source_signals",
        sa.Column("id", sa.GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.GUID(), nullable=False),
        sa.Column("project_id", sa.GUID(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "idea_id",
            sa.GUID(),
            sa.ForeignKey("ideas.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ideation_source_signals"),
        sa.UniqueConstraint(
            "tenant_id",
            "source",
            "external_id",
            name="uq_ideation_source_signals_tenant_source_external",
        ),
    )
    op.create_index(
        "ix_ideation_source_signals_tenant_id",
        "ideation_source_signals",
        ["tenant_id"],
    )
    op.create_index(
        "ix_ideation_source_signals_tenant_source",
        "ideation_source_signals",
        ["tenant_id", "source"],
    )
    op.create_index(
        "ix_ideation_source_signals_idea_id",
        "ideation_source_signals",
        ["idea_id"],
    )
    op.create_index(
        "ix_ideation_source_signals_tenant_idea_id",
        "ideation_source_signals",
        ["tenant_id", "idea_id"],
    )

    # ---- Row-Level Security (DL-026 pattern) ----------------------------
    op.execute("ALTER TABLE ideation_source_signals ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE ideation_source_signals FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY ideation_source_signals_tenant_isolation
            ON ideation_source_signals
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
        "DROP POLICY IF EXISTS ideation_source_signals_tenant_isolation ON ideation_source_signals;"
    )
    op.drop_index("ix_ideation_source_signals_tenant_idea_id", table_name="ideation_source_signals")
    op.drop_index("ix_ideation_source_signals_idea_id", table_name="ideation_source_signals")
    op.drop_index("ix_ideation_source_signals_tenant_source", table_name="ideation_source_signals")
    op.drop_index("ix_ideation_source_signals_tenant_id", table_name="ideation_source_signals")
    op.drop_table("ideation_source_signals")

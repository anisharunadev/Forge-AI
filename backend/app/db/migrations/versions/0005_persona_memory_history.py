"""persona_memory_history table (Pillar 1 — Phase 3 — persona memory).

Append-only log of every persona memory edit. The nightly
``memory_consolidate`` job rolls rows from the past 24h into the
stable per-tenant file under
``tenants/<slug>/workspace/memory/personas/<persona>/<key>.md``.

Persona memory is **tenant-scoped only** (no project_id) — it's
Organization Knowledge shared across all projects in a tenant for
users with the same persona (Rule 5).

Revision ID: 0005_persona_memory_history
Revises: 0004_ideation_source_signals
Create Date: 2026-06-22
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0005_persona_memory_history"
down_revision = "0004_ideation_source_signals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the ``persona_memory_history`` table + indexes + RLS."""
    op.create_table(
        "persona_memory_history",
        sa.Column("id", sa.GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.GUID(), nullable=False),
        sa.Column("persona", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("entry_md", sa.Text(), nullable=False),
        sa.Column("written_by", sa.GUID(), nullable=False),
        sa.Column("written_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "consolidated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_persona_memory_history"),
    )
    op.create_index(
        "ix_persona_memory_history_tenant_id",
        "persona_memory_history",
        ["tenant_id"],
    )
    op.create_index(
        "ix_persona_memory_history_tenant_persona_key",
        "persona_memory_history",
        ["tenant_id", "persona", "key"],
    )
    op.create_index(
        "ix_persona_memory_history_tenant_written_at",
        "persona_memory_history",
        ["tenant_id", "written_at"],
    )

    # ---- Row-Level Security (DL-026 pattern) ----------------------------
    op.execute("ALTER TABLE persona_memory_history ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE persona_memory_history FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY persona_memory_history_tenant_isolation
            ON persona_memory_history
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
        "DROP POLICY IF EXISTS persona_memory_history_tenant_isolation ON persona_memory_history;"
    )
    op.drop_index(
        "ix_persona_memory_history_tenant_written_at", table_name="persona_memory_history"
    )
    op.drop_index(
        "ix_persona_memory_history_tenant_persona_key", table_name="persona_memory_history"
    )
    op.drop_index("ix_persona_memory_history_tenant_id", table_name="persona_memory_history")
    op.drop_table("persona_memory_history")

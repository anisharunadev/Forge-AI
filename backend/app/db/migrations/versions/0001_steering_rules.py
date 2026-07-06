"""steering_rules table (F-504).

Auto-discovered agent steering rules, indexed from Markdown files under
the workspace. Each row carries tenant_id + project_id (Rule 2) and is
RLS-enforced.

Revision ID: 0001_steering_rules
Revises:
Create Date: 2026-06-22
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_steering_rules"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the ``steering_rules`` table.

    The ``projects`` table is assumed to exist (referenced by FK);
    the migration is orderable after the projects migration in the
    real world, but for now this is the initial revision.
    """
    op.create_table(
        "steering_rules",
        sa.Column("id", sa.GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.GUID(), nullable=False),
        sa.Column(
            "project_id",
            sa.GUID(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rule_id", sa.String(length=200), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "scope",
            sa.String(length=64),
            nullable=False,
            server_default="project",
        ),
        sa.Column(
            "applies_to_stages",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_steering_rules"),
        sa.UniqueConstraint(
            "tenant_id",
            "project_id",
            "rule_id",
            name="uq_steering_rules_tenant_project_rule",
        ),
    )
    op.create_index(
        "ix_steering_rules_tenant_id",
        "steering_rules",
        ["tenant_id"],
    )
    op.create_index(
        "ix_steering_rules_project_id",
        "steering_rules",
        ["project_id"],
    )
    op.create_index(
        "ix_steering_rules_rule_id",
        "steering_rules",
        ["rule_id"],
    )
    op.create_index(
        "ix_steering_rules_tenant_project_path",
        "steering_rules",
        ["tenant_id", "project_id", "file_path"],
    )

    # ---- Row-Level Security (DL-026 pattern) ----------------------------
    op.execute("ALTER TABLE steering_rules ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE steering_rules FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY steering_rules_tenant_isolation
            ON steering_rules
            USING (
                tenant_id::text = current_setting('app.tenant_id', true)
            )
            WITH CHECK (
                tenant_id::text = current_setting('app.tenant_id', true)
            );
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS steering_rules_tenant_isolation ON steering_rules;")
    op.drop_index("ix_steering_rules_tenant_project_path", table_name="steering_rules")
    op.drop_index("ix_steering_rules_rule_id", table_name="steering_rules")
    op.drop_index("ix_steering_rules_project_id", table_name="steering_rules")
    op.drop_index("ix_steering_rules_tenant_id", table_name="steering_rules")
    op.drop_table("steering_rules")

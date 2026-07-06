"""step_77_p0_litellm_guardrail_assignments

Step 77 — Phase 2 P0 unblocker: create the missing
``litellm_guardrail_assignments`` mirror table that
:mod:`app.integrations.litellm.guardrail_sync` imports (F-829d).

The F-829 migration (``c3d4e5f6a7b8``) created 5 Phase 1 tables but
this one was deferred and the ORM model was never written — the
import in ``guardrail_sync.py:114`` was the broken link that
prevented any Steward UI guardrail write from succeeding. This
migration lands the table + composite index + RLS policy so the
import resolves and the Steward can persist assignments.

Schema is tenant-scoped (Rule 2) with a composite index on
``(tenant_id, project_id)`` matching the read pattern in
``GuardrailSync.get_for_tenant``.

Revision ID: step_77_p0_litellm_guardrail_assignments
Revises: step_78_f12_rbac_hierarchy
Create Date: 2026-07-02 14:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_77_p0_litellm_guardrail_assignments"
down_revision: str | None = "step_78_f12_rbac_hierarchy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enable_rls(table_name: str) -> None:
    """Standard RLS block used by every tenant-scoped table (DL-026)."""
    op.execute(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY;')
    op.execute(f'ALTER TABLE "{table_name}" FORCE ROW LEVEL SECURITY;')
    op.execute(
        f"""
        CREATE POLICY "{table_name}_tenant_isolation"
            ON "{table_name}"
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
        """
    )


def upgrade() -> None:
    op.create_table(
        "litellm_guardrail_assignments",
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("litellm_team_id", sa.String(length=128), nullable=False),
        sa.Column(
            "guardrail_ids",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("assigned_by", sa.String(length=128), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_litellm_guardrail_assignments")),
    )
    op.create_index(
        op.f("ix_litellm_guardrail_assignments_tenant_id"),
        "litellm_guardrail_assignments",
        ["tenant_id"],
    )
    op.create_index(
        op.f("ix_litellm_guardrail_assignments_project_id"),
        "litellm_guardrail_assignments",
        ["project_id"],
    )
    op.create_index(
        op.f("ix_litellm_guardrail_assignments_litellm_team_id"),
        "litellm_guardrail_assignments",
        ["litellm_team_id"],
    )
    op.create_index(
        "ix_litellm_guardrail_assignments_tenant_project",
        "litellm_guardrail_assignments",
        ["tenant_id", "project_id"],
    )
    _enable_rls("litellm_guardrail_assignments")


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS litellm_guardrail_assignments_tenant_isolation "
        "ON litellm_guardrail_assignments;"
    )
    op.drop_index(
        "ix_litellm_guardrail_assignments_tenant_project",
        table_name="litellm_guardrail_assignments",
    )
    op.drop_index(
        op.f("ix_litellm_guardrail_assignments_litellm_team_id"),
        table_name="litellm_guardrail_assignments",
    )
    op.drop_index(
        op.f("ix_litellm_guardrail_assignments_project_id"),
        table_name="litellm_guardrail_assignments",
    )
    op.drop_index(
        op.f("ix_litellm_guardrail_assignments_tenant_id"),
        table_name="litellm_guardrail_assignments",
    )
    op.drop_table("litellm_guardrail_assignments")

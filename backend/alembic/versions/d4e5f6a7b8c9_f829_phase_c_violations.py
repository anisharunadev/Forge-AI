"""f829_phase_c_violations

F-829 — Phase C compliance feed. Creates the
``litellm_guardrail_violations`` table (F-829i) with RLS enabled.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-25 12:30:00.000000
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.base import GUID  # noqa: E402

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enable_rls(table_name: str) -> None:
    """Standard RLS block used by every tenant-scoped table (DL-026).

    Mirrors ``c3d4e5f6a7b8_f829_litellm_integration_tables.py``.
    """
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
    # ---- litellm_guardrail_violations --------------------------------
    op.create_table(
        "litellm_guardrail_violations",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("litellm_team_id", sa.String(length=128), nullable=False),
        sa.Column("guardrail_id", sa.String(length=128), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("action_taken", sa.String(length=16), nullable=False),
        sa.Column("sanitized_content", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "resolved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "metadata",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", GUID(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_litellm_guardrail_violations")),
    )
    op.create_index(
        op.f("ix_litellm_guardrail_violations_tenant_id"),
        "litellm_guardrail_violations",
        ["tenant_id"],
    )
    op.create_index(
        op.f("ix_litellm_guardrail_violations_project_id"),
        "litellm_guardrail_violations",
        ["project_id"],
    )
    op.create_index(
        op.f("ix_litellm_guardrail_violations_litellm_team_id"),
        "litellm_guardrail_violations",
        ["litellm_team_id"],
    )
    op.create_index(
        op.f("ix_litellm_guardrail_violations_guardrail_id"),
        "litellm_guardrail_violations",
        ["guardrail_id"],
    )
    op.create_index(
        op.f("ix_litellm_guardrail_violations_severity"),
        "litellm_guardrail_violations",
        ["severity"],
    )
    op.create_index(
        op.f("ix_litellm_guardrail_violations_resolved"),
        "litellm_guardrail_violations",
        ["resolved"],
    )
    op.create_index(
        op.f("ix_litellm_guardrail_violations_occurred_at"),
        "litellm_guardrail_violations",
        ["occurred_at"],
    )
    op.create_index(
        "ix_litellm_guardrail_violations_tenant_occurred",
        "litellm_guardrail_violations",
        ["tenant_id", "occurred_at"],
    )
    op.create_index(
        "ix_litellm_guardrail_violations_tenant_severity",
        "litellm_guardrail_violations",
        ["tenant_id", "severity"],
    )
    _enable_rls("litellm_guardrail_violations")


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS litellm_guardrail_violations_tenant_isolation "
        "ON litellm_guardrail_violations;"
    )
    op.drop_table("litellm_guardrail_violations")

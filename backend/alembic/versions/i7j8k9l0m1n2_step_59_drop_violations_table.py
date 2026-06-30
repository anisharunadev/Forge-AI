"""step_59_drop_violations_table

Step-59 — Real LiteLLM proxy wiring. The local
``litellm_guardrail_violations`` table (F-829i) is no longer
populated by any service; violations are now derived from
LiteLLM ``/spend/logs`` on demand. Drop the table, its indexes,
and the RLS policy that guarded it.

Revision ID: i7j8k9l0m1n2
Revises: h6i7j8k9l0m1
Create Date: 2026-06-29 12:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "i7j8k9l0m1n2"
down_revision: Union[str, None] = "h6i7j8k9l0m1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the RLS policy first (it depends on the table).
    op.execute(
        "DROP POLICY IF EXISTS litellm_guardrail_violations_tenant_isolation "
        "ON litellm_guardrail_violations;"
    )
    # Alembic drops the indexes automatically when the table is dropped.
    op.drop_table("litellm_guardrail_violations")


def downgrade() -> None:
    # Reverse path: recreate the table so the downgrade is reversible.
    # Mirrors d4e5f6a7b8c9_f829_phase_c_violations.py without re-enabling RLS.
    op.create_table(
        "litellm_guardrail_violations",
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("litellm_team_id", sa.String(length=128), nullable=False),
        sa.Column("guardrail_id", sa.String(length=128), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("action_taken", sa.String(length=16), nullable=False),
        sa.Column("sanitized_content", sa.Text(), nullable=False, server_default=""),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("metadata", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_litellm_guardrail_violations")),
    )

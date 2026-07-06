"""step_75_p3_spend_records

Step 75 — Phase 1 LiteLLM gateway: Spend Aggregation write-path.

Adds the ``spend_records`` table that the SSE cost meter writes to on
every chat-completion, and that the daily reconciliation job reads from
when it pulls LiteLLM ``/spend/logs`` (idempotent on ``litellm_request_id``).

Schema is tenant-scoped (Rule 2) with composite indexes matching the two
read paths:

* ``(tenant_id, project_id, created_at desc)`` — per-project cost meter
* ``(tenant_id, created_at desc)``           — tenant-wide cost meter

``litellm_request_id`` carries a unique constraint so the reconciliation
worker can ``INSERT … ON CONFLICT DO NOTHING`` without dedup logic in
the application layer.

Revision ID: step_75_p3_spend_records_001
Revises: l2m3n4o5p6q7
Create Date: 2026-07-02 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_75_p3_spend_records_001"
down_revision: str | None = "l2m3n4o5p6q7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spend_records",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "team_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column("total_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False),
        sa.Column("litellm_request_id", sa.Text(), nullable=False),
        sa.Column("reconciled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("litellm_request_id", name="uq_spend_records_litellm_request_id"),
    )
    op.create_index(
        "ix_spend_records_tenant_project_created",
        "spend_records",
        ["tenant_id", "project_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_spend_records_tenant_created",
        "spend_records",
        ["tenant_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_spend_records_tenant_created", table_name="spend_records")
    op.drop_index("ix_spend_records_tenant_project_created", table_name="spend_records")
    op.drop_table("spend_records")


__all__ = ["upgrade", "downgrade", "revision", "down_revision"]

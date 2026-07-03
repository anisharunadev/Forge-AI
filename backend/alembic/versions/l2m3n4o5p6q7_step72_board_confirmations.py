"""step72_board_confirmations

Step-72 — Phase 11 Governance + Audit. Persist board-level confirmations
so the Governance Center can list/ack real data instead of the
orchestrator-stub fixture.

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-07-01 12:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "l2m3n4o5p6q7"
down_revision: Union[str, None] = "k1l2m3n4o5p6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "board_confirmations",
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("subject_id", sa.String(length=128), nullable=False),
        sa.Column("plan_rev", sa.String(length=64), nullable=False),
        sa.Column(
            "outcome",
            sa.Enum(
                "pending",
                "accepted",
                "declined",
                name="board_confirmation_outcome",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("decider_id", sa.String(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column(
            "payload",
            sa.JSON().with_variant(
                sa.dialects.postgresql.JSONB(), "postgresql"
            ),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_board_confirmations")),
        sa.UniqueConstraint(
            "tenant_id",
            "idempotency_key",
            name=op.f("uq_board_conf_tenant_idempotency"),
        ),
    )
    op.create_index(
        op.f("ix_board_conf_tenant_project_decided"),
        "board_confirmations",
        ["tenant_id", "project_id", "decided_at"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_board_conf_tenant_project_decided"),
        table_name="board_confirmations",
    )
    op.drop_table("board_confirmations")
    op.execute("DROP TYPE IF EXISTS board_confirmation_outcome")
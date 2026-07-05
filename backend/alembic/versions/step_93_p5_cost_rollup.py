"""step_93_p5_cost_rollup

Phase 5 -- Observability & SLOs.

Adds the ``cost_minute_rollup`` table populated by the
``cost_aggregate`` scheduler job. One row per (tenant, minute)
with the sum of spend and request count from LiteLLM spend logs.

The unique constraint on ``(tenant_id, minute)`` is what the
aggregator relies on for ``ON CONFLICT DO UPDATE``.

Revision ID: step_93_p5_cost_rollup
Revises: step_92_p5_tenant_settings
Create Date: 2026-07-06 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_93_p5_cost_rollup"
down_revision: str | None = "step_92_p5_tenant_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        uuid_type = postgresql.UUID(as_uuid=True)
    else:  # pragma: no cover -- sqlite/test path
        uuid_type = sa.String(length=36)

    op.create_table(
        "cost_minute_rollup",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("tenant_id", uuid_type, nullable=False),
        sa.Column("minute", sa.DateTime(timezone=True), nullable=False),
        sa.Column("spend_usd", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("request_count", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("tenant_id", "minute", name="uq_cost_rollup_tenant_id"),
    )
    op.create_index(
        "ix_cost_minute_rollup_tenant_id",
        "cost_minute_rollup",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_cost_minute_rollup_tenant_id", table_name="cost_minute_rollup")
    op.drop_table("cost_minute_rollup")


__all__ = [
    "upgrade",
    "downgrade",
    "revision",
    "down_revision",
]

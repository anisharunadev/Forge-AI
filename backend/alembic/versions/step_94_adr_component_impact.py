"""step_94_adr_component_impact

Day 1 mock-removal track A: ADR enrichment columns needed by the
frontend ``ADRWithMeta`` projection in the Architecture Center.

- ``component``: ADRComponent['id'] (backend / frontend / infra / data /
  security / mobile / ml)
- ``impact``: 1-10 ordinal mirroring the seed ``ADR_IMPACT_BY_NUMBER``
  scale

Both nullable so existing rows are unaffected; backfilled with safe
defaults so the columns behave as populated before the next seed run.

Revision ID: step_94_adr_component_impact
Revises: step_93_p8_approval_expiry
Create Date: 2026-07-07 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "step_94_adr_component_impact"
down_revision: str | None = "step_93_p8_approval_expiry"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "architecture_adrs",
        sa.Column("component", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "architecture_adrs",
        sa.Column("impact", sa.Integer(), nullable=True),
    )
    # ponytail: existing rows get safe defaults so the columns are not
    # NULL for the frontend projection before the next seed run.
    op.execute("UPDATE architecture_adrs SET component = 'backend' WHERE component IS NULL")
    op.execute("UPDATE architecture_adrs SET impact = 5 WHERE impact IS NULL")


def downgrade() -> None:
    op.drop_column("architecture_adrs", "impact")
    op.drop_column("architecture_adrs", "component")

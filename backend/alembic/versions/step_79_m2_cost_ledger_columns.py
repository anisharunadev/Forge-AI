"""step_79_m2_cost_ledger_columns

M2 ADR-009 (Track B T-B2) — cost_ledger projected/actual split.

Adds three columns to the ``cost_entries`` table (the physical name
of the ``cost_ledger`` per ADR-009):

- ``run_id`` (UUID, nullable) — binds the row to the SDLC run so
  the cumulative-cap rule can sum confirmed spend per run.
- ``agent`` (string(128), nullable) — names the agent that
  incurred the spend. Nullable so terminal / manual rows continue
  to insert cleanly.
- ``projected`` (boolean, NOT NULL, default False) — distinguishes
  a pre-call projection from a post-call actual settlement. The
  cumulative cap rule filters on ``projected = False`` so
  over-reserved headroom never silently consumes the budget.

A composite index ``ix_cost_run_projected`` is added so the
``sum(cost_usd WHERE run_id=X AND projected=False)`` query plan is
constant-time regardless of ledger size.

Schema is tenant-scoped (Rule 2). Backfill is intentionally absent
— projections are not retroactive, and existing rows get
``projected=False`` via the column default so the cumulative cap
rule treats them as confirmed spend if/when ``run_id`` is
back-populated later by an out-of-band job (not in M2 scope).

Revision ID: step_79_m2_cost_ledger_columns
Revises: step_78_f12_rbac_hierarchy
Create Date: 2026-07-04 18:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_79_m2_cost_ledger_columns"
down_revision: str | None = "step_78_f12_rbac_hierarchy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three ADR-009 columns + composite index."""
    op.add_column(
        "cost_entries",
        sa.Column("run_id", sa.GUID(), nullable=True),
    )
    op.add_column(
        "cost_entries",
        sa.Column("agent", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "cost_entries",
        sa.Column(
            "projected",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_cost_run_projected",
        "cost_entries",
        ["run_id", "projected"],
        unique=False,
    )


def downgrade() -> None:
    """Reverse the M2 ADR-009 additions.

    Drops the composite index before the columns to keep the
    downgrade symmetric with the upgrade.
    """
    op.drop_index("ix_cost_run_projected", table_name="cost_entries")
    op.drop_column("cost_entries", "projected")
    op.drop_column("cost_entries", "agent")
    op.drop_column("cost_entries", "run_id")
"""step_92_m10_copilot_typing

M10 — Co-pilot (gap M10-G5).

Adds the ``typing_indicator`` boolean column to ``copilot_messages`` so
the streaming chat path can advertise the in-flight state of an
assistant message. The Co-pilot service flips the flag ``True`` when a
placeholder row is inserted before the LLM call and ``False`` on the
terminal ``done`` event. Non-streaming ``chat()`` always persists with
the default ``False``.

The column is non-nullable with a server default of ``false`` so the
DDL is backward-compatible — pre-M10 rows get ``False`` on backfill
implicitly.

Revision ID: step_92_m10_copilot_typing
Revises: step_91_m7_audit_chain_ref
Create Date: 2026-07-06 02:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_92_m10_copilot_typing"
down_revision: str | None = "step_91_m7_audit_chain_ref"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "copilot_messages",
        sa.Column(
            "typing_indicator",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("copilot_messages", "typing_indicator")


__all__ = [
    "upgrade",
    "downgrade",
    "revision",
    "down_revision",
]

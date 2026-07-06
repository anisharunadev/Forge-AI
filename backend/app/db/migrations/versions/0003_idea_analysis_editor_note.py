"""idea_analyses.editor_note (Pillar 1 — Phase 2 — PM validation wire).

Adds a nullable ``editor_note`` TEXT column on ``idea_analyses`` so the
PM-driven Enhance flow can stamp the human feedback that triggered the
re-analysis. The column is purely informational — the LLM prompt
builder reads it via the service layer, not via SQL — and intentionally
NOT indexed because:

1. There is at most a handful of analyses per idea, so a sequential
   scan is fine.
2. The column is large (up to 2_000 chars per the API schema) so an
   index would bloat the table.

Revision ID: 0003_idea_analysis_editor_note
Revises: 0002_ideation_external_key
Create Date: 2026-06-22
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0003_idea_analysis_editor_note"
down_revision = "0002_ideation_external_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the editor_note TEXT NULL column. No index (see header)."""
    op.add_column(
        "idea_analyses",
        sa.Column("editor_note", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("idea_analyses", "editor_note")

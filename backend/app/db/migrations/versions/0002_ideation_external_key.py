"""ideation external_key + push_records jira_epic_key (Pillar 1 — Phase 1).

Adds:
- ``ideas.external_key TEXT NULL`` — the upstream system key (Jira issue
  key like ``FORA-1234``) once a push has created the issue. Idempotent
  ingestion of ``jira.issue.observed`` events uses this column as the
  natural key.
- ``push_records.jira_epic_key TEXT NULL`` — the issue key of the Jira
  epic created by the push, written by ``JiraPushService`` so the UI
  history view can deep-link to the epic.

Both columns are indexed for the hot read paths. The existing tables
already carry tenant isolation via the application-layer
``ConnectorManager``/``IdeaIntakeService`` filters and (where applicable)
RLS in earlier migration chains — this migration is intentionally
minimal and does not introduce new RLS policies.

Revision ID: 0002_ideation_external_key
Revises: 0001_steering_rules
Create Date: 2026-06-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0002_ideation_external_key"
down_revision = "0001_steering_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add nullable external_key + jira_epic_key columns and indexes."""
    op.add_column(
        "ideas",
        sa.Column("external_key", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_ideas_tenant_external_key",
        "ideas",
        ["tenant_id", "external_key"],
        unique=False,
    )
    op.create_index(
        "ix_ideas_external_key",
        "ideas",
        ["external_key"],
        unique=False,
    )

    op.add_column(
        "ideation_push_records",
        sa.Column("jira_epic_key", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_push_records_jira_epic_key",
        "ideation_push_records",
        ["jira_epic_key"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_push_records_jira_epic_key", table_name="ideation_push_records")
    op.drop_column("ideation_push_records", "jira_epic_key")

    op.drop_index("ix_ideas_external_key", table_name="ideas")
    op.drop_index("ix_ideas_tenant_external_key", table_name="ideas")
    op.drop_column("ideas", "external_key")

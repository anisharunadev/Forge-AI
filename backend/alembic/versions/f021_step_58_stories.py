"""step_58_stories_sprints_epics

Step 58 — Phase 7 Stories wiring. Adds four tenant-scoped tables:

* stories         — Story aggregate root (kanban cards, status, priority, estimate)
* sprints         — Time-boxed sprint buckets that own stories
* epics           — Cross-sprint initiative buckets that own stories
* story_comments  — Discussion thread attached to a story

Per Rule 2 every row carries ``tenant_id`` and ``project_id``.
Per DL-026 every table has RLS enabled + tenant_isolation policy.

Revision ID: f021a8b9c0d1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-27 19:50:00.000000
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.base import GUID, JSONB  # noqa: E402


# revision identifiers, used by Alembic.
revision: str = "f021a8b9c0d1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table_name: str) -> None:
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
    story_status = sa.Enum(
        "BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "QA", "DONE", "BLOCKED",
        name="story_status",
    )
    story_priority = sa.Enum("P0", "P1", "P2", "P3", name="story_priority")
    story_estimate = sa.Enum("XS", "S", "M", "L", "XL", name="story_estimate")
    story_source = sa.Enum(
        "MANUAL", "JIRA", "GITHUB", "LINEAR", "IDEATION", "PRD", "AUTO",
        name="story_source",
    )
    jira_sync = sa.Enum(
        "SYNCED", "PENDING", "CONFLICT", "FAILED", "DISCONNECTED",
        name="story_jira_sync_status",
    )
    sprint_status = sa.Enum("PLANNING", "ACTIVE", "COMPLETED", name="sprint_status")
    epic_status = sa.Enum(
        "PLANNING", "IN_PROGRESS", "ON_TRACK", "AT_RISK", "BLOCKED", "COMPLETED",
        name="epic_status",
    )

    # ---- stories -----------------------------------------------------
    op.create_table(
        "stories",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("epic_id", GUID(), nullable=True),
        sa.Column("sprint_id", GUID(), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("acceptance_criteria", JSONB, nullable=False, server_default="[]"),
        sa.Column("subtasks", JSONB, nullable=False, server_default="[]"),
        sa.Column("status", story_status, nullable=False, server_default="BACKLOG"),
        sa.Column("priority", story_priority, nullable=False, server_default="P2"),
        sa.Column("estimate", story_estimate, nullable=False, server_default="M"),
        sa.Column("labels", JSONB, nullable=False, server_default="[]"),
        sa.Column("assignee_id", GUID(), nullable=True),
        sa.Column("reporter_id", GUID(), nullable=False),
        sa.Column("jira_key", sa.String(length=64), nullable=True),
        sa.Column("jira_url", sa.Text(), nullable=True),
        sa.Column("jira_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "jira_sync_status", jira_sync, nullable=False,
            server_default="DISCONNECTED",
        ),
        sa.Column("active_run_id", GUID(), nullable=True),
        sa.Column("last_run_id", GUID(), nullable=True),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", story_source, nullable=False, server_default="MANUAL"),
        sa.Column("source_id", sa.String(length=255), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("linked_items", JSONB, nullable=False, server_default="[]"),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stories")),
    )
    op.create_index("ix_stories_tenant_id", "stories", ["tenant_id"])
    op.create_index("ix_stories_project_id", "stories", ["project_id"])
    op.create_index("ix_stories_sprint_id", "stories", ["sprint_id"])
    op.create_index("ix_stories_status", "stories", ["status"])
    op.create_index("ix_stories_tenant_project", "stories", ["tenant_id", "project_id"])
    _enable_rls("stories")

    # ---- sprints -----------------------------------------------------
    op.create_table(
        "sprints",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sprint_status, nullable=False, server_default="PLANNING"),
        sa.Column("story_ids", JSONB, nullable=False, server_default="[]"),
        sa.Column("total_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "completed_points", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sprints")),
    )
    op.create_index("ix_sprints_tenant_id", "sprints", ["tenant_id"])
    op.create_index("ix_sprints_project_id", "sprints", ["project_id"])
    op.create_index("ix_sprints_tenant_project", "sprints", ["tenant_id", "project_id"])
    _enable_rls("sprints")

    # ---- epics -------------------------------------------------------
    op.create_table(
        "epics",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", epic_status, nullable=False, server_default="PLANNING"),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("target_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("progress", sa.Float(), nullable=False, server_default="0"),
        sa.Column("story_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "completed_story_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_epics")),
    )
    op.create_index("ix_epics_tenant_id", "epics", ["tenant_id"])
    op.create_index("ix_epics_project_id", "epics", ["project_id"])
    op.create_index("ix_epics_tenant_project", "epics", ["tenant_id", "project_id"])
    _enable_rls("epics")

    # ---- story_comments ---------------------------------------------
    op.create_table(
        "story_comments",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column(
            "story_id",
            GUID(),
            sa.ForeignKey("stories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_id", GUID(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("mentions", JSONB, nullable=False, server_default="[]"),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_story_comments")),
    )
    op.create_index("ix_story_comments_tenant_id", "story_comments", ["tenant_id"])
    op.create_index("ix_story_comments_story_id", "story_comments", ["story_id"])
    _enable_rls("story_comments")


def downgrade() -> None:
    op.execute('DROP POLICY IF EXISTS story_comments_tenant_isolation ON story_comments;')
    op.drop_table("story_comments")
    op.execute('DROP POLICY IF EXISTS epics_tenant_isolation ON epics;')
    op.drop_table("epics")
    op.execute('DROP POLICY IF EXISTS sprints_tenant_isolation ON sprints;')
    op.drop_table("sprints")
    op.execute('DROP POLICY IF EXISTS stories_tenant_isolation ON stories;')
    op.drop_table("stories")
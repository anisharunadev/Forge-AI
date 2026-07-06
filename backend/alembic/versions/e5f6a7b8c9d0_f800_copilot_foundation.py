"""f800_copilot_foundation

F-800 — Forge Co-pilot data model foundation. Creates two new
tenant-scoped tables with RLS enabled and per-user indexes for
the service-layer privacy filter.

* copilot_conversations — one row per user-visible thread.
* copilot_messages      — one row per turn.

Per Rule 2 every row carries ``tenant_id`` and ``project_id`` (the
latter nullable for tenant-wide threads). Per F-800 design every row
also carries ``user_id`` and a service-layer filter enforces user
privacy in addition to the DB-level RLS (the DB does not have a
``app.user_id`` GUC — that is by design; see F-800 design §3.7).

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-25 13:00:00.000000
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.base import GUID  # noqa: E402

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enable_rls(table_name: str) -> None:
    """Standard RLS block used by every tenant-scoped table (DL-026).

    Mirrors the pattern in d4e5f6a7b8c9_f829_phase_c_violations.py.
    Per-user isolation is NOT enforced here (no app.user_id GUC);
    it lives in the service layer at CopilotConversation.user_id.
    """
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
    # ---- copilot_conversations ---------------------------------------
    op.create_table(
        "copilot_conversations",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=True),
        sa.Column("user_id", GUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "total_cost_usd",
            sa.Numeric(18, 8),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "total_tokens_in",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "total_tokens_out",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_copilot_conversations")),
    )
    op.create_index(
        op.f("ix_copilot_conversations_tenant_id"),
        "copilot_conversations",
        ["tenant_id"],
    )
    op.create_index(
        op.f("ix_copilot_conversations_project_id"),
        "copilot_conversations",
        ["project_id"],
    )
    op.create_index(
        op.f("ix_copilot_conversations_user_id"),
        "copilot_conversations",
        ["user_id"],
    )
    op.create_index(
        "ix_copilot_conv_user_updated",
        "copilot_conversations",
        ["user_id", "updated_at"],
    )
    op.create_index(
        "ix_copilot_conv_tenant_updated",
        "copilot_conversations",
        ["tenant_id", "updated_at"],
    )
    _enable_rls("copilot_conversations")

    # ---- copilot_messages --------------------------------------------
    op.create_table(
        "copilot_messages",
        sa.Column(
            "conversation_id",
            GUID(),
            sa.ForeignKey("copilot_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("tool_calls", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("suggested_actions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("confidence", sa.String(length=10), nullable=True),
        sa.Column("feedback_rating", sa.String(length=10), nullable=True),
        sa.Column("feedback_comment", sa.Text(), nullable=True),
        sa.Column("feedback_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("cost_usd", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("tokens_in", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tokens_out", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("context_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_copilot_messages")),
    )
    op.create_index(
        op.f("ix_copilot_messages_conversation_id"),
        "copilot_messages",
        ["conversation_id"],
    )
    op.create_index(
        op.f("ix_copilot_messages_tenant_id"),
        "copilot_messages",
        ["tenant_id"],
    )
    op.create_index(
        "ix_copilot_msg_conv_created",
        "copilot_messages",
        ["conversation_id", "created_at"],
    )
    op.create_index(
        "ix_copilot_msg_feedback",
        "copilot_messages",
        ["feedback_rating"],
        postgresql_where=sa.text("feedback_rating IS NOT NULL"),
    )
    _enable_rls("copilot_messages")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS copilot_messages_tenant_isolation ON copilot_messages;")
    op.drop_table("copilot_messages")
    op.execute(
        "DROP POLICY IF EXISTS copilot_conversations_tenant_isolation ON copilot_conversations;"
    )
    op.drop_table("copilot_conversations")

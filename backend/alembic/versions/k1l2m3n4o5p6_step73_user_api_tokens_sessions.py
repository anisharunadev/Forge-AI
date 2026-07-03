"""step73_user_api_tokens_and_sessions

Step 73 — Settings: API Tokens + Sessions tabs.

Adds two tables powering the remaining Settings tabs:

* user_api_tokens  — opaque bearer tokens per user (Settings → API Tokens)
* user_sessions    — refresh-token chain state per (user, device)
                     (Settings → Sessions)

Both tables carry tenant_id for Rule 2 isolation. Composite indexes
match the read paths: by (user_id, revoked_at) for the tab list
query, by (tenant_id, revoked_at) for cross-user enumeration if a
tenant admin ever needs it (not exposed yet).

Revision ID: k1l2m3n4o5p6
Revises: j8k9l0m1n2o3
Create Date: 2026-07-01 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "k1l2m3n4o5p6"
down_revision: Union[str, None] = "j8k9l0m1n2o3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # user_api_tokens
    # -----------------------------------------------------------------------
    op.create_table(
        "user_api_tokens",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False, server_default="read"),
        sa.Column("fingerprint_sha256", sa.String(length=12), nullable=False),
        sa.Column("secret_hash", sa.String(length=64), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.Index("ix_user_api_tokens_tenant_id", "tenant_id"),
        sa.Index("ix_user_api_tokens_user_id", "user_id"),
    )
    op.create_index(
        "ix_user_api_tokens_user_active", "user_api_tokens", ["user_id", "revoked_at"]
    )
    op.create_index(
        "ix_user_api_tokens_tenant_active",
        "user_api_tokens",
        ["tenant_id", "revoked_at"],
    )

    # -----------------------------------------------------------------------
    # user_sessions
    # -----------------------------------------------------------------------
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_agent", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("ip", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("label", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
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
        sa.Index("ix_user_sessions_tenant_id", "tenant_id"),
        sa.Index("ix_user_sessions_user_id", "user_id"),
    )
    op.create_index(
        "ix_user_sessions_user_active", "user_sessions", ["user_id", "revoked_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_user_sessions_user_active", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_index("ix_user_sessions_tenant_id", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_index("ix_user_api_tokens_tenant_active", table_name="user_api_tokens")
    op.drop_index("ix_user_api_tokens_user_active", table_name="user_api_tokens")
    op.drop_index("ix_user_api_tokens_user_id", table_name="user_api_tokens")
    op.drop_index("ix_user_api_tokens_tenant_id", table_name="user_api_tokens")
    op.drop_table("user_api_tokens")

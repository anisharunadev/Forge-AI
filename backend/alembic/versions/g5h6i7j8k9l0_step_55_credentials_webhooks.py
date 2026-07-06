"""step_55_credentials_and_webhooks

Step 55 — Phase 3 Connectors wiring. Adds:

* connector_credentials   — vault rows (tenant + project scoped)
* webhooks                — webhook subscriptions (in/out)
* webhook_deliveries      — append-only delivery audit

Per Rule 2 every row carries ``tenant_id`` and ``project_id``.
Per DL-026 RLS is enabled with tenant_isolation policy.

Revision ID: g5h6i7j8k9l0
Revises: f021a8b9c0d1
Create Date: 2026-06-29 09:00:00.000000
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.base import GUID, JSONB  # noqa: E402

revision: str = "g5h6i7j8k9l0"
down_revision: str | None = "f021a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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
    op.create_table(
        "connector_credentials",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("tenant_id", GUID(), nullable=False, index=True),
        sa.Column("project_id", GUID(), nullable=False, index=True),
        sa.Column(
            "connector_id",
            GUID(),
            sa.ForeignKey("connectors.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "api-key",
                "oauth-token",
                "pat",
                "webhook-secret",
                "service-account",
                name="connector_credential_type",
            ),
            nullable=False,
        ),
        sa.Column(
            "scope",
            sa.Enum("org", "project", name="connector_credential_scope"),
            nullable=False,
            server_default="project",
        ),
        sa.Column("preview", sa.String(64), nullable=False, server_default=""),
        sa.Column("encrypted_secret", sa.LargeBinary(), nullable=False),
        sa.Column("meta", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_rotated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "rotation_reminder_days",
            sa.Integer(),
            nullable=False,
            server_default="90",
        ),
        sa.Column("created_by", GUID(), nullable=False),
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
    )
    op.create_index(
        "ix_credential_tenant_connector",
        "connector_credentials",
        ["tenant_id", "connector_id"],
    )
    op.create_index(
        "ix_credential_tenant_expires",
        "connector_credentials",
        ["tenant_id", "expires_at"],
    )
    _enable_rls("connector_credentials")

    op.create_table(
        "webhooks",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("tenant_id", GUID(), nullable=False, index=True),
        sa.Column("project_id", GUID(), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "direction",
            sa.Enum("inbound", "outbound", name="webhook_direction"),
            nullable=False,
        ),
        sa.Column("url", sa.String(500), nullable=True),
        sa.Column("events", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "auth_type",
            sa.Enum("none", "basic", "bearer", "hmac", "signature", name="webhook_auth_type"),
            nullable=False,
            server_default="none",
        ),
        sa.Column("auth_secret", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "paused", "failing", name="webhook_status"),
            nullable=False,
            server_default="active",
        ),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_delivery_status", sa.String(16), nullable=True),
        sa.Column("success_count_24h", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_count_24h", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", GUID(), nullable=False),
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
    )
    op.create_index("ix_webhook_tenant_status", "webhooks", ["tenant_id", "status"])
    op.create_index("ix_webhook_tenant_direction", "webhooks", ["tenant_id", "direction"])
    _enable_rls("webhooks")

    op.create_table(
        "webhook_deliveries",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("tenant_id", GUID(), nullable=False, index=True),
        sa.Column("project_id", GUID(), nullable=False, index=True),
        sa.Column(
            "webhook_id",
            GUID(),
            sa.ForeignKey("webhooks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("event", sa.String(200), nullable=False),
        sa.Column(
            "status",
            sa.Enum("ok", "error", "pending", name="webhook_delivery_status"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("response_code", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_preview", sa.Text(), nullable=False, server_default=""),
        sa.Column("error_message", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_webhook_delivery_webhook_attempted",
        "webhook_deliveries",
        ["webhook_id", "attempted_at"],
    )
    _enable_rls("webhook_deliveries")


def downgrade() -> None:
    op.drop_index("ix_webhook_delivery_webhook_attempted", table_name="webhook_deliveries")
    op.drop_table("webhook_deliveries")
    op.drop_index("ix_webhook_tenant_direction", table_name="webhooks")
    op.drop_index("ix_webhook_tenant_status", table_name="webhooks")
    op.drop_table("webhooks")
    op.drop_index("ix_credential_tenant_expires", table_name="connector_credentials")
    op.drop_index("ix_credential_tenant_connector", table_name="connector_credentials")
    op.drop_table("connector_credentials")

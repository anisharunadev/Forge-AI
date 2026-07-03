"""step_75_p4_agent_virtual_key

Step 75 — Phase 1 LiteLLM gateway: Per-agent Virtual Key store.

Adds the ``agent_virtual_key`` table that the key-issuing service writes to
when minting a LiteLLM virtual key for an agent, and that ``/key/status`` /
``/key/revoke`` / ``/key/rotate`` read from on every admin action.

The plaintext key never leaves ``app.core.crypto.encrypt`` — this row
stores only the ``encrypted_key`` (Fernet token) and a ``fingerprint``
(sha256 hex of the plaintext) so the UI can show "last 4 chars" without
revealing the secret.

Schema is tenant-scoped (Rule 2) with three indexes matching the read
paths:

* ``agent_virtual_key_active_unique`` — partial UNIQUE on ``agent_id``
  where ``status = 'active'`` enforces "one active key per agent".
* ``(tenant_id, project_id, status)``   — per-tenant key admin views.
* ``(agent_id, created_at desc)``       — per-agent key history.

Revision ID: step_75_p4_agent_virtual_key_001
Revises: step_75_p3_spend_records_001
Create Date: 2026-07-02 12:30:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "step_75_p4_agent_virtual_key_001"
down_revision: Union[str, None] = "step_75_p3_spend_records_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_virtual_key",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("model_scope", sa.dialects.postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("max_budget_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column("tpm_limit", sa.Integer(), nullable=True),
        sa.Column("rpm_limit", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column("litellm_key_alias", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('active', 'rotated', 'revoked')",
            name="ck_agent_virtual_key_status",
        ),
    )
    op.create_index(
        "agent_virtual_key_active_unique",
        "agent_virtual_key",
        ["agent_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "ix_agent_virtual_key_tenant_project_status",
        "agent_virtual_key",
        ["tenant_id", "project_id", "status"],
    )
    op.create_index(
        "ix_agent_virtual_key_agent_created",
        "agent_virtual_key",
        ["agent_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_virtual_key_agent_created", table_name="agent_virtual_key"
    )
    op.drop_index(
        "ix_agent_virtual_key_tenant_project_status",
        table_name="agent_virtual_key",
    )
    op.drop_index(
        "agent_virtual_key_active_unique", table_name="agent_virtual_key"
    )
    op.drop_table("agent_virtual_key")


__all__ = ["upgrade", "downgrade", "revision", "down_revision"]
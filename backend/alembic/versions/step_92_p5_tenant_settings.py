"""step_92_p5_tenant_settings

Phase 5 -- Observability & SLOs.

Adds the ``tenant_settings`` table holding per-tenant OTel sampling
overrides and the debug-force-sample toggle. One row per tenant; the
``TenantSettingsCache`` in ``app.core.tenant_sampler`` reads through
this table with a 30s Redis TTL so the sampler can decide on every
span without a DB hit on the hot path.

Revision ID: step_92_p5_tenant_settings
Revises: step_91_m7_audit_chain_ref
Create Date: 2026-07-06 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_92_p5_tenant_settings"
down_revision: str | None = "step_91_m7_audit_chain_ref"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        uuid_type = postgresql.UUID(as_uuid=True)
    else:  # pragma: no cover -- sqlite/test path
        uuid_type = sa.String(length=36)

    op.create_table(
        "tenant_settings",
        sa.Column("id", uuid_type, primary_key=True),
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
        sa.Column(
            "tenant_id",
            uuid_type,
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        ),
        sa.Column(
            "sampling_rate",
            sa.Float,
            nullable=False,
            server_default="1.0",
        ),
        sa.Column(
            "log_quota_per_hour",
            sa.Integer,
            nullable=False,
            server_default="100000",
        ),
        sa.Column(
            "debug_force_sample",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_tenant_settings_tenant_id",
        "tenant_settings",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_tenant_settings_tenant_id", table_name="tenant_settings")
    op.drop_table("tenant_settings")


__all__ = [
    "upgrade",
    "downgrade",
    "revision",
    "down_revision",
]

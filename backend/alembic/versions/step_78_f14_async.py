"""step_78_f14_async

Step 78 — Phase 3 F14 Async: local progress tracking.

Adds ``forge_async_jobs`` — a lightweight row mirror of the LiteLLM
file / batch / fine-tune / response IDs so audit + cross-tenant
progress lookups don't have to round-trip the proxy on every poll.
The proxy still owns the real bytes / requests / fine-tuned models.

Revision ID: step_78_f14_async
Revises: step_78_f11_prompts
Create Date: 2026-07-04 12:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_78_f14_async"
down_revision: str | None = "step_78_f11_prompts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "forge_async_jobs",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
        sa.Column("external_id", sa.String(128), nullable=False),
        sa.Column(
            "payload",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "tenant_id", "kind", "external_id", name="uq_forge_async_jobs_external"
        ),
    )
    op.create_index("ix_forge_async_jobs_tenant_kind", "forge_async_jobs", ["tenant_id", "kind"])
    op.create_index(
        "ix_forge_async_jobs_tenant_project", "forge_async_jobs", ["tenant_id", "project_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_forge_async_jobs_tenant_project", table_name="forge_async_jobs")
    op.drop_index("ix_forge_async_jobs_tenant_kind", table_name="forge_async_jobs")
    op.drop_table("forge_async_jobs")

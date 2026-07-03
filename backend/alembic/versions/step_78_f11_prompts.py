"""step_78_f11_prompts

Step 78 — Phase 3 F11 Prompts: Prompt + PromptVersion.

Adds the two tables for the versioned prompt library:

* ``prompts`` — the logical library entry (name, current_version, status).
* ``prompt_versions`` — immutable snapshots of the template + variables +
  model_defaults at a point in time.

The split enforces the spec contract (versions are immutable once
active; up to 100 versions per prompt with auto-archive) via a
unique constraint on ``(prompt_id, version_number)`` and a JSONB
``variables`` column that carries the declared variables the UI uses
to auto-generate a form.

Revision ID: step_78_f11_prompts
Revises: step_78_f12_rbac_hierarchy
Create Date: 2026-07-04 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "step_78_f11_prompts"
down_revision: Union[str, None] = "step_78_f12_rbac_hierarchy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prompts",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(32), nullable=False, server_default="custom"),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("current_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tags", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("metadata", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_prompts_tenant_name"),
    )
    op.create_index("ix_prompts_tenant_status", "prompts", ["tenant_id", "status"])
    op.create_index("ix_prompts_tenant", "prompts", ["tenant_id"])

    op.create_table(
        "prompt_versions",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("prompt_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("model_defaults", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("variables", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("source", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("created_by", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prompt_id"], ["prompts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("prompt_id", "version_number", name="uq_prompt_versions_prompt_version"),
    )
    op.create_index(
        "ix_prompt_versions_prompt_status",
        "prompt_versions",
        ["prompt_id", "status"],
    )
    op.create_index("ix_prompt_versions_tenant", "prompt_versions", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_prompt_versions_tenant", table_name="prompt_versions")
    op.drop_index("ix_prompt_versions_prompt_status", table_name="prompt_versions")
    op.drop_table("prompt_versions")
    op.drop_index("ix_prompts_tenant", table_name="prompts")
    op.drop_index("ix_prompts_tenant_status", table_name="prompts")
    op.drop_table("prompts")
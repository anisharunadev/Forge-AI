"""step_95_architecture_versions

Day 1 mock-removal track E.

Adds the ``architecture_versions`` table that backs
``ArchitectureVersionRow`` and replaces the previous Python dataclass
``ArchitectureVersion`` (which had no SQLAlchemy model and therefore
``GET /architecture/versions`` always returned ``[]``).

The table is append-only — every create_version call inserts a new row
with an incremented ``version_number``; no UPDATE/DELETE paths.
Composite indexes cover the two common access patterns:

1. ``(tenant_id, project_id, artifact_type, artifact_id)`` for
   ``list_versions`` (newest first).
2. ``(tenant_id, project_id, created_at)`` for the audit-style
   timeline view used by the Architecture Center UI.

Revision ID: step_95_architecture_versions
Revises: step_94_adr_component_impact
Create Date: 2026-07-07 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_95_architecture_versions"
down_revision: str | None = "step_94_adr_component_impact"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        uuid_type = postgresql.UUID(as_uuid=True)
    else:  # pragma: no cover -- sqlite/test path
        uuid_type = sa.String(length=36)

    op.create_table(
        "architecture_versions",
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
        sa.Column("tenant_id", uuid_type, nullable=False),
        sa.Column("project_id", uuid_type, nullable=False),
        sa.Column("artifact_type", sa.String(length=64), nullable=False),
        sa.Column("artifact_id", uuid_type, nullable=False),
        sa.Column(
            "version_number",
            sa.Integer,
            nullable=False,
            server_default="1",
        ),
        sa.Column(
            "content_hash",
            sa.String(length=128),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "snapshot_reason",
            sa.String(length=500),
            nullable=False,
            server_default="",
        ),
        sa.Column("actor_id", uuid_type, nullable=True),
    )
    op.create_index(
        "ix_architecture_versions_tenant_project_artifact",
        "architecture_versions",
        ["tenant_id", "project_id", "artifact_type", "artifact_id"],
    )
    op.create_index(
        "ix_architecture_versions_tenant_project_created",
        "architecture_versions",
        ["tenant_id", "project_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_architecture_versions_tenant_project_created",
        table_name="architecture_versions",
    )
    op.drop_index(
        "ix_architecture_versions_tenant_project_artifact",
        table_name="architecture_versions",
    )
    op.drop_table("architecture_versions")


__all__ = [
    "upgrade",
    "downgrade",
    "revision",
    "down_revision",
]
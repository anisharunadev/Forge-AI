"""step_96_tech_radar

Day 2 mock-removal track G.

Adds the ``architecture_tech_radar`` table that backs
``TechRadarEntry``. The previous TechRadar tab on the Architecture
Center page rendered a hard-coded ``MOCK_TECH_RADAR`` array (16
blips) embedded in the frontend ``lib/architecture/mock-fixtures.ts``.
This table replaces that fixture so the tab can be served from the
real backend.

Quadrants: languages | tools | platforms | techniques.
Rings: adopt | trial | assess | hold.
``prev_ring`` captures blip movement between radar cycles.

Composite index ``(tenant_id, project_id)`` covers the list query
in ``TechRadarService.list_entries``.

Revision ID: step_96_tech_radar
Revises: step_95_architecture_versions
Create Date: 2026-07-07 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_96_tech_radar"
down_revision: str | None = "step_95_architecture_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        uuid_type = postgresql.UUID(as_uuid=True)
    else:  # pragma: no cover -- sqlite/test path
        uuid_type = sa.String(length=36)

    op.create_table(
        "architecture_tech_radar",
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
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("quadrant", sa.String(length=32), nullable=False),
        sa.Column("ring", sa.String(length=16), nullable=False),
        sa.Column(
            "description",
            sa.String(length=500),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "rationale",
            sa.String(length=500),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "owner",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
        sa.Column("prev_ring", sa.String(length=16), nullable=True),
    )
    op.create_index(
        "ix_tech_radar_tenant_project",
        "architecture_tech_radar",
        ["tenant_id", "project_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tech_radar_tenant_project",
        table_name="architecture_tech_radar",
    )
    op.drop_table("architecture_tech_radar")


__all__ = [
    "upgrade",
    "downgrade",
    "revision",
    "down_revision",
]

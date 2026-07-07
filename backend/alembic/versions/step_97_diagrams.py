"""step_97_diagrams

Day 2 mock-removal track H.

Adds the ``architecture_diagrams`` table and its child node / edge
rows, replacing the previous frontend ``MOCK_DIAGRAMS`` fixture
(3 C4 diagrams with 5-7 nodes each).

Design notes:
- Diagrams are tenant+project scoped via ``TenantScopedMixin``.
- Nodes / edges join through ``diagram_id`` for the FK walk; they
  intentionally omit ``tenant_id`` to match the spec — scoping is
  enforced by ``DiagramService.list_diagrams`` which joins back to
  the parent diagram for ``(tenant_id, project_id)`` filtering.
- Both child tables carry string ``node_key`` columns that mirror
  the source/target keys the frontend SVG renderer needs (mirrors
  the ``MOCK_DIAGRAMS`` convention of keyed edges like ``e1``,
  ``'user'`` → ``'gateway'``).

Revision ID: step_97_diagrams
Revises: step_96_tech_radar
Create Date: 2026-07-07 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_97_diagrams"
down_revision: str | None = "step_96_tech_radar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        uuid_type = postgresql.UUID(as_uuid=True)
    else:  # pragma: no cover -- sqlite/test path
        uuid_type = sa.String(length=36)

    op.create_table(
        "architecture_diagrams",
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
        sa.Column("name", sa.String(length=200), nullable=False),
        # context | container | component | dataflow | sequence
        sa.Column("level", sa.String(length=32), nullable=False),
        sa.Column(
            "description",
            sa.String(length=500),
            nullable=False,
            server_default="",
        ),
    )
    op.create_index(
        "ix_architecture_diagrams_tenant_project_level",
        "architecture_diagrams",
        ["tenant_id", "project_id", "level"],
    )

    op.create_table(
        "architecture_diagram_nodes",
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
            "diagram_id",
            uuid_type,
            sa.ForeignKey("architecture_diagrams.id"),
            nullable=False,
        ),
        sa.Column("node_key", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("layer", sa.String(length=32), nullable=False),
        sa.Column("x", sa.Integer, nullable=False, server_default="0"),
        sa.Column("y", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "details",
            sa.String(length=500),
            nullable=False,
            server_default="",
        ),
    )
    op.create_index(
        "ix_architecture_diagram_nodes_diagram",
        "architecture_diagram_nodes",
        ["diagram_id"],
    )

    op.create_table(
        "architecture_diagram_edges",
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
            "diagram_id",
            uuid_type,
            sa.ForeignKey("architecture_diagrams.id"),
            nullable=False,
        ),
        sa.Column(
            "source_node_id",
            uuid_type,
            sa.ForeignKey("architecture_diagram_nodes.id"),
            nullable=False,
        ),
        sa.Column(
            "target_node_id",
            uuid_type,
            sa.ForeignKey("architecture_diagram_nodes.id"),
            nullable=False,
        ),
        sa.Column("source_node_key", sa.String(length=64), nullable=False),
        sa.Column("target_node_key", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_architecture_diagram_edges_diagram",
        "architecture_diagram_edges",
        ["diagram_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_architecture_diagram_edges_diagram",
        table_name="architecture_diagram_edges",
    )
    op.drop_table("architecture_diagram_edges")
    op.drop_index(
        "ix_architecture_diagram_nodes_diagram",
        table_name="architecture_diagram_nodes",
    )
    op.drop_table("architecture_diagram_nodes")
    op.drop_index(
        "ix_architecture_diagrams_tenant_project_level",
        table_name="architecture_diagrams",
    )
    op.drop_table("architecture_diagrams")


__all__ = [
    "upgrade",
    "downgrade",
    "revision",
    "down_revision",
]

"""step_62_settings_models

Step-62 — Settings: Real Backend + Real Project Scope.

Adds the four new tables that wire the Settings page tabs to real
backend data:

  * project_members    — user <-> project <-> role (Members tab)
  * project_invitations — pending email invites (Members tab invite flow)
  * env_vars           — encrypted project secrets (Env Vars tab)
  * agent_configs      — per-project agent overrides (Agents tab)

Also extends `projects` with description / default_branch / visibility /
created_by columns and a (tenant_id, slug) unique constraint.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "j8k9l0m1n2o3"
down_revision: str | None = "i7j8k9l0m1n2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # Extend `projects` with the new columns
    # -----------------------------------------------------------------------
    op.add_column(
        "projects",
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column(
            "default_branch",
            sa.String(length=128),
            nullable=False,
            server_default="main",
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "visibility",
            sa.String(length=32),
            nullable=False,
            server_default="private",
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "created_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_unique_constraint("uq_projects_tenant_slug", "projects", ["tenant_id", "slug"])
    op.create_index("ix_projects_tenant_status", "projects", ["tenant_id", "status"])

    # -----------------------------------------------------------------------
    # project_members
    # -----------------------------------------------------------------------
    op.create_table(
        "project_members",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "project_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "role_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("roles.id"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="active",
        ),
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
        sa.UniqueConstraint("project_id", "user_id", name="ix_project_members_project_user"),
    )
    op.create_index("ix_project_members_status", "project_members", ["status"])

    # -----------------------------------------------------------------------
    # project_invitations
    # -----------------------------------------------------------------------
    op.create_table(
        "project_invitations",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "project_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column(
            "role_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("roles.id"),
            nullable=False,
        ),
        sa.Column(
            "invited_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
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
    op.create_index("ix_project_invitations_email", "project_invitations", ["email"])
    op.create_index("ix_project_invitations_status", "project_invitations", ["status"])
    op.create_index(
        "ix_project_invitations_project_status",
        "project_invitations",
        ["project_id", "status"],
    )

    # -----------------------------------------------------------------------
    # env_vars
    # -----------------------------------------------------------------------
    op.create_table(
        "env_vars",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("encrypted_value", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "scope",
            sa.String(length=32),
            nullable=False,
            server_default="runtime",
        ),
        sa.Column(
            "visibility",
            sa.String(length=32),
            nullable=False,
            server_default="secret",
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
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
        sa.UniqueConstraint("project_id", "key", name="ix_env_vars_project_key"),
    )
    op.create_index("ix_env_vars_tenant", "env_vars", ["tenant_id"])

    # -----------------------------------------------------------------------
    # agent_configs
    # -----------------------------------------------------------------------
    op.create_table(
        "agent_configs",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("default_model", sa.String(length=128), nullable=True),
        sa.Column(
            "temperature",
            sa.Float(),
            nullable=False,
            server_default="0.7",
        ),
        sa.Column(
            "max_tokens",
            sa.Integer(),
            nullable=False,
            server_default="4096",
        ),
        sa.Column(
            "allowed_tools",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "config",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
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
        sa.UniqueConstraint("project_id", "agent_id", name="ix_agent_configs_project_agent"),
    )
    op.create_index("ix_agent_configs_tenant", "agent_configs", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("agent_configs")
    op.drop_table("env_vars")
    op.drop_index("ix_project_invitations_project_status", table_name="project_invitations")
    op.drop_index("ix_project_invitations_status", table_name="project_invitations")
    op.drop_index("ix_project_invitations_email", table_name="project_invitations")
    op.drop_table("project_invitations")
    op.drop_index("ix_project_members_status", table_name="project_members")
    op.drop_table("project_members")
    op.drop_index("ix_projects_tenant_status", table_name="projects")
    op.drop_constraint("uq_projects_tenant_slug", "projects", type_="unique")
    op.drop_column("projects", "created_by")
    op.drop_column("projects", "visibility")
    op.drop_column("projects", "default_branch")
    op.drop_column("projects", "description")

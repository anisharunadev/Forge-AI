"""step_78_f12_rbac_hierarchy

Step 78 — Phase 3 F12 RBAC: Organization / Team / TeamMember / Customer.

Adds the four tables for the org → team → project → customer hierarchy
that the Phase 3 multi-tenant RBAC requires, and extends
``litellm_team_mappings`` with the new foreign keys so the existing
spend-reconciliation path can keep working.

Schema is tenant-scoped (Rule 2) with composite indexes on the
``(tenant_id, org_id)`` and ``(tenant_id, project_id)`` axes that
the read paths in ``rbac_v2_service`` use.

Revision ID: step_78_f12_rbac_hierarchy
Revises: step_75_p4_agent_virtual_key_001
Create Date: 2026-07-02 13:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_78_f12_rbac_hierarchy"
down_revision: str | None = "step_75_p4_agent_virtual_key_001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. organizations — the policy/white-label boundary under a Tenant.
    op.create_table(
        "organizations",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "brand",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("billing_ref", sa.String(255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_organizations_tenant", "organizations", ["tenant_id"])
    op.create_index("ix_organizations_billing_ref", "organizations", ["billing_ref"])

    # 2. teams — execution boundary under an Organization.
    op.create_table(
        "teams",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column(
            "model_allowlist",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "default_agent_config",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("blocked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_teams_tenant_org", "teams", ["tenant_id", "org_id"])

    # 3. team_members — User ↔ Team ↔ Role binding.
    op.create_table(
        "team_members",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("team_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("team_id", "user_id", name="ix_team_members_team_user"),
    )
    op.create_index("ix_team_members_tenant", "team_members", ["tenant_id"])

    # 4. customers — white-label sub-account under an Organization.
    op.create_table(
        "customers",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("blocked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("billing_ref", sa.String(255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_customers_tenant_org", "customers", ["tenant_id", "org_id"])
    op.create_index("ix_customers_billing_ref", "customers", ["billing_ref"])

    # 5. extend litellm_team_mappings with the new hierarchy FKs.
    op.add_column(
        "litellm_team_mappings",
        sa.Column("org_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "litellm_team_mappings",
        sa.Column("team_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_litellm_team_mappings_org",
        "litellm_team_mappings",
        "organizations",
        ["org_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_litellm_team_mappings_team",
        "litellm_team_mappings",
        "teams",
        ["team_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_litellm_team_mappings_team", "litellm_team_mappings", type_="foreignkey")
    op.drop_constraint("fk_litellm_team_mappings_org", "litellm_team_mappings", type_="foreignkey")
    op.drop_column("litellm_team_mappings", "team_id")
    op.drop_column("litellm_team_mappings", "org_id")
    op.drop_index("ix_customers_billing_ref", table_name="customers")
    op.drop_index("ix_customers_tenant_org", table_name="customers")
    op.drop_table("customers")
    op.drop_index("ix_team_members_tenant", table_name="team_members")
    op.drop_table("team_members")
    op.drop_index("ix_teams_tenant_org", table_name="teams")
    op.drop_table("teams")
    op.drop_index("ix_organizations_billing_ref", table_name="organizations")
    op.drop_index("ix_organizations_tenant", table_name="organizations")
    op.drop_table("organizations")

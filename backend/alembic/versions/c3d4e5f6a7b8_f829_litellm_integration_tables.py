"""f829_litellm_integration_tables

F-829 — Forge ↔ LiteLLM integration layer (Phase A).
Creates 5 new tenant-scoped tables with RLS policies:

* litellm_team_mappings        — 1:1 Forge tenant ↔ LiteLLM Team
* litellm_key_audit            — append-only Virtual Key lifecycle ledger
* litellm_budget_configs       — mirrored per-tenant budget configuration
* litellm_model_assignments    — per-tenant tier → concrete model
* litellm_call_records         — operation-level audit log for every LLM call

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f5a6
Create Date: 2026-06-25 12:00:00.000000
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.base import GUID  # noqa: E402

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enable_rls(table_name: str) -> None:
    """Standard RLS block used by every tenant-scoped table (DL-026)."""
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
    # ---- litellm_team_mappings ---------------------------------------
    op.create_table(
        "litellm_team_mappings",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("litellm_team_id", sa.String(length=128), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="active",
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_litellm_team_mappings")),
        sa.UniqueConstraint(
            "litellm_team_id",
            name=op.f("uq_litellm_team_mappings_litellm_team_id"),
        ),
    )
    op.create_index(
        op.f("ix_litellm_team_mappings_tenant_id"),
        "litellm_team_mappings",
        ["tenant_id"],
    )
    op.create_index(
        op.f("ix_litellm_team_mappings_project_id"),
        "litellm_team_mappings",
        ["project_id"],
    )
    op.create_index(
        "ix_litellm_team_mappings_tenant_project",
        "litellm_team_mappings",
        ["tenant_id", "project_id"],
    )
    _enable_rls("litellm_team_mappings")

    # ---- litellm_key_audit -------------------------------------------
    op.create_table(
        "litellm_key_audit",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("litellm_team_id", sa.String(length=128), nullable=False),
        sa.Column("litellm_key_alias", sa.String(length=256), nullable=False),
        sa.Column("litellm_key_hash", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("actor_id", GUID(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", GUID(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_litellm_key_audit")),
    )
    op.create_index(
        op.f("ix_litellm_key_audit_tenant_id"),
        "litellm_key_audit",
        ["tenant_id"],
    )
    op.create_index(
        op.f("ix_litellm_key_audit_project_id"),
        "litellm_key_audit",
        ["project_id"],
    )
    op.create_index(
        op.f("ix_litellm_key_audit_litellm_team_id"),
        "litellm_key_audit",
        ["litellm_team_id"],
    )
    op.create_index(
        op.f("ix_litellm_key_audit_litellm_key_alias"),
        "litellm_key_audit",
        ["litellm_key_alias"],
    )
    op.create_index(
        op.f("ix_litellm_key_audit_occurred_at"),
        "litellm_key_audit",
        ["occurred_at"],
    )
    op.create_index(
        "ix_litellm_key_audit_tenant_project_occurred",
        "litellm_key_audit",
        ["tenant_id", "project_id", "occurred_at"],
    )
    _enable_rls("litellm_key_audit")

    # ---- litellm_budget_configs --------------------------------------
    op.create_table(
        "litellm_budget_configs",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("litellm_team_id", sa.String(length=128), nullable=False),
        sa.Column("litellm_budget_id", sa.String(length=128), nullable=True),
        sa.Column("max_usd", sa.Numeric(18, 4), nullable=False),
        sa.Column(
            "period",
            sa.String(length=16),
            nullable=False,
            server_default="monthly",
        ),
        sa.Column(
            "hard_limit",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_litellm_budget_configs")),
        sa.UniqueConstraint("tenant_id", name=op.f("uq_litellm_budget_configs_tenant")),
    )
    op.create_index(
        op.f("ix_litellm_budget_configs_tenant_id"),
        "litellm_budget_configs",
        ["tenant_id"],
    )
    op.create_index(
        op.f("ix_litellm_budget_configs_project_id"),
        "litellm_budget_configs",
        ["project_id"],
    )
    op.create_index(
        op.f("ix_litellm_budget_configs_litellm_team_id"),
        "litellm_budget_configs",
        ["litellm_team_id"],
    )
    _enable_rls("litellm_budget_configs")

    # ---- litellm_model_assignments -----------------------------------
    op.create_table(
        "litellm_model_assignments",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("tier", sa.String(length=64), nullable=False),
        sa.Column("model_name", sa.String(length=256), nullable=False),
        sa.Column("max_input_tokens", sa.Integer(), nullable=True),
        sa.Column("max_output_tokens", sa.Integer(), nullable=True),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("id", GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_litellm_model_assignments")),
        sa.UniqueConstraint(
            "tenant_id",
            "tier",
            name=op.f("uq_litellm_model_assignments_tenant_tier"),
        ),
    )
    op.create_index(
        op.f("ix_litellm_model_assignments_tenant_id"),
        "litellm_model_assignments",
        ["tenant_id"],
    )
    op.create_index(
        op.f("ix_litellm_model_assignments_project_id"),
        "litellm_model_assignments",
        ["project_id"],
    )
    op.create_index(
        "ix_litellm_model_assignments_tenant_project",
        "litellm_model_assignments",
        ["tenant_id", "project_id"],
    )
    _enable_rls("litellm_model_assignments")

    # ---- litellm_call_records ----------------------------------------
    op.create_table(
        "litellm_call_records",
        sa.Column("tenant_id", GUID(), nullable=False),
        sa.Column("project_id", GUID(), nullable=False),
        sa.Column("workflow_id", GUID(), nullable=True),
        sa.Column("actor_id", GUID(), nullable=True),
        sa.Column("forge_trace_id", sa.String(length=64), nullable=False),
        sa.Column("litellm_call_id", sa.String(length=128), nullable=True),
        sa.Column("model", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", GUID(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_litellm_call_records")),
    )
    op.create_index(
        op.f("ix_litellm_call_records_tenant_id"),
        "litellm_call_records",
        ["tenant_id"],
    )
    op.create_index(
        op.f("ix_litellm_call_records_project_id"),
        "litellm_call_records",
        ["project_id"],
    )
    op.create_index(
        op.f("ix_litellm_call_records_workflow_id"),
        "litellm_call_records",
        ["workflow_id"],
    )
    op.create_index(
        op.f("ix_litellm_call_records_forge_trace_id"),
        "litellm_call_records",
        ["forge_trace_id"],
    )
    op.create_index(
        op.f("ix_litellm_call_records_litellm_call_id"),
        "litellm_call_records",
        ["litellm_call_id"],
    )
    op.create_index(
        op.f("ix_litellm_call_records_occurred_at"),
        "litellm_call_records",
        ["occurred_at"],
    )
    op.create_index(
        "ix_litellm_call_records_tenant_occurred",
        "litellm_call_records",
        ["tenant_id", "occurred_at"],
    )
    _enable_rls("litellm_call_records")


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS litellm_call_records_tenant_isolation ON litellm_call_records;"
    )
    op.drop_table("litellm_call_records")
    op.execute(
        "DROP POLICY IF EXISTS litellm_model_assignments_tenant_isolation ON litellm_model_assignments;"
    )
    op.drop_table("litellm_model_assignments")
    op.execute(
        "DROP POLICY IF EXISTS litellm_budget_configs_tenant_isolation ON litellm_budget_configs;"
    )
    op.drop_table("litellm_budget_configs")
    op.execute("DROP POLICY IF EXISTS litellm_key_audit_tenant_isolation ON litellm_key_audit;")
    op.drop_table("litellm_key_audit")
    op.execute(
        "DROP POLICY IF EXISTS litellm_team_mappings_tenant_isolation ON litellm_team_mappings;"
    )
    op.drop_table("litellm_team_mappings")

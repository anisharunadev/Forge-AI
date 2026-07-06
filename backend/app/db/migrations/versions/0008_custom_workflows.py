"""custom_workflows + custom_workflow_runs tables (F-018 extension — custom workflows).

Adds:

- ``workflows`` — one row per user-authored DAG. Carries tenant_id,
  project_id, name, description, definition (JSONB), created_by,
  latest_run_id (denormalized for list views), and a soft-delete
  ``deleted_at``. Unique on ``(tenant_id, project_id, name)`` for live rows.

- ``workflow_runs`` — one row per execution of a workflow. Carries FK
  to ``workflows.id`` (CASCADE on delete), tenant_id, project_id,
  status, current_step_id, state (JSONB; per-step results), error,
  and started_at / finished_at timestamps.

Both tables are tenant-scoped (Rule 2) and get the standard
``ENABLE / FORCE / CREATE POLICY`` RLS block (DL-026).

Revision ID: 0008_custom_workflows
Revises: 0007_connector_health_history
Create Date: 2026-06-24
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "0008_custom_workflows"
down_revision = "0007_connector_health_history"
branch_labels = None
depends_on = None


WORKFLOW_RUN_STATUS = (
    "pending",
    "running",
    "waiting_approval",
    "paused",
    "succeeded",
    "failed",
    "cancelled",
)


def upgrade() -> None:
    # ---- workflows --------------------------------------------------
    op.create_table(
        "workflows",
        sa.Column("id", sa.GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.GUID(), nullable=False),
        sa.Column("project_id", sa.GUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("definition", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.GUID(), nullable=False),
        sa.Column("latest_run_id", sa.GUID(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_workflows"),
        sa.UniqueConstraint(
            "tenant_id",
            "project_id",
            "name",
            name="uq_workflows_tenant_project_name",
        ),
    )
    op.create_index("ix_workflows_tenant_id", "workflows", ["tenant_id"])
    op.create_index("ix_workflows_project_id", "workflows", ["project_id"])
    op.create_index(
        "ix_workflows_tenant_project",
        "workflows",
        ["tenant_id", "project_id"],
    )
    op.create_index(
        "ix_workflows_tenant_project_deleted",
        "workflows",
        ["tenant_id", "project_id", "deleted_at"],
    )

    op.execute("ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE workflows FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY workflows_tenant_isolation
            ON workflows
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
        """
    )

    # ---- workflow_runs ---------------------------------------------
    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.GUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "workflow_id",
            sa.GUID(),
            sa.ForeignKey("workflows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.GUID(), nullable=False),
        sa.Column("project_id", sa.GUID(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*WORKFLOW_RUN_STATUS, name="workflow_run_status"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("triggered_by", sa.GUID(), nullable=False),
        sa.Column("current_step_id", sa.String(length=64), nullable=True),
        sa.Column(
            "state",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_workflow_runs"),
    )
    op.create_index("ix_workflow_runs_tenant_id", "workflow_runs", ["tenant_id"])
    op.create_index("ix_workflow_runs_project_id", "workflow_runs", ["project_id"])
    op.create_index(
        "ix_workflow_runs_workflow_id",
        "workflow_runs",
        ["workflow_id"],
    )
    op.create_index(
        "ix_workflow_runs_tenant_project",
        "workflow_runs",
        ["tenant_id", "project_id"],
    )
    op.create_index(
        "ix_workflow_runs_workflow_status",
        "workflow_runs",
        ["workflow_id", "status"],
    )
    op.create_index("ix_workflow_runs_status", "workflow_runs", ["status"])

    op.execute("ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY workflow_runs_tenant_isolation
            ON workflow_runs
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS workflow_runs_tenant_isolation ON workflow_runs;")
    op.drop_index("ix_workflow_runs_status", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_workflow_status", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_tenant_project", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_project_id", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_tenant_id", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_workflow_id", table_name="workflow_runs")
    op.drop_table("workflow_runs")

    op.execute("DROP POLICY IF EXISTS workflows_tenant_isolation ON workflows;")
    op.drop_index("ix_workflows_tenant_project_deleted", table_name="workflows")
    op.drop_index("ix_workflows_tenant_project", table_name="workflows")
    op.drop_index("ix_workflows_project_id", table_name="workflows")
    op.drop_index("ix_workflows_tenant_id", table_name="workflows")
    op.drop_table("workflows")

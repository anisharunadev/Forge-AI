"""step_90_m5_security_report

M5 — Gap M5-G3. New ``architecture_security_reports`` table for the
Security Report service in M5 Architecture Center.

Fields mirror :class:`app.db.models.security_report.SecurityReport`:
- title, severity (low|medium|high|critical), category
  (auth|data|network|dependency|configuration|cryptography|logging),
  description, affected_service, recommendation
- status (open|mitigating|accepted|closed) with default 'open'
- source_adr_id (nullable FK to architecture_adrs.id, ON DELETE SET
  NULL so an ADR delete doesn't cascade-evaporate the finding)
- discovered_at (NOT NULL), mitigated_at (NULL until mitigation is
  recorded), generated_by

Indexes:
- (tenant_id, project_id, status) for the default list query
- (tenant_id, project_id, severity, category) for the dashboard
  drill-in
- source_adr_id (FK auto-index) for cross-references

Revision ID: step_90_m5_security_report
Revises: step_80_m3_connector_activity
Create Date: 2026-07-05 14:50:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_90_m5_security_report"
down_revision: str | None = "step_80_m3_connector_activity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "architecture_security_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "source_adr_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column(
            "severity",
            sa.String(length=16),
            nullable=False,
            server_default="medium",
        ),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "affected_service",
            sa.String(length=200),
            nullable=False,
            server_default="",
        ),
        sa.Column("recommendation", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="open",
        ),
        sa.Column(
            "discovered_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "mitigated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "generated_by",
            sa.String(length=64),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["source_adr_id"],
            ["architecture_adrs.id"],
            ondelete="SET NULL",
        ),
        sa.Index(
            "ix_architecture_security_reports_tenant_project_status",
            ["tenant_id", "project_id", "status"],
        ),
        sa.Index(
            "ix_architecture_security_reports_severity_category",
            ["tenant_id", "project_id", "severity", "category"],
        ),
        sa.Index(
            "ix_architecture_security_reports_source_adr",
            ["source_adr_id"],
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_architecture_security_reports_severity_category",
        table_name="architecture_security_reports",
    )
    op.drop_index(
        "ix_architecture_security_reports_tenant_project_status",
        table_name="architecture_security_reports",
    )
    op.drop_index(
        "ix_architecture_security_reports_source_adr",
        table_name="architecture_security_reports",
    )
    op.drop_table("architecture_security_reports")

"""p4_idx_002 — composite indexes part 2

Phase 4 SC-4.2 — Composite (tenant_id, project_id, …) indexes — Part 2.

Continues the audit-driven index additions; closes the next batch:

  * ideation_approval_items
  * ideation_push_records
  * ingestion_artifacts
  * ingestion_runs
  * lesson_candidates
  * output_bundles
  * phase4_credentials
  * phase4_finops_settings
  * phase4_realtime_client_secrets

Revision ID: p4_idx_002
Revises: p4_idx_001
Create Date: 2026-07-05 23:50:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "p4_idx_002"
down_revision: str | Sequence[str] | None = "p4_idx_001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_INDEXES = [
    ("ideation_approval_items", "ix_ideation_approval_items_tenant_project"),
    ("ideation_push_records", "ix_ideation_push_records_tenant_project"),
    ("ingestion_artifacts", "ix_ingestion_artifacts_tenant_project"),
    ("ingestion_runs", "ix_ingestion_runs_tenant_project"),
    ("lesson_candidates", "ix_lesson_candidates_tenant_project"),
    ("output_bundles", "ix_output_bundles_tenant_project"),
    ("phase4_credentials", "ix_phase4_credentials_tenant_project"),
    ("phase4_finops_settings", "ix_phase4_finops_settings_tenant_project"),
    ("phase4_realtime_client_secrets", "ix_phase4_realtime_client_secrets_tenant_project"),
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        for table, ix_name in _INDEXES:
            op.execute(
                f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{ix_name}" '
                f'ON "{table}" (tenant_id, project_id)'
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        for _table, ix_name in reversed(_INDEXES):
            op.execute(f'DROP INDEX CONCURRENTLY IF EXISTS "{ix_name}"')

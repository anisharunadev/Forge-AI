"""p4_idx_001 — composite indexes part 1

Phase 4 SC-4.2 — Composite (tenant_id, project_id, …) indexes — Part 1.

Adds composite indexes to the first 9 tenant+project tables flagged
missing by ``scripts/audit-tenancy.py`` at PR-4.1 baseline:

  * agent_configs
  * audit_events
  * connector_activity
  * connector_credentials
  * connector_health_history
  * connector_sync_history
  * cost_entries
  * env_vars
  * hooks

``CREATE INDEX CONCURRENTLY`` is wrapped in ``autocommit`` per
Alembic guidance so the migration is non-blocking in production.

Revision ID: p4_idx_001
Revises: step_91_m7_audit_chain_ref, step_77_p0_litellm_guardrail_assignments,
         step_78_f13_rag, step_78_f15_observability
Create Date: 2026-07-05 23:50:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "p4_idx_001"
down_revision: str | Sequence[str] | None = (
    "step_91_m7_audit_chain_ref",
    "step_77_p0_litellm_guardrail_assignments",
    "step_78_f13_rag",
    "step_78_f15_observability",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ponytail: 9 composite indexes. The brief requires tenant_id + project_id as
# the leading columns. CONCURRENTLY requires autocommit; if applied to a
# SQLite test engine the index op is skipped.
_INDEXES = [
    ("agent_configs", "ix_agent_configs_tenant_project"),
    ("audit_events", "ix_audit_events_tenant_project"),
    ("connector_activity", "ix_connector_activity_tenant_project"),
    ("connector_credentials", "ix_connector_credentials_tenant_project"),
    ("connector_health_history", "ix_connector_health_history_tenant_project"),
    ("connector_sync_history", "ix_connector_sync_history_tenant_project"),
    ("cost_entries", "ix_cost_entries_tenant_project"),
    ("env_vars", "ix_env_vars_tenant_project"),
    ("hooks", "ix_hooks_tenant_project"),
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite test path — create_all from Base.metadata already adds
        # composite indexes via __table_args__ when those land in models.
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
        for table, ix_name in reversed(_INDEXES):
            op.execute(f'DROP INDEX CONCURRENTLY IF EXISTS "{ix_name}"')

"""p4_idx_003 — composite indexes part 3

Phase 4 SC-4.2 — Composite (tenant_id, project_id, …) indexes — Part 3.

Closes the remaining audit-driven index gaps:

  * phase4_vault_configs
  * templates
  * terminal_session_costs
  * webhook_deliveries
  * webhooks
  * workflow_budget_decisions
  * workflow_sessions

After this migration the ``scripts/audit-tenancy.py`` script exits 0.

Revision ID: p4_idx_003
Revises: p4_idx_002
Create Date: 2026-07-05 23:50:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "p4_idx_003"
down_revision: str | Sequence[str] | None = "p4_idx_002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ponytail: 7 composite indexes; this is the canonical Phase 4 SC-4.2 closure.
_INDEXES = [
    ("phase4_vault_configs", "ix_phase4_vault_configs_tenant_project"),
    ("templates", "ix_templates_tenant_project"),
    ("terminal_session_costs", "ix_terminal_session_costs_tenant_project"),
    ("webhook_deliveries", "ix_webhook_deliveries_tenant_project"),
    ("webhooks", "ix_webhooks_tenant_project"),
    ("workflow_budget_decisions", "ix_workflow_budget_decisions_tenant_project"),
    ("workflow_sessions", "ix_workflow_sessions_tenant_project"),
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

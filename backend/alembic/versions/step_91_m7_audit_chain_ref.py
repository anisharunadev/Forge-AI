"""step_91_m7_audit_chain_ref

M7 — Audit Center (gap M7-G2).

Adds the ``hash_chain_ref`` column to ``audit_events`` so the per-row
tamper-evident digest is persisted alongside the row. The column is
nullable: pre-M7 rows have no chain entry, and backfill is computed
lazily by ``ObservabilityService.reload_chain_heads`` on FastAPI
startup (see ``observability_service.py``).

DDL note: although the AuditEvent ORM model raises on UPDATE/DELETE
via the ``before_update`` / ``before_delete`` event listeners, those
listeners fire only on ORM-level mutations. ``ALTER TABLE`` is DDL
and bypasses the listener entirely, so this migration does not need
any special handling.

Revision ID: step_91_m7_audit_chain_ref
Revises: step_90_m5_security_report
Create Date: 2026-07-05 17:10:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step_91_m7_audit_chain_ref"
down_revision: str | None = "step_90_m5_security_report"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Use postgresql.UUID for parity with the rest of the schema
    # (the AuditEvent.id column is a UUID), but fall back to
    # sa.String for SQLAlchemy's automatic dialect selection when
    # running against a non-Postgres test engine.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        uuid_type = postgresql.UUID(as_uuid=True)
    else:  # pragma: no cover — sqlite/test path
        uuid_type = sa.String(length=36)

    op.add_column(
        "audit_events",
        sa.Column("hash_chain_ref", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_audit_events_hash_chain_ref",
        "audit_events",
        ["hash_chain_ref"],
        unique=False,
    )
    # Keep the uuid_type reference so the import doesn't get flagged
    # as unused by ruff when running on Postgres-only CI.
    del uuid_type


def downgrade() -> None:
    op.drop_index(
        "ix_audit_events_hash_chain_ref",
        table_name="audit_events",
    )
    op.drop_column("audit_events", "hash_chain_ref")


__all__ = [
    "upgrade",
    "downgrade",
    "revision",
    "down_revision",
]

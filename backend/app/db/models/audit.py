"""AuditEvent — append-only (Rule 6).

DB-level immutability is enforced at the SQLAlchemy layer via the
``before_update`` / ``before_delete`` event listeners below. DDL is
not blocked, so an Alembic migration may add columns; UPDATEs at the
ORM layer are rejected with ``RuntimeError`` so we get a clean
stacktrace.

M7 — tamper-evident hash chain:

* ``hash_chain_ref`` stores the per-row digest
  ``sha256(prev_hash + canonical(payload))`` written by
  ``AuditService.record`` after the row is inserted. The column is
  nullable because pre-existing rows have no chain entry; new rows
  are back-filled on the write path via raw SQL (the raw UPDATE
  bypasses the ``before_update`` ORM listener).
* ``verify_chain`` walks rows in ``occurred_at`` order and recomputes
  the chain; a mismatch surfaces as ``integrity_ok=False`` plus
  ``broken_at_event_id`` on the integrity endpoint.

A module-level bypass flag (``set_audit_immutability_bypass``) lets
test code corrupt a row's payload to exercise the failure path.
Production callers MUST leave the flag at its default ``False``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, String, event
from sqlalchemy.orm import Mapped, mapped_column

from app.core.logging import get_logger
from app.db.base import GUID, JSONB, Base, UUIDPrimaryKeyMixin

logger = get_logger(__name__)


# Bypass flag — process-local. ``AuditService.record`` issues raw SQL
# for ``hash_chain_ref`` so the ORM listener never fires on the
# production write path; this flag is a safety valve for tests and
# admin tools that need to mutate a row. Default is False.
_BYPASS_AUDIT_IMMUTABILITY: bool = False


def set_audit_immutability_bypass(enabled: bool) -> bool:
    """Toggle the ORM immutability bypass.

    Returns the prior state so callers can stack the toggle. Test
    code that needs to corrupt a single row's payload to exercise
    the ``verify_chain`` failure path is the only legitimate
    consumer — production code MUST leave the default (``False``)
    in place.
    """
    global _BYPASS_AUDIT_IMMUTABILITY  # noqa: PLW0603 — process-local flag
    previous = _BYPASS_AUDIT_IMMUTABILITY
    _BYPASS_AUDIT_IMMUTABILITY = enabled
    return previous


def is_audit_immutability_bypassed() -> bool:
    """Return the current bypass state (test assertion helper)."""
    return _BYPASS_AUDIT_IMMUTABILITY


class AuditEvent(Base, UUIDPrimaryKeyMixin):
    """Immutable audit record.

    `actor_id` may be NULL for system actions (a connector sync).
    `payload` is opaque JSON; downstream services project it as needed.
    """

    __tablename__ = "audit_events"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    # M7 — tamper-evident hash chain reference. NULL on legacy rows;
    # populated on every new write by ``AuditService.record`` via a
    # raw-SQL UPDATE that bypasses the ``before_update`` listener.
    hash_chain_ref: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # Phase 4 — Rule 6 audit columns. All nullable so existing rows
    # backfill cleanly; the copilot write path populates them via
    # ``copilot_service._audit_and_emit``. Indexes only on the
    # columns the cost-attribution dashboard actually filters by.
    model: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    prompt_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    cost_usd: Mapped[float | None] = mapped_column(nullable=True)
    artifact_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (Index("ix_audit_events_tenant_project", "tenant_id", "project_id"),)


# SQLAlchemy ORM-level immutability: any UPDATE or DELETE attempt is
# rejected at the application boundary so we get a clean stacktrace.
@event.listens_for(AuditEvent, "before_update", propagate=True)
@event.listens_for(AuditEvent, "before_delete", propagate=True)
def _reject_mutation(_mapper: Any, _connection: Any, _target: Any) -> None:  # type: ignore[no-untyped-def]
    if _BYPASS_AUDIT_IMMUTABILITY:
        return
    logger.error("audit.immutability_violation")
    raise RuntimeError(
        "AuditEvent is append-only; UPDATE/DELETE forbidden (Rule 6, "
        "raw-SQL bypass available for hash-chain write)"
    )


__all__ = [
    "AuditEvent",
    "set_audit_immutability_bypass",
    "is_audit_immutability_bypassed",
]

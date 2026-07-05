"""Audit service — writes AuditEvent rows from any call site.

The decorator in `app.core.audit` is the endpoint-level hook; this
service is the call-site hook for non-endpoint code (services, jobs).

M7 — Tamper-evident hash chain:

* ``record`` also computes ``sha256(prev + canonical(payload))`` via
  ``ObservabilityService.chain_hash`` and persists the digest in
  ``audit_events.hash_chain_ref``. The UPDATE is a raw SQL statement
  that bypasses the ORM ``before_update`` listener that enforces the
  append-only invariant — the listener rejects ORM-level mutations,
  not literal SQL.
* The in-process ``_HASH_CHAIN`` dict in ``observability_service`` is
  updated so subsequent writes within this process pick up where the
  new row left off. The lifetime of that dict is a single process;
  ``observability_service.reload_chain_heads`` rebuilds it from the
  DB on FastAPI startup.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text

from app.db.models.audit import AuditEvent
from app.db.session import get_session_factory
from app.services.observability_service import observability_service


def _coerce_uuid(value: UUID | str | None) -> UUID | None:
    """Coerce ``UUID`` / ``str`` / ``None`` to a ``UUID`` (or ``None``)."""
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    return UUID(str(value))


class AuditService:
    """Single entry-point for writing AuditEvents."""

    async def record(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        action: str,
        target_type: str,
        target_id: str,
        payload: dict[str, Any] | None = None,
        occurred_at: datetime | None = None,
    ) -> UUID:
        """Write an AuditEvent row and stamp ``hash_chain_ref`` on it.

        Returns the new row's id so callers can correlate with
        downstream operations (e.g. attaching the chain ref to a
        response header).
        """
        tenant_uuid = _coerce_uuid(tenant_id)
        if tenant_uuid is None:
            raise ValueError("tenant_id is required for AuditService.record")

        factory = get_session_factory()
        payload_dict: dict[str, Any] = payload or {}
        ts = occurred_at or datetime.now(timezone.utc)

        async with factory() as session:
            row = AuditEvent(
                tenant_id=str(tenant_uuid),
                project_id=(
                    str(project_id) if project_id
                    else "00000000-0000-0000-0000-000000000000"
                ),
                actor_id=str(actor_id) if actor_id else None,
                action=action,
                target_type=target_type,
                target_id=target_id,
                payload=payload_dict,
                occurred_at=ts,
            )
            session.add(row)
            # Flush so the server-generated id is populated without
            # hitting the network twice (insert then update).
            await session.flush()

            # Compute the chain digest against the in-memory head
            # (will be the literal "" if this is the first event
            # for the tenant in this process). After
            # ``observability_service.chain_hash`` the new head is
            # already cached for the next call.
            digest = observability_service.chain_hash(
                tenant_id=tenant_uuid, payload=payload_dict
            )

            # Persist the digest — raw SQL so the ORM ``before_update``
            # immutability listener does not fire. This UPDATE is the
            # single, narrowly-scoped bypass of the append-only rule.
            await session.execute(
                text(
                    "UPDATE audit_events SET hash_chain_ref = :ref "
                    "WHERE id = :id"
                ),
                {"ref": digest, "id": str(row.id)},
            )
            await session.commit()

            return row.id  # type: ignore[return-value]


audit_service = AuditService()


__all__ = ["AuditService", "audit_service"]

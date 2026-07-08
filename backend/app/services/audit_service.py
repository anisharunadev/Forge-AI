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

import os
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis
from sqlalchemy import text

from app.core.logging import get_logger
from app.db.models.audit import AuditEvent
from app.db.session import get_session_factory
from app.services.observability_service import observability_service

logger = get_logger(__name__)


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
        # Phase 4 — Rule 6 audit columns. All optional so existing
        # callers stay green; the copilot write path is the only
        # caller that populates them today.
        model: str | None = None,
        prompt_hash: str | None = None,
        cost_usd: float | None = None,
        artifact_ref: str | None = None,
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
        ts = occurred_at or datetime.now(UTC)

        async with factory() as session:
            row = AuditEvent(
                tenant_id=str(tenant_uuid),
                project_id=(
                    str(project_id) if project_id else "00000000-0000-0000-0000-000000000000"
                ),
                actor_id=str(actor_id) if actor_id else None,
                action=action,
                target_type=target_type,
                target_id=target_id,
                payload=payload_dict,
                occurred_at=ts,
                model=model,
                prompt_hash=prompt_hash,
                cost_usd=cost_usd,
                artifact_ref=artifact_ref,
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
            digest = observability_service.chain_hash(tenant_id=tenant_uuid, payload=payload_dict)

            # Persist the digest — raw SQL so the ORM ``before_update``
            # immutability listener does not fire. This UPDATE is the
            # single, narrowly-scoped bypass of the append-only rule.
            await session.execute(
                text("UPDATE audit_events SET hash_chain_ref = :ref WHERE id = :id"),
                {"ref": digest, "id": str(row.id)},
            )
            await session.commit()

        # ponytail: best-effort fanout to live audit subscribers.
        # Failures MUST NOT block audit durability; the row is already
        # committed at this point.
        try:
            redis_client = _redis_client()
            if redis_client is not None:
                await redis_client.xadd(
                    f"audit:{tenant_uuid}",
                    {
                        "id": str(row.id),
                        "action": action,
                        "ts": str(row.occurred_at),
                    },
                    maxlen=10_000,
                    approximate=True,
                )
                await redis_client.close()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "audit_stream_xadd_failed",
                audit_id=str(row.id),
                error=str(exc),
            )

        return row.id  # type: ignore[return-value]


def _redis_client() -> aioredis.Redis | None:
    """Lazy Redis client for live audit fanout.

    Returns None when REDIS_URL is unset (e.g. unit tests).
    The :meth:AuditService.record XADD call swallows connection
    errors, so a misconfigured Redis is non-fatal.
    """
    url = os.environ.get("REDIS_URL")
    if not url:
        return None
    return aioredis.from_url(url, decode_responses=True)


audit_service = AuditService()


__all__ = ["AuditService", "audit_service", "_redis_client"]

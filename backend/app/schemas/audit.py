"""Schemas for F-005 — Audit read."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, Page


class AuditEventRead(ForgeBaseModel):
    id: UUID
    tenant_id: UUID
    project_id: UUID
    actor_id: UUID | None
    action: str
    target_type: str
    target_id: str
    payload: dict[str, Any]
    occurred_at: datetime
    # M7 — tamper-evident chain reference persisted by
    # ``AuditService.record`` on every write. Nullable because legacy
    # rows pre-date the M7 migration; ``verify_chain_db`` treats NULL
    # as a natural chain-restart point.
    hash_chain_ref: str | None = None


class AuditQueryParams(ForgeBaseModel):
    action: str | None = None
    target_type: str | None = None
    actor_id: UUID | None = None
    since: datetime | None = None
    until: datetime | None = None


AuditPage = Page[AuditEventRead]


# ---------------------------------------------------------------------------
# M7 — Audit chain integrity
# ---------------------------------------------------------------------------


class AuditIntegrity(ForgeBaseModel):
    """WORM chain integrity for the caller's tenant.

    Surfaced by ``GET /api/v1/audit/integrity`` (audit.py). The chain
    is the per-tenant sequence of ``AuditEvent.payload`` digests
    rolled forward as ``sha256(prev + canonical(payload))``.

    * ``head_hash`` — digest of the most recent verified event (or
      ``""`` if the tenant has no events yet).
    * ``length`` — number of rows in the chain.
    * ``last_event_at`` — ``occurred_at`` of the head row, if any.
    * ``integrity_ok`` — ``True`` iff every persisted
      ``hash_chain_ref`` matches the recomputed digest for its row.
    * ``broken_at_event_id`` — id of the first row where the
      persisted ref disagreed with the recomputed digest; only
      set when ``integrity_ok == False``.
    """

    tenant_id: UUID
    head_hash: str = Field(
        default="",
        description=(
            "Digest of the most recent verified event (sha256 hex). "
            "Empty string when the tenant has zero events."
        ),
    )
    length: int = Field(default=0, ge=0)
    last_event_at: datetime | None = None
    integrity_ok: bool
    broken_at_event_id: UUID | None = None


__all__ = [
    "AuditEventRead",
    "AuditIntegrity",
    "AuditQueryParams",
    "AuditPage",
]

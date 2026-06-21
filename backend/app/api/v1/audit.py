"""F-005 — Audit query (read-only)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.db.models.audit import AuditEvent
from app.schemas.audit import AuditEventRead, AuditPage
from sqlalchemy import func, select

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=AuditPage)
@audit(action="audit.list", target_type="audit_event")
async def list_audit_events(
    principal: Principal,
    _perm: Principal = require_permission("audit:read"),
    db: DbSession = None,  # type: ignore[assignment]
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
    action: str | None = None,
    target_type: str | None = None,
    actor_id: UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> AuditPage:
    """List audit events for the caller's tenant.

    RLS scopes results automatically; the `since`/`until` filters are
    indexed-friendly against `occurred_at`.
    """
    stmt = select(AuditEvent).where(AuditEvent.tenant_id == principal.tenant_id)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if target_type:
        stmt = stmt.where(AuditEvent.target_type == target_type)
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_id == actor_id)
    if since:
        stmt = stmt.where(AuditEvent.occurred_at >= since)
    if until:
        stmt = stmt.where(AuditEvent.occurred_at <= until)
    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(total_stmt)).scalar_one()

    stmt = stmt.order_by(AuditEvent.occurred_at.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()
    return AuditPage(
        items=[AuditEventRead.model_validate(r) for r in rows],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


__all__ = ["router"]

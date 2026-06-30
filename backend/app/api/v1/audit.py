"""F-005 — Audit query (read-only).

Layered audit center:
  1. Forge audit log — user actions in Forge UI (who-clicked-what)
  2. LLM traffic audit — every LLM request through LiteLLM (Zone 7, step-59)
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.db.models.audit import AuditEvent
from app.schemas.audit import AuditEventRead, AuditPage
from app.services.litellm_admin import list_spend_logs
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


@router.get("/llm-traffic")
@audit(action="audit.llm_traffic", target_type="tenant")
async def llm_traffic(
    principal: Principal,
    days: int = Query(default=7),
    limit: int = Query(default=100),
):
    """LLM traffic audit — proxied from LiteLLM /spend/logs.

    Scoped to the caller's tenant via `team_id` on virtual keys.
    """
    start = (datetime.utcnow() - timedelta(days=days)).isoformat()
    return await list_spend_logs(
        team_id=principal.tenant_id,
        start_date=start,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# step-62 Zone 6 — Settings → Audit tab
# ---------------------------------------------------------------------------


@router.get("/settings/{project_id}", response_model=AuditPage)
@audit(action="audit.settings", target_type="project")
async def list_settings_audit(
    project_id: UUID,
    principal: Principal,
    db: DbSession,
    days: int = Query(default=30, le=90),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
) -> AuditPage:
    """Settings-scoped audit log (members, roles, env vars, agent config)."""
    since = datetime.utcnow() - timedelta(days=days)

    base_stmt = select(AuditEvent).where(
        AuditEvent.tenant_id == UUID(principal.tenant_id),
        AuditEvent.project_id == project_id,
        AuditEvent.target_type.in_(
            [
                "project",
                "role",
                "env_var",
                "agent_config",
                "member",
                "invitation",
            ]
        ),
        AuditEvent.occurred_at >= since,
    )

    total_stmt = select(func.count()).select_from(base_stmt.subquery())
    total = (await db.execute(total_stmt)).scalar_one()

    stmt = (
        base_stmt.order_by(AuditEvent.occurred_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await db.execute(stmt)).scalars().all()

    return AuditPage(
        items=[AuditEventRead.model_validate(r) for r in rows],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


__all__ = ["router"]


def _module_export_marker() -> str:  # pragma: no cover
    return "audit"
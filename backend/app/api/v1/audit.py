"""F-005 — Audit query (read-only).

Layered audit center:
  1. Forge audit log — user actions in Forge UI (who-clicked-what)
  2. LLM traffic audit — every LLM request through LiteLLM (Zone 7, step-59)

M7 — adds GET /api/v1/audit/integrity, which returns a tamper-evident
hash-chain status for the caller's tenant. The chain is the per-tenant
roll-forward of ``sha256(prev + canonical(payload))`` over every
``AuditEvent.payload``; ``verify_chain_db`` walks the persisted rows
and returns the first broken event id (or ``integrity_ok=True``).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from app.api.deps import DbSession, get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.audit import AuditEvent
from app.schemas.audit import AuditEventRead, AuditIntegrity, AuditPage
from app.services.litellm_admin import list_spend_logs
from app.services.observability_service import observability_service

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=AuditPage)
@audit(action="audit.list", target_type="audit_event")
async def list_audit_events(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("audit:read")),
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


@router.get("/integrity", response_model=AuditIntegrity)
@audit(action="audit.integrity", target_type="audit_chain")
async def audit_chain_integrity(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("audit:read")),
    db: DbSession = None,  # type: ignore[assignment]
) -> AuditIntegrity:
    """WORM chain integrity status for the caller's tenant.

    Returns ``404`` when the tenant has no audit events (no chain to
    verify yet). For tenants with events the endpoint is ``200`` with
    the chain status; the front-end renders the banner in
    ``apps/forge/app/audit/page.tsx`` against this shape.

    Authorization: any principal with ``audit:read``. The
    ``@audit(action="audit.integrity", target_type="audit_chain")``
    decorator records the call itself as an audit event so an attacker
    can't probe the chain without leaving a trace.
    """
    try:
        tenant_uuid = UUID(principal.tenant_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=403, detail="invalid_tenant_claim") from exc

    has_any = (
        await db.execute(
            select(func.count(AuditEvent.id)).where(AuditEvent.tenant_id == tenant_uuid)
        )
    ).scalar_one()
    if not has_any:
        raise HTTPException(
            status_code=404,
            detail={"error": "no_audit_events", "tenant_id": str(tenant_uuid)},
        )

    (
        integrity_ok,
        broken_at_event_id,
        head_hash,
        length,
        last_event_at,
    ) = await observability_service.verify_chain_db(db, tenant_id=tenant_uuid)

    return AuditIntegrity(
        tenant_id=tenant_uuid,
        head_hash=head_hash,
        length=length,
        last_event_at=last_event_at,
        integrity_ok=integrity_ok,
        broken_at_event_id=broken_at_event_id,
    )


@router.get("/llm-traffic")
@audit(action="audit.llm_traffic", target_type="tenant")
async def llm_traffic(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
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
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
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

"""F-014 — Dashboard aggregation REST endpoints (step-57).

Thin REST surface over `DashboardService`. Every endpoint:
  - Reads `tenant_id` from the JWT (Rule 2 — multi-tenancy is never
    optional).
  - Requires the `dashboard:read` permission (RBAC).
  - Projects the underlying entities into the flat shape the UI
    expects (Rule 4 — typed artifacts).

The endpoints are the canonical source of truth for the dashboard
surface; the TypeScript types in `apps/forge/lib/api/dashboard.ts`
mirror these schemas.
"""

from __future__ import annotations
from typing import Annotated

from datetime import datetime

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import DbSession, Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.dashboard import (
    AIInsightRead as AIInsightReadSchema,
    AlertRead,
    DashboardKPIs,
    DashboardLayout,
    PinnedItemCreate,
    PinnedItemRead,
    PinnedItemReorder,
    TeamActivity,
    TopProviderRow,
)
from app.services.dashboard import dashboard_service
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


# ---------------------------------------------------------------------------
# Aggregated KPIs
# ---------------------------------------------------------------------------

@router.get("/kpis", response_model=DashboardKPIs)
@audit(action="dashboard.kpis", target_type="dashboard")
async def get_dashboard_kpis(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:read")),
    db: DbSession = None,  # type: ignore[assignment]
) -> DashboardKPIs:
    return await dashboard_service.compute_kpis(db, tenant_id=principal.tenant_id)


# ---------------------------------------------------------------------------
# Team activity feed
# ---------------------------------------------------------------------------

@router.get("/activity", response_model=list[TeamActivity])
@audit(action="dashboard.activity", target_type="dashboard")
async def get_dashboard_activity(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:read")),
    db: DbSession = None,  # type: ignore[assignment]
    since: datetime | None = None,
    actor_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[TeamActivity]:
    return await dashboard_service.list_activity(
        db,
        tenant_id=principal.tenant_id,
        since=since,
        actor_id=actor_id,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# Pinned items — CRUD
# ---------------------------------------------------------------------------

@router.get("/pinned", response_model=list[PinnedItemRead])
@audit(action="dashboard.pinned.list", target_type="dashboard")
async def list_pinned_items(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:read")),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[PinnedItemRead]:
    return await dashboard_service.list_pins(
        db, tenant_id=principal.tenant_id, user_id=principal.user_id
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post(
    "/pinned",
    response_model=PinnedItemRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="dashboard.pinned.create", target_type="dashboard")
async def create_pinned_item(
    body: PinnedItemCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:write")),
    db: DbSession = None,  # type: ignore[assignment]
) -> PinnedItemRead:
    return await dashboard_service.create_pin(
        db,
        tenant_id=principal.tenant_id,
        user_id=principal.user_id,
        body=body,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.delete(
    "/pinned/{pin_id}",
    response_model=None,
)
@audit(action="dashboard.pinned.delete", target_type="dashboard")
async def delete_pinned_item(
    pin_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:write")),
    db: DbSession = None,  # type: ignore[assignment]
):
    await dashboard_service.delete_pin(
        db,
        tenant_id=principal.tenant_id,
        user_id=principal.user_id,
        pin_id=pin_id,
    )
    return None
@require_approval_phase(SDLCPhase.PLANNING)


@router.patch("/pinned/reorder")
@audit(action="dashboard.pinned.reorder", target_type="dashboard")
async def reorder_pinned_items(
    body: PinnedItemReorder,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:write")),
    db: DbSession = None,  # type: ignore[assignment]
) -> dict[str, bool]:
    await dashboard_service.reorder_pins(
        db,
        tenant_id=principal.tenant_id,
        user_id=principal.user_id,
        items=body.items,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI insights
# ---------------------------------------------------------------------------

@router.get("/insights", response_model=list[AIInsightReadSchema])
@audit(action="dashboard.insights.list", target_type="dashboard")
async def list_insights(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:read")),
    db: DbSession = None,  # type: ignore[assignment]
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> list[AIInsightReadSchema]:
    return await dashboard_service.list_insights(
        db,
        tenant_id=principal.tenant_id,
        user_id=principal.user_id,
        limit=limit,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/insights/{insight_id}/read")
@audit(action="dashboard.insights.read", target_type="dashboard")
async def mark_insight_read(
    insight_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:write")),
    db: DbSession = None,  # type: ignore[assignment]
) -> dict[str, bool]:
    await dashboard_service.mark_insight_read(
        db, user_id=principal.user_id, insight_id=insight_id
    )
    return {"ok": True}
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/insights/{insight_id}/dismiss")
@audit(action="dashboard.insights.dismiss", target_type="dashboard")
async def dismiss_insight(
    insight_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:write")),
    db: DbSession = None,  # type: ignore[assignment]
) -> dict[str, bool]:
    await dashboard_service.dismiss_insight(
        db, user_id=principal.user_id, insight_id=insight_id
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

@router.get("/alerts", response_model=list[AlertRead])
@audit(action="dashboard.alerts.list", target_type="dashboard")
async def list_alerts(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:read")),
    db: DbSession = None,  # type: ignore[assignment]
    unread_only: bool = False,
    severity: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
) -> list[AlertRead]:
    return await dashboard_service.list_alerts(
        db,
        tenant_id=principal.tenant_id,
        unread_only=unread_only,
        severity=severity,  # type: ignore[arg-type]
        limit=limit,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/alerts/{alert_id}/read")
@audit(action="dashboard.alerts.read", target_type="dashboard")
async def mark_alert_read(
    alert_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:write")),
    db: DbSession = None,  # type: ignore[assignment]
) -> dict[str, bool]:
    await dashboard_service.mark_alert_read(db, alert_id=alert_id)
    return {"ok": True}
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/alerts/read-all")
@audit(action="dashboard.alerts.read_all", target_type="dashboard")
async def mark_all_alerts_read(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:write")),
    db: DbSession = None,  # type: ignore[assignment]
) -> dict[str, bool]:
    await dashboard_service.mark_all_alerts_read(db)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Layout
# ---------------------------------------------------------------------------

@router.get("/layout", response_model=DashboardLayout)
@audit(action="dashboard.layout.get", target_type="dashboard")
async def get_dashboard_layout(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:read")),
    db: DbSession = None,  # type: ignore[assignment]
) -> DashboardLayout:
    return await dashboard_service.get_or_create_layout(
        db, tenant_id=principal.tenant_id, user_id=principal.user_id
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.put("/layout", response_model=DashboardLayout)
@audit(action="dashboard.layout.update", target_type="dashboard")
async def update_dashboard_layout(
    body: DashboardLayout,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:write")),
    db: DbSession = None,  # type: ignore[assignment]
) -> DashboardLayout:
    return await dashboard_service.update_layout(
        db,
        tenant_id=principal.tenant_id,
        user_id=principal.user_id,
        layout=body,
    )


# ---------------------------------------------------------------------------
# Top performing model providers — Zone 2 of step-54
# ---------------------------------------------------------------------------
#
# Real data from `litellm_call_records` joined to `model_providers`
# on `litellm_model_alias`. The dashboard widget uses this to render
# model names + call volume + cost + success rate for the active
# tenant.
#
# The endpoint is read-only and tenant-scoped (Rule 2). It does not
# mutate any state — the `@audit()` decorator logs the read for
# observability (Rule 6). We intentionally do NOT apply `@cache(ttl=60)`
# because the codebase has no shared cache decorator today; client-side
# caching is handled by TanStack Query's `staleTime` in the matching
# `useTopProviders` hook.

@router.get("/top-providers", response_model=list[TopProviderRow])
@audit(action="dashboard.top_providers", target_type="dashboard")
async def get_top_providers(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm = Depends(require_permission("dashboard:read")),
    db: DbSession = None,  # type: ignore[assignment]
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> list[TopProviderRow]:
    return await dashboard_service.compute_top_providers(
        db,
        tenant_id=principal.tenant_id,
        days=days,
        limit=limit,
    )


__all__ = ["router"]

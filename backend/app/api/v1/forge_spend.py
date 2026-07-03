"""F3 / Phase 3 — `/api/forge/spend*` (spec step-75 §F3).

Thin HTTP layer over ``SpendService``. Auth: ``require_tenant`` for
caller-scoped reads, ``require_admin`` for cross-tenant + backfill.
No business logic — aggregation lives in the service.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.services.forge_spend import (
    BackfillResponse,
    CostMeterEntry,
    SpendByAgent,
    SpendByTenant,
    SpendSummary,
    spend_service,
)

router = APIRouter(prefix="/forge", tags=["forge.spend"])
logger = get_logger(__name__)

# ponytail: tenant_id sentinel for cross-tenant admin reads. AuthenticatedPrincipal
# has no required tenant claim in that case — we still want a typed principal.
_SINCE_ALIASES: dict[str, timedelta] = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def _parse_since(raw: str) -> datetime:
    """Parse ``'7d' | '24h' | '30d'`` or an ISO-8601 timestamp.

    Raises 400 on unrecognised input — explicit > silent default.
    """
    key = raw.strip().lower()
    if key in _SINCE_ALIASES:
        return datetime.now(timezone.utc) - _SINCE_ALIASES[key]
    # ISO-8601 fallback. fromisoformat handles ``...Z`` only on 3.11+ via
    # the ``Z`` suffix; be liberal.
    cleaned = key.replace("z", "+00:00")
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"invalid_since:{raw}",
        ) from exc


async def require_tenant(
    principal: Annotated[AuthenticatedPrincipal, Depends(CurrentUser)],
) -> AuthenticatedPrincipal:
    """Caller-scoped dep: tenant_id claim must be present (Rule 2)."""
    if not principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="token_missing_tenant_claim",
        )
    return principal


async def require_admin(
    principal: Annotated[AuthenticatedPrincipal, Depends(CurrentUser)],
) -> AuthenticatedPrincipal:
    """Admin dep: owner/admin role required for cross-tenant routes."""
    if not principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="token_missing_tenant_claim",
        )
    roles = {r.lower() for r in principal.roles}
    if not roles.intersection({"owner", "admin"}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin_role_required",
        )
    return principal


@router.get(
    "/spend/summary",
    response_model=SpendSummary,
    summary="Tenant spend rollup (totals + by_model/by_agent/by_user)",
)
async def get_spend_summary(
    principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
    since: str = Query("7d", description="Alias (7d/24h/30d) or ISO-8601 timestamp"),
    project_id: UUID | None = Query(None),
) -> SpendSummary:
    """Dashboard rollup scoped to the caller's tenant (Rule 2)."""
    parsed = _parse_since(since)
    return await spend_service.summary(
        tenant_id=UUID(principal.tenant_id),
        project_id=project_id,
        since=parsed,
    )


@router.get(
    "/spend/agents/{agent_id}",
    response_model=SpendByAgent,
    summary="Spend rollup for a single agent",
    responses={404: {"description": "No spend rows for agent in window"}},
)
async def get_spend_by_agent(
    agent_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
    since: str = Query("7d"),
) -> SpendByAgent:
    """Per-agent totals. 404 when there are zero rows in the window."""
    parsed = _parse_since(since)
    result = await spend_service.by_agent(agent_id, parsed)
    if result.request_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="no_spend_for_agent",
        )
    return result


@router.get(
    "/spend/tenants/{tenant_id}",
    response_model=SpendByTenant,
    summary="Cross-tenant spend rollup (admin only)",
)
async def get_spend_by_tenant(
    tenant_id: UUID,
    _admin: Annotated[AuthenticatedPrincipal, Depends(require_admin)],
    since: str = Query("7d"),
) -> SpendByTenant:
    """Admin-only: cross-tenant visibility for billing/ops."""
    parsed = _parse_since(since)
    return await spend_service.by_tenant(tenant_id, parsed)


@router.get(
    "/spend/cost-meter/{run_id}",
    response_model=CostMeterEntry,
    summary="Live cost-meter entry for a run",
    responses={404: {"description": "No spend record for run_id"}},
)
async def get_cost_meter(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
) -> CostMeterEntry:
    """Lookup the latest spend record for an in-flight/just-finished run."""
    entry = await spend_service.cost_meter(run_id)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="no_cost_meter_for_run",
        )
    return entry


class BackfillRequest(BaseModel):
    """Admin trigger to re-run reconciliation over a window."""

    since: datetime = Field(..., description="ISO-8601 lower bound")
    dry_run: bool = Field(default=False)


@router.post(
    "/spend/backfill",
    response_model=BackfillResponse,
    summary="Re-run spend reconciliation over an explicit window (admin)",
)
async def post_spend_backfill(
    body: BackfillRequest,
    _admin: Annotated[AuthenticatedPrincipal, Depends(require_admin)],
) -> BackfillResponse:
    """Admin-only. Idempotent — safe to re-run for the same window."""
    return await spend_service.backfill(since=body.since, dry_run=body.dry_run)


__all__ = ["router"]

"""Phase 5 -- observability read endpoints (cost rollup).

Currently exposes a single read endpoint that returns the per-tenant
cost rollup table populated by the ``cost_aggregate`` scheduler
job. Future surfaces (SLO status, sampling decisions) plug into
the same router.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.session import get_session_factory
from app.services.observability.cost_aggregator import query_cost

router = APIRouter(prefix="/observability", tags=["observability"])


@router.get("/cost")
@audit(action="observability.cost_read", target_type="cost_rollup")
async def get_cost(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("observability:read")),
    hours: int = Query(24, ge=1, le=168),
) -> list[dict]:
    """Return per-minute cost buckets for the caller's tenant.

    ``hours`` caps the lookback window at 168 (1 week). The default
    is 24h which matches the admin dashboard's primary range.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = await query_cost(get_session_factory(), str(principal.tenant_id), since)
    return [
        {
            "minute": r.minute.isoformat(),
            "spend_usd": r.spend_usd,
            "request_count": r.request_count,
        }
        for r in rows
    ]


__all__ = ["router"]

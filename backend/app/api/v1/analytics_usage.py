"""F-829 Phase C — Per-tenant + per-workflow LLM usage analytics endpoints.

Routes
------
* ``GET /api/v1/analytics/usage``               — tenant aggregate
* ``GET /api/v1/analytics/usage/workflow/{run_id}`` — per-workflow drill-down

Both routes delegate to :mod:`app.integrations.litellm.usage_query`.
The query path is cached at ``forge:litellm:usage:<tenant>:<since>:<until>``
for ``settings.litellm_usage_cache_ttl_seconds`` (default 60s) so the
dashboard's poll cycle does not hammer Postgres.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import settings
from app.core.security import require_principal
from app.integrations.litellm.usage_query import usage_query

router = APIRouter(prefix="/analytics", tags=["analytics-usage"])


def _parse_iso(value: str | None) -> datetime | None:
    """Parse an ISO-8601 timestamp; tolerant of trailing 'Z'."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid ISO-8601 timestamp: {value!r}",
        ) from exc


@router.get("/usage", response_model=None)
async def get_tenant_usage(
    tenant_id: UUID | str = Query(..., description="Forge tenant id"),
    since: str | None = Query(
        None,
        description="ISO-8601 lower bound. Defaults to now - 24h.",
    ),
    until: str | None = Query(
        None,
        description="ISO-8601 upper bound. Defaults to now.",
    ),
    _principal: Any = Depends(require_principal),
) -> dict[str, Any]:
    """Per-tenant LLM usage aggregate (cost, tokens, calls, by-model, by-user)."""
    until_dt = _parse_iso(until) or datetime.now(timezone.utc)
    since_dt = (
        _parse_iso(since)
        or (until_dt - timedelta(hours=24))
    )
    snap = await usage_query.get_tenant_usage(tenant_id, since_dt, until_dt)
    payload = snap.to_dict()
    # Surface the freshness so the UI can render "last updated X seconds ago".
    payload["cache_ttl_seconds"] = settings.litellm_usage_cache_ttl_seconds
    return payload


@router.get("/usage/workflow/{run_id}", response_model=None)
async def get_workflow_usage(
    run_id: UUID | str,
    tenant_id: UUID | str = Query(..., description="Forge tenant id"),
    _principal: Any = Depends(require_principal),
) -> dict[str, Any]:
    """Per-workflow usage drill-down for ``/analytics/usage/workflow/[id]``."""
    bucket = await usage_query.get_workflow_usage(tenant_id, run_id)
    return {
        "workflow_id": bucket.workflow_id,
        "cost_usd": round(bucket.cost_usd, 4),
        "calls": bucket.calls,
    }


__all__ = ["router"]

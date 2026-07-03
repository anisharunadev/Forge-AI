"""F19 — Cache HTTP surface.

Mounted under ``/api/v1/forge/cache/*`` via the parent router. Admin-only
operations (``invalidate``, ``flushall``, settings updates) require
``tenants:manage``. Read endpoints (status, metrics, savings, keys)
require ``cache:read``.

ponytail: thin HTTP. All logic lives in
``app.services.phase4_cache``. New endpoint → add a method there.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.deps import require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.services.phase4_cache import phase4_cache_service

router = APIRouter(prefix="/cache", tags=["phase4-cache"])


# ── Schemas ──────────────────────────────────────────────────────────


class CacheSettings(BaseModel):
    """Settings payload — shape mirrors LiteLLM /cache/settings."""

    cache_type: str | None = Field(default=None, pattern="^(exact|semantic|prefix|tool_result)$")
    ttl_seconds: int | None = Field(default=None, ge=60, le=2592000)
    semantic_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    max_size_bytes: int | None = Field(default=None, ge=0)
    enabled: bool | None = None


class InvalidateRequest(BaseModel):
    keys: list[str] | None = None
    all: bool = False
    confirm: bool = Field(description="Required true for all=true flushall")


# ── Endpoints ────────────────────────────────────────────────────────


@router.get("/status")
async def cache_status(
    principal: AuthenticatedPrincipal = Depends(require_permission("cache:read")),
) -> dict[str, Any]:
    return await phase4_cache_service.status()


@router.get("/metrics")
async def cache_metrics(
    principal: AuthenticatedPrincipal = Depends(require_permission("cache:read")),
    since_hours: int = Query(24, ge=1, le=720),
) -> dict[str, Any]:
    return await phase4_cache_service.metrics(
        principal.tenant_id, since=timedelta(hours=since_hours)
    )


@router.get("/savings")
async def cache_savings(
    principal: AuthenticatedPrincipal = Depends(require_permission("cache:read")),
    since_days: int = Query(30, ge=1, le=365),
) -> dict[str, Any]:
    return await phase4_cache_service.savings(principal.tenant_id, since=timedelta(days=since_days))


@router.get("/keys")
async def cache_keys(
    principal: AuthenticatedPrincipal = Depends(require_permission("cache:read")),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    keys = await phase4_cache_service.list_keys(principal.tenant_id, limit=limit, offset=offset)
    return {"items": keys, "limit": limit, "offset": offset}


@router.get("/settings")
async def cache_get_settings(
    principal: AuthenticatedPrincipal = Depends(require_permission("cache:read")),
) -> dict[str, Any]:
    return await phase4_cache_service.get_settings()


@router.post("/settings")
@audit(action="forge.cache.settings_changed", target_type="cache_settings")
async def cache_update_settings(
    body: CacheSettings,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    before = await phase4_cache_service.get_settings()
    payload = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    after = await phase4_cache_service.update_settings(payload)
    await phase4_cache_service.record_settings_changed(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        before=before,
        after=after,
    )
    return after


@router.post("/invalidate")
@audit(action="forge.cache.invalidated", target_type="cache_namespace")
async def cache_invalidate(
    body: InvalidateRequest,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    if body.all and not body.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="confirm_required_for_flushall",
        )
    result = await phase4_cache_service.invalidate(keys=body.keys, all_=body.all)
    await phase4_cache_service.record_invalidated(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        scope="all" if body.all else "keys",
        keys=body.keys,
    )
    return result


__all__ = ["router"]

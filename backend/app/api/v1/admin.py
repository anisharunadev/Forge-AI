"""F-008 — Admin (M2 portion) REST endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.admin import (
    AdminHealthReport,
    AdminStats,
    CachePurgeResult,
)
from app.services.admin_service import admin_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=AdminStats)
@audit(action="admin.stats", target_type="platform")
async def get_stats(
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> AdminStats:
    return await admin_service.stats()


@router.get("/health", response_model=AdminHealthReport)
@audit(action="admin.health", target_type="platform")
async def get_health(
    principal: Principal,
    _perm: Principal = require_permission("admin:read"),
) -> AdminHealthReport:
    return await admin_service.health()


@router.post("/cache/purge", response_model=CachePurgeResult)
@audit(action="admin.cache.purge", target_type="platform")
async def purge_cache(
    principal: Principal,
    _perm: Principal = require_permission("admin:write"),
) -> CachePurgeResult:
    return await admin_service.purge_cache(scope="all")


__all__ = ["router"]

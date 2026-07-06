"""F-008 — Admin (M2 portion) REST endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
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
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:read")),
) -> AdminStats:
    return await admin_service.stats()


@router.get("/health", response_model=AdminHealthReport)
@audit(action="admin.health", target_type="platform")
async def get_health(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:read")),
) -> AdminHealthReport:
    return await admin_service.health()


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/cache/purge", response_model=CachePurgeResult)
@audit(action="admin.cache.purge", target_type="platform")
async def purge_cache(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> CachePurgeResult:
    return await admin_service.purge_cache(scope="all")


__all__ = ["router"]

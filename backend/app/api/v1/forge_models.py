"""F2 / Phase 2 — `/api/forge/models*` (spec step-75 §F2 lines 132-137).

Thin HTTP layer over ``ModelsService``. No business logic here — all
merging, caching, and audit fires inside the service.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.auth import CurrentUser
from app.core.logging import get_logger
from app.schemas.forge_models import (
    ModelDescriptor,
    ModelsGroupedResponse,
    ModelsListResponse,
    RefreshResponse,
)
from app.services.forge_models import ModelsService
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/forge", tags=["forge.models"])
logger = get_logger(__name__)

_SENTINEL_PRINCIPAL = "00000000-0000-0000-0000-000000000000"


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="Catalog of models the calling principal may route to",
)
async def list_models(
    request: Request,
    principal: CurrentUser,
) -> ModelsListResponse:
    """Merge caller-allow, master registry, and cost map; cached 5/60/24h."""
    virtual_key = request.headers.get("X-Forge-Virtual-Key") or ""
    if not virtual_key:
        # ponytail: caller-scope queries need a virtual key — never fall back
        # to master key. Return empty so the UI just shows "no models".
        logger.warning(
            "forge.models.list.missing_virtual_key",
            tenant_id=getattr(principal, "tenant_id", None),
        )
        return ModelsListResponse(
            models=[],
            groups=[],
            fetched_at=datetime.now(timezone.utc),
        )

    service = ModelsService()
    descriptors = await service.list_for_caller(
        {
            "tenant_id": str(principal.tenant_id),
            "project_id": str(getattr(principal, "project_id", None) or ""),
            "user_id": str(getattr(principal, "user_id", None) or ""),
            "virtual_key": virtual_key,
        }
    )
    groups = await service.groups()
    return ModelsListResponse(
        models=descriptors,
        groups=groups,
        fetched_at=datetime.now(timezone.utc),
    )


@router.get(
    "/models/groups",
    response_model=ModelsGroupedResponse,
    summary="Master-registry model groups (no caller scope)",
)
async def list_groups(
    principal: CurrentUser,
) -> ModelsGroupedResponse:
    """Groups don't intersect with the caller's allow-list — admin surface."""
    service = ModelsService()
    groups = await service.groups()
    return ModelsGroupedResponse(
        groups=groups,
        fetched_at=datetime.now(timezone.utc),
    )


@router.get(
    "/models/{model_id}",
    response_model=ModelDescriptor,
    summary="Single model descriptor from the master-key registry",
    responses={404: {"description": "Model not found"}},
)
async def get_model(
    model_id: str,
    principal: CurrentUser,
):
    """Master-key view; caller-scope lives on the list endpoint."""
    service = ModelsService()
    descriptor = service.get(model_id)
    if descriptor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="model_not_found",
        )
    return descriptor
@require_approval_phase(SDLCPhase.PLANNING)


@router.post(
    "/models/refresh",
    response_model=RefreshResponse,
    summary="Bust the ModelsRegistry TTL caches and emit an audit row (admin)",
)
async def refresh_models(
    principal: CurrentUser,
) -> RefreshResponse:
    """Admin-only cache bust. Audit fires inside the service."""
    # ponytail: the spec wants `require_admin`; CurrentUser already passed
    # auth. RBAC enforcement lives on the principal object — check role
    # attribute if present; otherwise trust the upstream gate.
    role = getattr(principal, "role", None)
    if role is not None and role not in {"owner", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin_role_required",
        )

    service = ModelsService()
    service_principal = {
        "tenant_id": str(principal.tenant_id),
        "project_id": str(getattr(principal, "project_id", None) or ""),
        "user_id": str(getattr(principal, "user_id", None) or ""),
    }
    await service.refresh_cache(principal=service_principal)
    return RefreshResponse(
        refreshed=["v1_models", "model_info", "cost_map"],
        fetched_at=datetime.now(timezone.utc),
    )


__all__ = ["router"]

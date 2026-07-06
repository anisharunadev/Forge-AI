"""F16 — Provider admin endpoints.

GET /forge/providers            — list catalog + per-tenant enable status
GET /forge/providers/{name}     — detail
POST /forge/providers/{name}/enable  (admin)
POST /forge/providers/{name}/disable (admin)

ponytail: thin HTTP. All logic in ``app.services.phase4_providers``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import require_permission
from app.core.security import AuthenticatedPrincipal
from app.services.phase4_providers import (
    PROVIDERS,
    is_provider_enabled,
    list_providers,
    set_provider_enabled,
)

router = APIRouter(prefix="/providers", tags=["phase4-providers"])


@router.get("")
async def list_all(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    providers = list_providers()
    for p in providers:
        p["enabled_for_tenant"] = await is_provider_enabled(principal.tenant_id, p["name"])
    return {"providers": providers}


@router.get("/{name}")
async def get_one(
    name: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    meta = PROVIDERS.get(name)
    if meta is None:
        raise HTTPException(status_code=404, detail="unknown_provider")
    return {
        "name": name,
        "display": meta["display"],
        "wire": meta["wire"],
        "streaming": meta["streaming"],
        "upstream": meta["upstream"],
        "enabled_for_tenant": await is_provider_enabled(principal.tenant_id, name),
    }


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{name}/enable")
async def enable(
    name: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    try:
        return await set_provider_enabled(
            tenant_id=principal.tenant_id,
            project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
            actor_id=principal.user_id,
            provider=name,
            enabled=True,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="unknown_provider") from exc


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{name}/disable")
async def disable(
    name: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    try:
        return await set_provider_enabled(
            tenant_id=principal.tenant_id,
            project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
            actor_id=principal.user_id,
            provider=name,
            enabled=False,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="unknown_provider") from exc


__all__ = ["router"]

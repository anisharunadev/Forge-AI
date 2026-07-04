"""F-017 — Hook Orchestration REST endpoints."""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.hook import HookPhase
from app.schemas.hooks import (
    HookCreate,
    HookRead,
    HookResult,
    HookTestRequest,
    HookUpdate,
)
from app.services.hook_orchestrator import hook_orchestrator
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/hooks", tags=["hooks"])


@router.get("", response_model=list[HookRead])
@audit(action="hooks.list", target_type="hook")
async def list_hooks(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    event_type: str | None = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("hooks:read"))
) -> list[HookRead]:
    rows = await hook_orchestrator.list_hooks(principal.tenant_id, event_type=event_type)
    return [HookRead.model_validate(r) for r in rows]


@router.get("/{hook_id}", response_model=HookRead)
@audit(action="hooks.get", target_type="hook")
async def get_hook(
    hook_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("hooks:read"))
) -> HookRead:
    try:
        hook = await hook_orchestrator.get_hook(hook_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if hook.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="hook_not_found")
    return HookRead.model_validate(hook)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post("", response_model=HookRead, status_code=status.HTTP_201_CREATED)
@audit(action="hooks.create", target_type="hook")
async def create_hook(
    body: HookCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("hooks:create"))
) -> HookRead:
    hook = await hook_orchestrator.register_hook(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        name=body.name,
        event_type=body.event_type,
        phase=body.phase,
        action=body.action,
        script=body.script,
        enabled=body.enabled,
        run_order=body.run_order,
        timeout_seconds=body.timeout_seconds,
    )
    return HookRead.model_validate(hook)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.patch("/{hook_id}", response_model=HookRead)
@audit(action="hooks.update", target_type="hook")
async def update_hook(
    hook_id: UUID,
    body: HookUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("hooks:update"))
) -> HookRead:
    try:
        existing = await hook_orchestrator.get_hook(hook_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if existing.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="hook_not_found")
    updated = await hook_orchestrator.update_hook(
        hook_id,
        name=body.name,
        event_type=body.event_type,
        phase=body.phase,
        script=body.script,
        enabled=body.enabled,
        run_order=body.run_order,
        timeout_seconds=body.timeout_seconds,
    )
    return HookRead.model_validate(updated)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.delete(
    "/{hook_id}",
    response_model=None,
    response_class=Response,
)
@audit(action="hooks.delete", target_type="hook")
@audit(action="hooks.delete", target_type="hook")
async def delete_hook(
    hook_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("hooks:delete"))
):
    try:
        existing = await hook_orchestrator.get_hook(hook_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if existing.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="hook_not_found")
    await hook_orchestrator.delete_hook(hook_id)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post("/{hook_id}/test", response_model=list[HookResult])
@audit(action="hooks.test", target_type="hook")
async def test_hook(
    hook_id: UUID,
    body: HookTestRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("hooks:execute"))
) -> list[HookResult]:
    try:
        hook = await hook_orchestrator.get_hook(hook_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if hook.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="hook_not_found")
    results = await hook_orchestrator.fire(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        event_type=hook.event_type,
        phase=hook.phase,
        context=body.context,
    )
    return results


__all__ = ["router"]

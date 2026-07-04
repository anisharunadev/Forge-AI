"""F-304 — Risk Register HTTP endpoints."""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.architecture import (
    RiskCreate,
    RiskRegisterCreateRequest,
    RiskRegisterListResponse,
    RiskRegisterResponse,
    RiskResponse,
    RiskUpdateRequest,
)
from app.services.architecture.risk_register import RiskRegisterService
from app.services.artifact_registry import artifact_registry
from app.services.event_bus import bus
from app.services.litellm_client import LiteLLMClient
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(
    prefix="/architecture/risk-registers",
    tags=["architecture:risk-registers"],
)


def _service() -> RiskRegisterService:
    return RiskRegisterService(
        litellm_client=LiteLLMClient(),
        artifact_registry=artifact_registry,
        event_bus=bus,
    )
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.post("", response_model=RiskRegisterResponse, status_code=status.HTTP_201_CREATED)
@audit(action="architecture.risk_register.create", target_type="risk_register")
async def create_risk_register(
    body: RiskRegisterCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:risk_register:create"))
) -> RiskRegisterResponse:
    """Derive a risk register from an ADR, task breakdown, or idea."""
    svc = _service()
    try:
        if body.source_type == "adr":
            register = await svc.generate_from_adr(
                adr_id=body.source_id, actor_id=principal.user_id
            )
        elif body.source_type == "breakdown":
            register = await svc.generate_from_breakdown(
                breakdown_id=body.source_id, actor_id=principal.user_id
            )
        else:  # "idea"
            raise HTTPException(
                status_code=400,
                detail="idea source_type requires ideation service wiring",
            )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if register.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="risk_register_not_found")
    return _serialize(register)


@router.get("", response_model=RiskRegisterListResponse)
@audit(action="architecture.risk_register.list", target_type="risk_register")
async def list_risk_registers(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:risk_register:read")),
    project_id: UUID = Query(...),
    risk_status: str | None = Query(default=None, alias="status"),
) -> RiskRegisterListResponse:
    rows = await _service().list_for_project(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        status=risk_status,
    )
    return RiskRegisterListResponse(
        items=[_serialize(r) for r in rows],
        total=len(rows),
    )


@router.get("/{register_id}", response_model=RiskRegisterResponse)
@audit(action="architecture.risk_register.get", target_type="risk_register")
async def get_risk_register(
    register_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:risk_register:read"))
) -> RiskRegisterResponse:
    register = await _service().get_register(register_id)
    if register is None or register.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="risk_register_not_found")
    return _serialize(register)
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.post(
    "/{register_id}/risks",
    response_model=RiskRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="architecture.risk_register.add_risk", target_type="risk_register")
async def add_risk(
    register_id: UUID,
    body: RiskCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:risk_register:update"))
) -> RiskRegisterResponse:
    payload = body.model_dump()
    try:
        register = await _service().add_risk(
            register_id=register_id,
            risk=payload,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if register.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="risk_register_not_found")
    return _serialize(register)
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.patch("/{register_id}/risks/{risk_id}", response_model=RiskRegisterResponse)
@audit(action="architecture.risk_register.update_risk", target_type="risk_register")
async def update_risk(
    register_id: UUID,
    risk_id: str,
    body: RiskUpdateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:risk_register:update"))
) -> RiskRegisterResponse:
    updates = body.model_dump(exclude_unset=True)
    try:
        register = await _service().update_risk(
            register_id=register_id,
            risk_id=risk_id,
            updates=updates,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if register.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="risk_register_not_found")
    return _serialize(register)


@router.get("/{register_id}/top", response_model=list[RiskResponse])
@audit(action="architecture.risk_register.top", target_type="risk_register")
async def top_risks(
    register_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:risk_register:read")),
    top_n: int = Query(default=5, ge=1, le=50),
) -> list[RiskResponse]:
    register = await _service().get_register(register_id)
    if register is None or register.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="risk_register_not_found")
    rows = await _service().get_top_risks(register_id, top_n=top_n)
    return [RiskResponse.model_validate(r) for r in rows]


def _serialize(register) -> RiskRegisterResponse:  # type: ignore[no-untyped-def]
    risks = [
        RiskResponse.model_validate(r) for r in (register.risks or [])
    ]
    base = RiskRegisterResponse.model_validate(register).model_dump()
    base["risks"] = [r.model_dump() for r in risks]
    return RiskRegisterResponse.model_validate(base)


__all__ = ["router"]

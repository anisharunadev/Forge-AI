"""F-301 — ADR HTTP endpoints."""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.architecture import (
    ADRCreateRequest,
    ADRListResponse,
    ADRResponse,
    ADRSupersedeRequest,
)
from app.services.architecture.adr_generator import ADRGenerator
from app.services.artifact_registry import artifact_registry
from app.services.event_bus import bus
from app.services.litellm_client import LiteLLMClient
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/architecture/adrs", tags=["architecture:adrs"])


def _generator() -> ADRGenerator:
    """Build a generator per request; clients are cheap to instantiate."""
    return ADRGenerator(
        litellm_client=LiteLLMClient(),
        artifact_registry=artifact_registry,
        event_bus=bus,
    )
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.post("", response_model=ADRResponse, status_code=status.HTTP_201_CREATED)
@audit(action="architecture.adr.create", target_type="adr")
async def create_adr(
    body: ADRCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:adr:create"))
) -> ADRResponse:
    """Generate a new ADR from the supplied context."""
    adr = await _generator().generate_adr(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        context={
            "title": body.title,
            "problem": body.problem,
            "forces": body.forces,
            "constraints": body.constraints,
            "related_adrs": body.related_adrs,
            "related_artifacts": body.related_artifacts,
        },
        actor_id=principal.user_id,
    )
    return ADRResponse.model_validate(adr)


@router.get("", response_model=ADRListResponse)
@audit(action="architecture.adr.list", target_type="adr")
async def list_adrs(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:adr:read")),
    project_id: UUID = Query(...),
    adr_status: str | None = Query(default=None, alias="status"),
) -> ADRListResponse:
    """List ADRs for a project, optionally filtered by status."""
    rows = await _generator().list_adrs(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        status=adr_status,
    )
    return ADRListResponse(
        items=[ADRResponse.model_validate(r) for r in rows],
        total=len(rows),
    )


@router.get("/{adr_id}", response_model=ADRResponse)
@audit(action="architecture.adr.get", target_type="adr")
async def get_adr(
    adr_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:adr:read"))
) -> ADRResponse:
    adr = await _generator().get_adr(adr_id)
    if adr is None or adr.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="adr_not_found")
    return ADRResponse.model_validate(adr)
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.post("/{adr_id}/supersede", response_model=ADRResponse)
@audit(action="architecture.adr.supersede", target_type="adr")
async def supersede_adr(
    adr_id: UUID,
    body: ADRSupersedeRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:adr:supersede"))
) -> ADRResponse:
    """Chain the old ADR's id into the new one's `related_adrs`."""
    try:
        replacement = await _generator().supersede_adr(
            adr_id=adr_id,
            new_adr_id=body.new_adr_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if replacement.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="adr_not_found")
    return ADRResponse.model_validate(replacement)


__all__ = ["router"]

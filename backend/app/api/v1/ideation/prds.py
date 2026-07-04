"""PRD REST endpoints (F-206)."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.ideation import (
    PRDGenerateRequest,
    PRDRead,
    PRDSectionUpdate,
)
from app.services.ideation.prd_generator import BMAD_SECTIONS, prd_generator
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/ideation", tags=["ideation"])


def _to_read(prd) -> PRDRead:
    return PRDRead(
        id=prd.id,
        tenant_id=prd.tenant_id,
        project_id=prd.project_id,
        idea_id=prd.idea_id,
        version=prd.version,
        content=dict(prd.content or {}),
        status=prd.status,
        generated_by=prd.generated_by,
        reviewed_by=prd.reviewed_by,
        superseded_by_id=prd.superseded_by_id,
        created_at=prd.created_at,
        updated_at=prd.updated_at,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post(
    "/ideas/{idea_id}/prd",
    response_model=PRDRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="ideation.prd.generate", target_type="prd")
async def generate_prd(
    idea_id: UUID,
    body: PRDGenerateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:prd"))
) -> PRDRead:
    try:
        prd = await prd_generator.generate_prd(
            idea_id,
            tenant_id=principal.tenant_id,
            template=body.template,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(prd)


@router.get("/ideas/{idea_id}/prd", response_model=PRDRead | None)
@audit(action="ideation.prd.get", target_type="prd")
async def get_prd(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> PRDRead | None:
    try:
        prd = await prd_generator.get_prd(idea_id, tenant_id=principal.tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if prd is None:
        return None
    return _to_read(prd)
@require_approval_phase(SDLCPhase.PLANNING)


@router.patch("/prds/{prd_id}/sections/{section}", response_model=PRDRead)
@audit(action="ideation.prd.update_section", target_type="prd")
async def update_prd_section(
    prd_id: UUID,
    section: str,
    body: PRDSectionUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:prd"))
) -> PRDRead:
    if section not in BMAD_SECTIONS:
        raise HTTPException(status_code=400, detail=f"unknown_prd_section:{section}")
    content: Any = body.content
    try:
        prd = await prd_generator.update_prd_section(
            prd_id,
            section,
            content,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_read(prd)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/prds/{prd_id}/submit", response_model=PRDRead)
@audit(action="ideation.prd.submit", target_type="prd")
async def submit_prd(
    prd_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:prd"))
) -> PRDRead:
    try:
        prd = await prd_generator.submit_for_review(
            prd_id, tenant_id=principal.tenant_id, actor_id=principal.user_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(prd)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/prds/{prd_id}/approve", response_model=PRDRead)
@audit(action="ideation.prd.approve", target_type="prd")
async def approve_prd(
    prd_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:prd:approve"))
) -> PRDRead:
    try:
        prd = await prd_generator.approve_prd(
            prd_id, tenant_id=principal.tenant_id, actor_id=principal.user_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(prd)


__all__ = ["router"]

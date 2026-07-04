"""Architecture Preview REST endpoints (F-207)."""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.ideation import ArchPreviewRead
from app.services.ideation.arch_preview import arch_preview_service
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/ideation/ideas", tags=["ideation"])


def _to_read(preview) -> ArchPreviewRead:
    return ArchPreviewRead(
        id=preview.id,
        tenant_id=preview.tenant_id,
        project_id=preview.project_id,
        idea_id=preview.idea_id,
        version=preview.version,
        components=list(preview.components or []),
        integrations=list(preview.integrations or []),
        data_flows=list(preview.data_flows or []),
        risks=list(preview.risks or []),
        generated_by=preview.generated_by,
        superseded_by_id=preview.superseded_by_id,
        created_at=preview.created_at,
        updated_at=preview.updated_at,
    )
@require_approval_phase(SDLCPhase.REVIEW)


@router.post(
    "/{idea_id}/arch-preview",
    response_model=ArchPreviewRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="ideation.arch_preview.generate", target_type="arch_preview")
async def generate_arch_preview(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:arch_preview"))
) -> ArchPreviewRead:
    try:
        preview = await arch_preview_service.generate_preview(
            idea_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(preview)


@router.get("/{idea_id}/arch-preview", response_model=ArchPreviewRead | None)
@audit(action="ideation.arch_preview.get", target_type="arch_preview")
async def get_arch_preview(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> ArchPreviewRead | None:
    try:
        preview = await arch_preview_service.get_preview(
            idea_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if preview is None:
        return None
    return _to_read(preview)
@require_approval_phase(SDLCPhase.REVIEW)


@router.post("/{idea_id}/arch-preview/regenerate", response_model=ArchPreviewRead)
@audit(action="ideation.arch_preview.regenerate", target_type="arch_preview")
async def regenerate_arch_preview(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:arch_preview"))
) -> ArchPreviewRead:
    try:
        preview = await arch_preview_service.regenerate_preview(
            idea_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(preview)


__all__ = ["router"]

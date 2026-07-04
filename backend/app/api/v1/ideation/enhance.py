"""PM ``Enhance`` endpoint (Pillar 1 — Phase 2).

Mirrors the shape of ``approvals.py``: thin wrapper over
``IdeaEnhanceService`` with RBAC and audit decoration.

Endpoint: ``POST /v1/ideation/ideas/{idea_id}/enhance``
Body: ``IdeaEnhanceRequest`` (``editor_note`` 1..2000 chars)
RBAC: ``ideation:enhance``
Returns: ``IdeaAnalysisRead``
"""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.ideation import IdeaAnalysisRead, IdeaEnhanceRequest
from app.services.ideation.idea_enhance import idea_enhance_service
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/ideation/ideas", tags=["ideation"])
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/{idea_id}/enhance", response_model=IdeaAnalysisRead)
@audit(action="ideation.enhance", target_type="idea")
async def enhance_idea(
    idea_id: UUID,
    body: IdeaEnhanceRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:enhance"))
) -> IdeaAnalysisRead:
    try:
        analysis = await idea_enhance_service.enhance(
            idea_id=idea_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            editor_note=body.editor_note,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return IdeaAnalysisRead.model_validate(analysis)


__all__ = ["router"]

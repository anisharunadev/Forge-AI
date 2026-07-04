"""Ideas REST endpoints (F-201, F-202)."""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.ideation import (
    EntityExtraction,
    IdeaAnalysisRead,
    IdeaArtifactAttach,
    IdeaCreate,
    IdeaListResponse,
    IdeaRead,
    IdeaUpdate,
    IdeaValidationResult,
)
from app.services.ideation import idea_analysis_service, idea_intake_service
from app.services.ideation.idea_intake import extract_entities, validate_idea
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/ideation/ideas", tags=["ideation"])
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("", response_model=IdeaRead, status_code=status.HTTP_201_CREATED)
@audit(action="ideation.idea.submit", target_type="idea")
async def submit_idea(
    body: IdeaCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:write"))
) -> IdeaRead:
    try:
        idea = await idea_intake_service.submit_idea(
            tenant_id=principal.tenant_id,
            project_id=body.project_id or principal.project_id,
            payload=body,
            actor_id=principal.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return IdeaRead.model_validate(idea)


@router.get("", response_model=IdeaListResponse)
@audit(action="ideation.idea.list", target_type="idea")
async def list_ideas(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    tag: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> IdeaListResponse:
    rows = await idea_intake_service.list_ideas(
        tenant_id=principal.tenant_id,
        project_id=project_id or principal.project_id,
        status=status_filter,
        tag=tag,
        limit=limit,
    )
    items = [IdeaRead.model_validate(r) for r in rows]
    return IdeaListResponse(items=items, total=len(items))


@router.get("/{idea_id}", response_model=IdeaRead)
@audit(action="ideation.idea.get", target_type="idea")
async def get_idea(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> IdeaRead:
    try:
        idea = await idea_intake_service.get_idea(
            idea_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return IdeaRead.model_validate(idea)
@require_approval_phase(SDLCPhase.PLANNING)


@router.patch("/{idea_id}", response_model=IdeaRead)
@audit(action="ideation.idea.update", target_type="idea")
async def update_idea(
    idea_id: UUID,
    body: IdeaUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:write"))
) -> IdeaRead:
    try:
        idea = await idea_intake_service.update_idea(
            idea_id,
            body,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return IdeaRead.model_validate(idea)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/{idea_id}/analyze", response_model=IdeaAnalysisRead)
@audit(action="ideation.idea.analyze", target_type="idea")
async def analyze_idea(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:analyze"))
) -> IdeaAnalysisRead:
    try:
        analysis = await idea_analysis_service.analyze_idea(
            idea_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return IdeaAnalysisRead.model_validate(analysis)


@router.get("/{idea_id}/analysis", response_model=IdeaAnalysisRead | None)
@audit(action="ideation.idea.get_analysis", target_type="idea")
async def get_analysis(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> IdeaAnalysisRead | None:
    try:
        analysis = await idea_analysis_service.get_analysis(
            idea_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if analysis is None:
        return None
    return IdeaAnalysisRead.model_validate(analysis)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/{idea_id}/reanalyze", response_model=IdeaAnalysisRead)
@audit(action="ideation.idea.reanalyze", target_type="idea")
async def reanalyze_idea(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:analyze"))
) -> IdeaAnalysisRead:
    try:
        analysis = await idea_analysis_service.reanalyze(
            idea_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return IdeaAnalysisRead.model_validate(analysis)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/{idea_id}/archive", response_model=IdeaRead)
@audit(action="ideation.idea.archive", target_type="idea")
async def archive_idea(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:write"))
) -> IdeaRead:
    try:
        idea = await idea_intake_service.archive_idea(
            idea_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return IdeaRead.model_validate(idea)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/{idea_id}/artifacts", response_model=IdeaRead)
@audit(action="ideation.idea.attach_artifact", target_type="idea")
async def attach_artifact(
    idea_id: UUID,
    body: IdeaArtifactAttach,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:write"))
) -> IdeaRead:
    try:
        idea = await idea_intake_service.attach_artifact(
            idea_id,
            body.artifact_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return IdeaRead.model_validate(idea)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/validate", response_model=IdeaValidationResult)
@audit(action="ideation.idea.validate", target_type="idea")
async def validate_idea_payload(
    body: IdeaCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> IdeaValidationResult:
    """Standalone validation pass — useful for the UI before submit."""
    result = validate_idea(body)
    return IdeaValidationResult(valid=result.valid, errors=result.errors)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/extract-entities", response_model=EntityExtraction)
@audit(action="ideation.idea.extract_entities", target_type="idea")
async def extract_entities_endpoint(
    text: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> EntityExtraction:
    """Lightweight NER endpoint for the intake UI."""
    if not text or len(text.strip()) < 4:
        raise HTTPException(status_code=400, detail="text_too_short")
    return await extract_entities(
        text,
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
    )


__all__ = ["router"]

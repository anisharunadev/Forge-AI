"""F-303 — Task Breakdown HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.architecture import (
    TaskBreakdownCreateRequest,
    TaskBreakdownListResponse,
    TaskBreakdownResponse,
    TaskUpdateRequest,
)
from app.services.architecture.task_breakdown import TaskBreakdownGenerator
from app.services.artifact_registry import artifact_registry
from app.services.event_bus import bus
from app.services.litellm_client import LiteLLMClient

router = APIRouter(
    prefix="/architecture/task-breakdowns",
    tags=["architecture:task-breakdowns"],
)


def _generator() -> TaskBreakdownGenerator:
    return TaskBreakdownGenerator(
        litellm_client=LiteLLMClient(),
        artifact_registry=artifact_registry,
        event_bus=bus,
    )
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.post("", response_model=TaskBreakdownResponse, status_code=status.HTTP_201_CREATED)
@audit(action="architecture.task_breakdown.create", target_type="task_breakdown")
async def create_task_breakdown(
    body: TaskBreakdownCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:task_breakdown:create"))
) -> TaskBreakdownResponse:
    """Generate a task breakdown from a source artifact (ADR, contract, etc.)."""
    if body.source_type != "adr":
        raise HTTPException(
            status_code=400,
            detail="only adr source_type is supported in this release",
        )
    try:
        breakdown = await _generator().generate_from_adr(
            adr_id=body.source_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if breakdown.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="task_breakdown_not_found")
    return TaskBreakdownResponse.model_validate(breakdown)


@router.get("", response_model=TaskBreakdownListResponse)
@audit(action="architecture.task_breakdown.list", target_type="task_breakdown")
async def list_task_breakdowns(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:task_breakdown:read")),
    project_id: UUID = Query(...),
) -> TaskBreakdownListResponse:
    rows = await _generator().list_for_project(
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )
    return TaskBreakdownListResponse(
        items=[TaskBreakdownResponse.model_validate(r) for r in rows],
        total=len(rows),
    )


@router.get("/{breakdown_id}", response_model=TaskBreakdownResponse)
@audit(action="architecture.task_breakdown.get", target_type="task_breakdown")
async def get_task_breakdown(
    breakdown_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:task_breakdown:read"))
) -> TaskBreakdownResponse:
    breakdown = await _generator().get_task_breakdown(breakdown_id)
    if breakdown is None or breakdown.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="task_breakdown_not_found")
    return TaskBreakdownResponse.model_validate(breakdown)
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.patch(
    "/{breakdown_id}/tasks/{task_id}", response_model=TaskBreakdownResponse
)
@audit(action="architecture.task_breakdown.update_task", target_type="task_breakdown")
async def update_task(
    breakdown_id: UUID,
    task_id: str,
    body: TaskUpdateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:task_breakdown:update"))
) -> TaskBreakdownResponse:
    updates = body.model_dump(exclude_unset=True)
    try:
        breakdown = await _generator().update_task(
            breakdown_id=breakdown_id,
            task_id=task_id,
            updates=updates,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if breakdown.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="task_breakdown_not_found")
    return TaskBreakdownResponse.model_validate(breakdown)


__all__ = ["router"]

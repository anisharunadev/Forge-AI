"""Realtime Workflow REST endpoints (F-210).

Start / get / intervene / complete are exposed over plain HTTP so the
UI can bootstrap the workflow before opening the WebSocket.
"""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.ideation import (
    WorkflowIntervention,
    WorkflowSessionRead,
    WorkflowStartRequest,
)
from app.services.ideation.realtime_workflow import realtime_workflow

router = APIRouter(prefix="/ideation/workflows", tags=["ideation"])


def _to_read(row, steps: list[dict]) -> WorkflowSessionRead:
    return WorkflowSessionRead(
        id=row.id,
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        idea_id=row.idea_id,
        user_id=row.user_id,
        status=row.status,
        current_step=row.current_step,
        state=dict(row.state or {}),
        completed_at=row.completed_at,
        steps=[step for step in steps],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.post(
    "/ideas/{idea_id}/start",
    response_model=WorkflowSessionRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="ideation.workflow.start", target_type="workflow_session")
async def start_workflow(
    idea_id: UUID,
    body: WorkflowStartRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:workflow"))
) -> WorkflowSessionRead:
    user_id = body.user_id or principal.user_id
    try:
        row = await realtime_workflow.start_workflow(
            idea_id,
            user_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    state = await realtime_workflow.get_workflow_state(
        row.id, tenant_id=principal.tenant_id
    )
    return _to_read(row, state.steps)


@router.get("/{session_id}", response_model=WorkflowSessionRead)
@audit(action="ideation.workflow.get", target_type="workflow_session")
async def get_workflow(
    session_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> WorkflowSessionRead:
    try:
        state = await realtime_workflow.get_workflow_state(
            session_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    # Fetch row metadata for the read model.
    from app.db.models.ideation import WorkflowSession
    from app.db.session import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(WorkflowSession, str(session_id))
    return _to_read(row, state.steps)


@router.post("/{session_id}/intervene", response_model=WorkflowSessionRead)
@audit(action="ideation.workflow.intervene", target_type="workflow_session")
async def intervene_workflow(
    session_id: UUID,
    body: WorkflowIntervention,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:workflow"))
) -> WorkflowSessionRead:
    try:
        new_state = await realtime_workflow.intervene(
            session_id,
            body.action,
            tenant_id=principal.tenant_id,
            step=body.step,
            payload=body.payload,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    from app.db.models.ideation import WorkflowSession
    from app.db.session import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(WorkflowSession, str(session_id))
    return _to_read(row, new_state.steps)


@router.post("/{session_id}/complete", response_model=dict)
@audit(action="ideation.workflow.complete", target_type="workflow_session")
async def complete_workflow(
    session_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:workflow"))
) -> dict:
    try:
        bundle = await realtime_workflow.complete_workflow(
            session_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return bundle


__all__ = ["router"]

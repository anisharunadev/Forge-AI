from typing import Annotated
"""F-013 — Agent Assignment REST endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.agents import (
    AgentAssignmentCreate,
    AgentAssignmentRead,
    AgentRead,
)
from app.services.agent_assignment import agent_assignment
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/agent-assignments", tags=["agent-assignments"])
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("", response_model=AgentAssignmentRead)
@audit(action="agent_assignments.create", target_type="agent")
async def create_assignment(
    body: AgentAssignmentCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("agents:assign"))
) -> AgentAssignmentRead:
    try:
        agent = await agent_assignment.assign_agent(
            task_type=body.task_type,
            tenant_id=principal.tenant_id,
            project_id=body.project_id or principal.project_id,
            strategy=body.strategy,
            required_capabilities=body.required_capabilities,
            pinned_agent_id=body.pinned_agent_id,
        )
    except (LookupError, ValueError, PermissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AgentAssignmentRead(
        task_type=body.task_type,
        project_id=body.project_id or principal.project_id,
        strategy=body.strategy,
        agent=AgentRead.model_validate(agent),
        assigned_at=datetime.now(timezone.utc),
    )


@router.get("", response_model=AgentAssignmentRead)
@audit(action="agent_assignments.peek", target_type="agent")
async def peek_assignment(
    task_type: str = Query(..., min_length=1),
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)] = ...,
    project_id: str | None = Query(default=None),
    strategy: str = Query(default="capability_match"),
    _perm: AuthenticatedPrincipal = Depends(require_permission("agents:assign"))
) -> AgentAssignmentRead:
    try:
        agent = await agent_assignment.assign_agent(
            task_type=task_type,
            tenant_id=principal.tenant_id,
            project_id=project_id or principal.project_id,
            strategy=strategy,
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AgentAssignmentRead(
        task_type=task_type,
        project_id=project_id or principal.project_id,
        strategy=strategy,
        agent=AgentRead.model_validate(agent),
        assigned_at=datetime.now(timezone.utc),
    )


__all__ = ["router"]

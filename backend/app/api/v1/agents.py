from typing import Annotated
"""F-011 — Agent Registry REST endpoints."""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.agent import Agent
from app.schemas.agents import AgentCreate, AgentRead, AgentUpdate
from app.services.agent_registry import agent_registry
from app.services.forge_key_broker import forge_key_broker

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentRead])
@audit(action="agents.list", target_type="agent")
async def list_agents(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("agents:read"))
) -> list[AgentRead]:
    agents = await agent_registry.list_agents(
        principal.tenant_id, project_id=project_id
    )
    return [AgentRead.model_validate(a) for a in agents]


@router.get("/{agent_id}", response_model=AgentRead)
@audit(action="agents.get", target_type="agent")
async def get_agent(
    agent_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("agents:read"))
) -> AgentRead:
    try:
        agent = await agent_registry.get_agent(agent_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(agent.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="agent_not_found")
    return AgentRead.model_validate(agent)


@router.post("", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
@audit(action="agents.create", target_type="agent")
async def create_agent(
    body: AgentCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    background_tasks: BackgroundTasks,
    _perm: AuthenticatedPrincipal = Depends(require_permission("agents:create"))
) -> AgentRead:
    agent = await agent_registry.create_agent(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        name=body.name,
        type=body.type,
        capabilities=body.capabilities,
        version=body.version,
    )
    background_tasks.add_task(forge_key_broker.issue_or_rotate, agent)
    return AgentRead.model_validate(agent)


@router.patch("/{agent_id}", response_model=AgentRead)
@audit(action="agents.update", target_type="agent")
async def update_agent(
    agent_id: UUID,
    body: AgentUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    background_tasks: BackgroundTasks,
    _perm: AuthenticatedPrincipal = Depends(require_permission("agents:update"))
) -> AgentRead:
    try:
        existing = await agent_registry.get_agent(agent_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(existing.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="agent_not_found")
    updated = await agent_registry.update_agent(
        agent_id,
        name=body.name,
        capabilities=body.capabilities,
        status=body.status,
        version=body.version,
    )
    background_tasks.add_task(forge_key_broker.issue_or_rotate, updated)
    return AgentRead.model_validate(updated)


@router.delete(
    "/{agent_id}",
    response_model=None,
    response_class=Response,
)
@audit(action="agents.delete", target_type="agent")
async def delete_agent(
    agent_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("agents:delete"))
):
    try:
        existing = await agent_registry.get_agent(agent_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(existing.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="agent_not_found")
    await agent_registry.delete_agent(agent_id)


# step-54 — Phase 2 test endpoint. The backend currently does not
# actually invoke the agent runtime (that lives in `agent_runtime.py`
# and requires a container/sandbox); this returns a typed TestResult
# so the UI can wire a "Test connection" button and surface status.
# A real invocation can be layered on later via `agent_runtime`.
@router.post("/{agent_id}/test")
@audit(action="agents.test", target_type="agent")
async def test_agent(
    agent_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("agents:read"))
) -> dict[str, str]:
    try:
        existing = await agent_registry.get_agent(agent_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(existing.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="agent_not_found")
    if existing.status.value == "deprecated":
        return {"status": "error", "message": "agent is deprecated"}
    if existing.status.value == "disabled":
        return {"status": "error", "message": "agent is disabled"}
    return {
        "status": "ok",
        "message": f"Agent '{existing.name}' reachable (v{existing.version})",
    }


__all__ = ["router"]

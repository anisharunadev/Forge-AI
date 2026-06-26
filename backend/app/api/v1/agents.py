"""F-011 — Agent Registry REST endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.db.models.agent import AgentStatus
from app.schemas.agents import AgentCreate, AgentRead, AgentUpdate
from app.services.agent_registry import agent_registry

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentRead])
@audit(action="agents.list", target_type="agent")
async def list_agents(
    principal: Principal,
    project_id: UUID | None = Query(default=None),
    _perm: Principal = require_permission("agents:read"),
) -> list[AgentRead]:
    agents = await agent_registry.list_agents(
        principal.tenant_id, project_id=project_id
    )
    return [AgentRead.model_validate(a) for a in agents]


@router.get("/{agent_id}", response_model=AgentRead)
@audit(action="agents.get", target_type="agent")
async def get_agent(
    agent_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("agents:read"),
) -> AgentRead:
    try:
        agent = await agent_registry.get_agent(agent_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if agent.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="agent_not_found")
    return AgentRead.model_validate(agent)


@router.post("", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
@audit(action="agents.create", target_type="agent")
async def create_agent(
    body: AgentCreate,
    principal: Principal,
    _perm: Principal = require_permission("agents:create"),
) -> AgentRead:
    agent = await agent_registry.create_agent(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        name=body.name,
        type=body.type,
        capabilities=body.capabilities,
        version=body.version,
    )
    return AgentRead.model_validate(agent)


@router.patch("/{agent_id}", response_model=AgentRead)
@audit(action="agents.update", target_type="agent")
async def update_agent(
    agent_id: UUID,
    body: AgentUpdate,
    principal: Principal,
    _perm: Principal = require_permission("agents:update"),
) -> AgentRead:
    try:
        existing = await agent_registry.get_agent(agent_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if existing.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="agent_not_found")
    updated = await agent_registry.update_agent(
        agent_id,
        name=body.name,
        capabilities=body.capabilities,
        status=body.status,
        version=body.version,
    )
    return AgentRead.model_validate(updated)


@router.delete(
    "/{agent_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    response_class=Response,
)
@audit(action="agents.delete", target_type="agent")
@audit(action="agents.delete", target_type="agent")
async def delete_agent(
    agent_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("agents:delete"),
):
    try:
        existing = await agent_registry.get_agent(agent_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if existing.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="agent_not_found")
    await agent_registry.delete_agent(agent_id)


__all__ = ["router"]

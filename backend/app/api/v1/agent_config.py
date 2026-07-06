"""Per-project agent configuration (Settings → Agents tab)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import DbSession, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.agent import Agent
from app.db.models.agent_config import AgentConfig

router = APIRouter(prefix="/projects/{project_id}/agent-config", tags=["agent-config"])


class AgentConfigRead(BaseModel):
    id: UUID
    project_id: UUID
    agent_id: UUID
    agent_name: str
    enabled: bool
    default_model: str | None = None
    temperature: float
    max_tokens: int
    allowed_tools: list[str]
    config: dict
    created_at: datetime
    updated_at: datetime


class AgentConfigUpdate(BaseModel):
    enabled: bool | None = None
    default_model: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, gt=0, le=200000)
    allowed_tools: list[str] | None = None
    config: dict | None = None


def _to_read(cfg: AgentConfig, agent: Agent) -> AgentConfigRead:
    return AgentConfigRead(
        id=cfg.id,
        project_id=cfg.project_id,
        agent_id=cfg.agent_id,
        agent_name=agent.name,
        enabled=cfg.enabled,
        default_model=cfg.default_model,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        allowed_tools=list(cfg.allowed_tools or []),
        config=dict(cfg.config or {}),
        created_at=cfg.created_at,
        updated_at=cfg.updated_at,
    )


@router.get("", response_model=list[AgentConfigRead])
@audit(action="agent_config.list", target_type="project")
async def list_agent_config(
    project_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> list[AgentConfigRead]:
    """List every project-level agent configuration."""
    result = await db.execute(
        select(AgentConfig, Agent)
        .join(Agent, Agent.id == AgentConfig.agent_id)
        .where(
            AgentConfig.project_id == project_id,
            AgentConfig.tenant_id == UUID(principal.tenant_id),
        )
        .order_by(Agent.name)
    )
    return [_to_read(cfg, agent) for cfg, agent in result.all()]


@router.get("/{agent_id}", response_model=AgentConfigRead)
@audit(action="agent_config.read", target_type="project")
async def get_agent_config(
    project_id: UUID,
    agent_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> AgentConfigRead:
    """Read the project config for one agent."""
    result = (
        await db.execute(
            select(AgentConfig, Agent)
            .join(Agent, Agent.id == AgentConfig.agent_id)
            .where(
                AgentConfig.project_id == project_id,
                AgentConfig.agent_id == agent_id,
                AgentConfig.tenant_id == UUID(principal.tenant_id),
            )
        )
    ).first()
    if result is None:
        raise HTTPException(status_code=404, detail="agent_config_not_found")
    cfg, agent = result
    return _to_read(cfg, agent)


@require_approval_phase(SDLCPhase.PLANNING)
@router.patch("/{agent_id}", response_model=AgentConfigRead)
@audit(action="agent_config.update", target_type="project")
async def update_agent_config(
    project_id: UUID,
    agent_id: UUID,
    body: AgentConfigUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> AgentConfigRead:
    """Upsert the project config for one agent."""
    agent = (await db.execute(select(Agent).where(Agent.id == agent_id))).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="agent_not_found")

    cfg = (
        await db.execute(
            select(AgentConfig).where(
                AgentConfig.project_id == project_id,
                AgentConfig.agent_id == agent_id,
                AgentConfig.tenant_id == UUID(principal.tenant_id),
            )
        )
    ).scalar_one_or_none()

    now = datetime.now(UTC)
    if cfg is None:
        cfg = AgentConfig(
            id=uuid4(),
            tenant_id=UUID(principal.tenant_id),
            project_id=project_id,
            agent_id=agent_id,
            enabled=body.enabled if body.enabled is not None else True,
            default_model=body.default_model or agent.version,
            temperature=body.temperature if body.temperature is not None else 0.7,
            max_tokens=body.max_tokens if body.max_tokens is not None else 4096,
            allowed_tools=body.allowed_tools or [],
            config=body.config or {},
            created_at=now,
            updated_at=now,
        )
        db.add(cfg)
    else:
        if body.enabled is not None:
            cfg.enabled = body.enabled
        if body.default_model is not None:
            cfg.default_model = body.default_model
        if body.temperature is not None:
            cfg.temperature = body.temperature
        if body.max_tokens is not None:
            cfg.max_tokens = body.max_tokens
        if body.allowed_tools is not None:
            cfg.allowed_tools = body.allowed_tools
        if body.config is not None:
            cfg.config = body.config
        cfg.updated_at = now

    await db.commit()
    await db.refresh(cfg)
    return _to_read(cfg, agent)


__all__ = ["router", "AgentConfigRead", "AgentConfigUpdate"]

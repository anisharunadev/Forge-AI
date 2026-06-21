"""Agent Registry (F-011).

CRUD for registered agent profiles plus capability matching so
downstream assignment can pick the right agent for a task.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F401  (re-exported for callers)

from app.core.logging import get_logger
from app.db.models.agent import Agent, AgentStatus, AgentType
from app.db.session import get_session_factory

logger = get_logger(__name__)


def _matches_capabilities(agent_caps: dict[str, Any], required: dict[str, Any]) -> bool:
    """All required keys must be present and overlap meaningfully.

    Lists are treated as sets: at least one common element is required.
    Scalars use `==`. Missing keys mean the requirement is unmet.
    """
    if not required:
        return True
    for key, expected in required.items():
        if key not in agent_caps:
            return False
        actual = agent_caps[key]
        if isinstance(expected, list) and isinstance(actual, list):
            if not (set(expected) & set(actual)):
                return False
        elif actual != expected:
            return False
    return True


class AgentRegistry:
    """Tenant-scoped CRUD + capability matcher."""

    async def list_agents(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> list[Agent]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Agent).where(Agent.tenant_id == str(tenant_id))
            if project_id is not None:
                # Include org-level (project_id IS NULL) and project-specific.
                from sqlalchemy import or_

                stmt = stmt.where(
                    or_(Agent.project_id.is_(None), Agent.project_id == str(project_id))
                )
            stmt = stmt.order_by(Agent.created_at.desc())
            return list((await session.execute(stmt)).scalars().all())

    async def get_agent(self, agent_id: UUID | str) -> Agent:
        factory = get_session_factory()
        async with factory() as session:
            agent = await session.get(Agent, str(agent_id))
            if agent is None:
                raise LookupError(f"Agent {agent_id} not found")
            return agent

    async def create_agent(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        name: str,
        type: AgentType,
        capabilities: dict[str, Any],
        version: str = "1.0.0",
    ) -> Agent:
        factory = get_session_factory()
        async with factory() as session:
            agent = Agent(
                tenant_id=str(tenant_id),
                project_id=str(project_id) if project_id else None,
                name=name,
                type=type,
                capabilities=capabilities,
                version=version,
                status=AgentStatus.ENABLED,
            )
            session.add(agent)
            await session.commit()
            await session.refresh(agent)
        logger.info(
            "agent.created",
            agent_id=str(agent.id),
            type=type.value,
            tenant_id=str(tenant_id),
        )
        return agent

    async def update_agent(
        self,
        agent_id: UUID | str,
        *,
        name: str | None = None,
        capabilities: dict[str, Any] | None = None,
        status: AgentStatus | None = None,
        version: str | None = None,
    ) -> Agent:
        factory = get_session_factory()
        async with factory() as session:
            agent = await session.get(Agent, str(agent_id))
            if agent is None:
                raise LookupError(f"Agent {agent_id} not found")
            if name is not None:
                agent.name = name
            if capabilities is not None:
                agent.capabilities = capabilities
            if status is not None:
                agent.status = status
            if version is not None:
                agent.version = version
            await session.commit()
            await session.refresh(agent)
        return agent

    async def delete_agent(self, agent_id: UUID | str) -> None:
        """Mark an agent as DEPRECATED (soft delete)."""
        await self.update_agent(agent_id, status=AgentStatus.DEPRECATED)

    async def list_agents_for_task(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        required_capabilities: dict[str, Any] | None = None,
    ) -> list[Agent]:
        """Return enabled agents that match the task's capability signature."""
        agents = await self.list_agents(tenant_id, project_id=project_id)
        candidates = [a for a in agents if a.status == AgentStatus.ENABLED]
        if required_capabilities:
            candidates = [a for a in candidates if _matches_capabilities(a.capabilities, required_capabilities)]
        return candidates


agent_registry = AgentRegistry()


__all__ = ["AgentRegistry", "agent_registry"]

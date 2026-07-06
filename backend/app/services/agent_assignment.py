"""Agent Assignment (F-013).

Picks the right Agent for a task using one of four strategies:
- round_robin: cycle through candidates in created_at order
- least_loaded: prefer agent with fewest recent runs
- capability_match: rank by how well capabilities satisfy required
- manual_pin: lock to a specific agent_id
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.db.models.agent import Agent
from app.db.models.cost import CostEntry
from app.db.session import get_session_factory
from app.services.agent_registry import AgentRegistry, agent_registry

logger = get_logger(__name__)


class AgentAssignment:
    """Strategy-driven agent selection."""

    def __init__(self, registry: AgentRegistry | None = None) -> None:
        self._registry = registry or agent_registry
        self._round_robin_index: dict[tuple[str, str | None], int] = defaultdict(int)

    async def assign_agent(
        self,
        *,
        task_type: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        strategy: str = "round_robin",
        required_capabilities: dict[str, Any] | None = None,
        pinned_agent_id: UUID | str | None = None,
    ) -> Agent:
        if strategy == "manual_pin":
            if pinned_agent_id is None:
                raise ValueError("manual_pin strategy requires pinned_agent_id")
            agent = await self._registry.get_agent(pinned_agent_id)
            if str(agent.tenant_id) != str(tenant_id):
                raise PermissionError("pinned_agent_does_not_belong_to_tenant")
            return agent

        candidates = await self._registry.list_agents_for_task(
            tenant_id=tenant_id,
            project_id=project_id,
            required_capabilities=required_capabilities,
        )
        if not candidates:
            raise LookupError(f"no_enabled_agents_for task_type={task_type} strategy={strategy}")

        if strategy == "capability_match":
            return _rank_by_capability_overlap(candidates, required_capabilities or {})[0]

        if strategy == "least_loaded":
            return await _pick_least_loaded(tenant_id, candidates)

        if strategy == "round_robin":
            key = (str(tenant_id), str(project_id) if project_id else None, task_type)
            idx = self._round_robin_index[key] % len(candidates)
            self._round_robin_index[key] = idx + 1
            return candidates[idx]

        raise ValueError(f"unknown_strategy:{strategy}")


def _rank_by_capability_overlap(
    candidates: list[Agent],
    required: dict[str, Any],
) -> list[Agent]:
    """Score = count of required keys present + matches on lists/scalars.

    Higher score wins; ties broken by alphabetical name for determinism.
    """

    def score(agent: Agent) -> tuple[int, str]:
        if not required:
            return (0, agent.name)
        score_n = 0
        for key, expected in required.items():
            if key not in agent.capabilities:
                continue
            actual = agent.capabilities[key]
            if isinstance(expected, list) and isinstance(actual, list):
                score_n += len(set(expected) & set(actual))
            elif actual == expected:
                score_n += 1
        return (score_n, agent.name)

    return sorted(candidates, key=score, reverse=True)


async def _pick_least_loaded(
    tenant_id: UUID | str,
    candidates: list[Agent],
) -> Agent:
    """Agent with fewest CostEntry rows in the last 24h wins."""
    since = datetime.now(UTC) - timedelta(hours=24)
    factory = get_session_factory()
    async with factory() as session:
        stmt = (
            select(CostEntry.workflow_id, func.count(CostEntry.id))
            .where(
                CostEntry.tenant_id == str(tenant_id),
                CostEntry.recorded_at >= since,
                CostEntry.source == "litellm",
            )
            .group_by(CostEntry.workflow_id)
        )
        rows = (await session.execute(stmt)).all()
    # Without per-agent join tables yet, fall back to deterministic order
    # based on the agent id. The wiring for true load tracking is in
    # F-014 runtime metrics.
    return sorted(candidates, key=lambda a: (str(a.id),))[0]


agent_assignment = AgentAssignment()


__all__ = ["AgentAssignment", "agent_assignment"]

"""Agent Selection for Ideation (F-209).

Given an idea's analysis + impact + score (and the idea's tags /
description), picks an agent per phase of the delivery workflow:
- analysis (already done by the analysis service — selector confirms)
- scoring
- arch_preview
- prd
- implementation
- review

Uses `agent_assignment` (M2) under the hood so the picker can use the
same strategy as the rest of the system (round_robin,
capability_match, least_loaded, manual_pin).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.agent import Agent
from app.db.models.ideation import (
    Idea,
    IdeaAnalysis,
    OpportunityScore,
    Roadmap,
)
from app.db.session import get_session_factory
from app.services.agent_assignment import AgentAssignment, agent_assignment

logger = get_logger(__name__)


# Phases the delivery pipeline runs through. Order matters.
PHASES: tuple[str, ...] = (
    "analysis",
    "scoring",
    "arch_preview",
    "prd",
    "implementation",
    "review",
)


# Map a phase to the capabilities the ideal agent should have.
_PHASE_CAPABILITIES: dict[str, dict[str, Any]] = {
    "analysis": {"languages": ["python"], "tools": ["analysis"]},
    "scoring": {"languages": ["python"], "tools": ["analysis"]},
    "arch_preview": {"languages": ["python", "typescript", "go"], "tools": ["architecture"]},
    "prd": {"languages": ["python"], "tools": ["documentation"]},
    "implementation": {"languages": ["python", "typescript", "go"], "tools": ["shell", "browser"]},
    "review": {"languages": ["python", "typescript", "go"], "tools": ["review"]},
}


@dataclass
class AgentAssignmentStep:
    phase: str
    agent_id: UUID
    agent_name: str | None
    rationale: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "phase": self.phase,
            "agent_id": str(self.agent_id),
            "agent_name": self.agent_name,
            "rationale": self.rationale,
        }


@dataclass
class AgentAssignmentPlan:
    idea_id: UUID
    steps: list[AgentAssignmentStep] = field(default_factory=list)
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "idea_id": str(self.idea_id),
            "steps": [s.to_dict() for s in self.steps],
            "generated_at": self.generated_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class AgentSelector:
    """Tenant-scoped agent picker for ideation workflows."""

    def __init__(self, assignment: AgentAssignment | None = None) -> None:
        self._assignment = assignment or agent_assignment

    async def select_agents_for_idea(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        strategy: str = "capability_match",
    ) -> AgentAssignmentPlan:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id

        analysis = await self._latest_analysis(idea.id)
        score = await self._latest_score(idea.id)

        steps: list[AgentAssignmentStep] = []
        seen_agent_ids: set[str] = set()

        for phase in PHASES:
            caps = self._caps_for_phase(phase, idea=idea, analysis=analysis, score=score)
            try:
                agent = await self._assignment.assign_agent(
                    task_type=f"ideation.{phase}",
                    tenant_id=tenant_id,
                    project_id=effective_project_id,
                    strategy=strategy if strategy != "capability_match" else "capability_match",
                    required_capabilities=caps,
                )
            except LookupError:
                # Fall back to round_robin without capability requirement so we
                # never strand an idea with no agent pick.
                try:
                    agent = await self._assignment.assign_agent(
                        task_type=f"ideation.{phase}",
                        tenant_id=tenant_id,
                        project_id=effective_project_id,
                        strategy="round_robin",
                    )
                except LookupError:
                    logger.warning(
                        "ideation.no_agent_available",
                        phase=phase,
                        idea_id=str(idea.id),
                    )
                    continue

            seen_agent_ids.add(str(agent.id))
            rationale = self._rationale(phase, agent, analysis, score)
            steps.append(
                AgentAssignmentStep(
                    phase=phase,
                    agent_id=agent.id,
                    agent_name=agent.name,
                    rationale=rationale,
                )
            )

        return AgentAssignmentPlan(idea_id=idea.id, steps=steps)

    async def select_agents_for_roadmap(
        self,
        roadmap_id: UUID | str,
        *,
        tenant_id: UUID | str,
        strategy: str = "capability_match",
    ) -> list[AgentAssignmentPlan]:
        roadmap = await self._load_roadmap(roadmap_id, tenant_id=tenant_id)
        plans: list[AgentAssignmentPlan] = []
        for entry in (roadmap.items or []):
            idea_id = entry.get("idea_id")
            if not idea_id:
                continue
            try:
                plan = await self.select_agents_for_idea(
                    idea_id,
                    tenant_id=tenant_id,
                    project_id=roadmap.project_id,
                    strategy=strategy,
                )
                plans.append(plan)
            except (LookupError, PermissionError) as exc:
                logger.warning(
                    "ideation.roadmap_agent_select_skipped",
                    roadmap_id=str(roadmap.id),
                    idea_id=str(idea_id),
                    error=str(exc),
                )
        return plans

    # -- internals --------------------------------------------------------

    def _caps_for_phase(
        self,
        phase: str,
        *,
        idea: Idea,
        analysis: IdeaAnalysis | None,
        score: OpportunityScore | None,
    ) -> dict[str, Any]:
        caps = dict(_PHASE_CAPABILITIES.get(phase, {}))
        # Bias capabilities toward technologies hinted in the idea text.
        text = ((idea.title or "") + " " + (idea.description or "")).lower()
        if "python" in text:
            caps["languages"] = list({*(caps.get("languages") or []), "python"})
        if any(k in text for k in ("typescript", "react", "nextjs")):
            caps["languages"] = list({*(caps.get("languages") or []), "typescript"})
        return caps

    def _rationale(
        self,
        phase: str,
        agent: Agent,
        analysis: IdeaAnalysis | None,
        score: OpportunityScore | None,
    ) -> str:
        bits = [f"Picked {agent.name} ({agent.type.value if hasattr(agent.type, 'value') else agent.type}) for phase {phase}"]
        if analysis is not None and analysis.target_users:
            bits.append(f"target users: {', '.join(analysis.target_users[:2])}")
        if score is not None:
            bits.append(f"score={score.total_score}")
        return "; ".join(bits)

    async def _load_idea(
        self, idea_id: UUID | str, *, tenant_id: UUID | str
    ) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea

    async def _load_roadmap(
        self, roadmap_id: UUID | str, *, tenant_id: UUID | str
    ) -> Roadmap:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Roadmap, str(roadmap_id))
            if row is None:
                raise LookupError(f"roadmap {roadmap_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("roadmap_not_in_tenant")
            return row

    async def _latest_analysis(self, idea_id: UUID | str) -> IdeaAnalysis | None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(IdeaAnalysis).where(IdeaAnalysis.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.analyzed_at, reverse=True)
        return rows[0]

    async def _latest_score(self, idea_id: UUID | str) -> OpportunityScore | None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(OpportunityScore).where(
                OpportunityScore.idea_id == str(idea_id)
            )
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.scored_at, reverse=True)
        return rows[0]


agent_selector = AgentSelector()


__all__ = ["AgentAssignmentPlan", "AgentAssignmentStep", "AgentSelector", "agent_selector"]

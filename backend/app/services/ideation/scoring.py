"""Opportunity Scoring service (F-204).

Scores an idea using RICE (Reach, Impact, Confidence, Effort) plus
custom dimensions: value, feasibility, risk. Uses LiteLLM for the AI
path and falls back to deterministic heuristics when the proxy is
unreachable. Supports human override with audit-trail preservation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.ideation import (
    Idea,
    IdeaAnalysis,
    IdeaStatus,
    OpportunityScore,
    ScoreSource,
)
from app.db.session import get_session_factory
from app.services.cost_ledger import cost_ledger
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ScoreComponents:
    value: float
    feasibility: float
    risk: float
    reach: float
    rationale: str

    @property
    def total(self) -> float:
        # RICE-style: weighted blend; risk is a penalty so higher = worse.
        weighted = (
            0.35 * self.value
            + 0.25 * self.feasibility
            + 0.10 * (10.0 - self.risk)  # invert risk
            + 0.30 * self.reach
        )
        return round(max(0.0, min(10.0, weighted)), 2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "value_score": round(self.value, 2),
            "feasibility_score": round(self.feasibility, 2),
            "risk_score": round(self.risk, 2),
            "reach_score": round(self.reach, 2),
            "total_score": self.total,
            "scoring_rationale": self.rationale,
        }


# ---------------------------------------------------------------------------
# Prompts + fallback
# ---------------------------------------------------------------------------


_SCORING_SYSTEM = (
    "You are an opportunity-scoring assistant. Score the idea on these four "
    "dimensions, each on a 0-10 scale. Return JSON with keys: "
    "value (impact on revenue/cost), feasibility (engineering ease, 10=very easy), "
    "risk (10=very risky), reach (number of users affected, 10=huge reach). "
    "Also include 'rationale' (1-3 sentence justification). Reply with JSON only."
)


def _scoring_user_prompt(idea: Idea, analysis: IdeaAnalysis | None) -> str:
    parts = [
        f"IDEA: {idea.title}",
        idea.description or "",
    ]
    if analysis is not None:
        parts.append(f"SUMMARY: {analysis.summary}")
        parts.append(f"PROBLEM: {analysis.problem_statement}")
        if analysis.target_users:
            parts.append(f"TARGET USERS: {', '.join(analysis.target_users)}")
        if analysis.risks:
            parts.append(f"RISKS: {', '.join(analysis.risks)}")
    return "\n\n".join(parts)


def _parse_score_json(content: str) -> ScoreComponents | None:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None

    def _clamp(value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    return ScoreComponents(
        value=_clamp(data.get("value")),
        feasibility=_clamp(data.get("feasibility")),
        risk=_clamp(data.get("risk")),
        reach=_clamp(data.get("reach")),
        rationale=str(data.get("rationale") or "").strip() or "no rationale provided",
    )


def _deterministic_score(idea: Idea, analysis: IdeaAnalysis | None) -> ScoreComponents:
    """Token-count heuristic for offline mode."""
    desc_len = len(idea.description or "")
    if desc_len < 200:
        value = 3.5
        feasibility = 7.0
        risk = 3.0
        reach = 4.0
    elif desc_len < 800:
        value = 5.5
        feasibility = 6.0
        risk = 4.0
        reach = 6.0
    else:
        value = 7.0
        feasibility = 5.0
        risk = 5.0
        reach = 7.5
    rationale_parts = [
        f"Based on description length ({desc_len} chars)",
    ]
    if analysis is not None:
        rationale_parts.append(
            f"with {len(analysis.target_users)} target user groups "
            f"and {len(analysis.risks)} flagged risks"
        )
    return ScoreComponents(
        value=value,
        feasibility=feasibility,
        risk=risk,
        reach=reach,
        rationale=". ".join(rationale_parts) + ".",
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class OpportunityScoringService:
    """Tenant-scoped opportunity scoring."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def score_idea(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        scoring_strategy: str = "ai",
        actor_id: UUID | str | None = None,
        model: str | None = None,
    ) -> OpportunityScore:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id
        analysis = await self._latest_analysis(idea.id)

        if scoring_strategy == "deterministic":
            components = _deterministic_score(idea, analysis)
            model_used: str | None = None
        elif scoring_strategy == "ai":
            components, model_used = await self._score_via_llm(
                idea=idea,
                analysis=analysis,
                tenant_id=tenant_id,
                project_id=effective_project_id,
                actor_id=actor_id,
                model=model,
            )
        else:
            raise ValueError(f"unknown_scoring_strategy:{scoring_strategy}")

        prompt_tokens = max(1, len(_scoring_user_prompt(idea, analysis)) // 4)
        completion_tokens = max(1, len(components.rationale) // 4)
        cost_usd = round((prompt_tokens + completion_tokens) * 0.000_002, 6)

        score = await self._persist(
            idea=idea,
            components=components,
            scored_by=ScoreSource.AI,
        )

        try:
            await cost_ledger.record(
                tenant_id=tenant_id,
                project_id=effective_project_id,
                workflow_id=idea.id,
                model=model_used or "deterministic_scoring",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
                source="ideation_scoring",
                metadata={"strategy": scoring_strategy, "idea_id": str(idea.id)},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ideation.scoring_cost_failed", error=str(exc))

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "domain": "ideation",
                "kind": "opportunity_score",
                "idea_id": str(idea.id),
                "score_id": str(score.id),
                "total_score": components.total,
                "model": model_used,
            },
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
        )
        # Mark the idea as scored if not already.
        if idea.status in (IdeaStatus.NEW, IdeaStatus.ANALYZING):
            await self._transition_idea(idea.id, IdeaStatus.SCORED, tenant_id=tenant_id)
        return score

    async def score_batch(
        self,
        idea_ids: list[UUID | str],
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        strategy: str = "ai",
        actor_id: UUID | str | None = None,
    ) -> list[OpportunityScore]:
        scores: list[OpportunityScore] = []
        for raw_id in idea_ids:
            try:
                score = await self.score_idea(
                    raw_id,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    scoring_strategy=strategy,
                    actor_id=actor_id,
                )
            except (LookupError, PermissionError, ValueError) as exc:
                logger.warning(
                    "ideation.batch_score_skipped",
                    idea_id=str(raw_id),
                    error=str(exc),
                )
                continue
            scores.append(score)
        return scores

    async def get_score(
        self, idea_id: UUID | str, *, tenant_id: UUID | str
    ) -> OpportunityScore | None:
        await self._load_idea(idea_id, tenant_id=tenant_id)
        return await self._latest_score(idea_id)

    async def human_override(
        self,
        idea_id: UUID | str,
        new_score: ScoreComponents,
        reason: str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str,
    ) -> OpportunityScore:
        """Persist a human override as a HYBRID score with audit rationale."""
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        merged = ScoreComponents(
            value=new_score.value,
            feasibility=new_score.feasibility,
            risk=new_score.risk,
            reach=new_score.reach,
            rationale=f"HUMAN OVERRIDE by {actor_id}: {reason}".strip(),
        )
        score = await self._persist(
            idea=idea,
            components=merged,
            scored_by=ScoreSource.HYBRID,
        )
        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "opportunity_score",
                "idea_id": str(idea.id),
                "score_id": str(score.id),
                "override": True,
                "reason": reason,
            },
            tenant_id=tenant_id,
            project_id=idea.project_id,
            actor_id=actor_id,
        )
        return score

    # -- internals --------------------------------------------------------

    async def _score_via_llm(
        self,
        *,
        idea: Idea,
        analysis: IdeaAnalysis | None,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        model: str | None,
    ) -> tuple[ScoreComponents, str | None]:
        messages = [
            {"role": "system", "content": _SCORING_SYSTEM},
            {"role": "user", "content": _scoring_user_prompt(idea, analysis)},
        ]
        try:
            async with LiteLLMClient() as client:
                response = await client.chat(
                    messages,
                    model=model,
                    response_format={"type": "json_object"},
                    tenant_id=tenant_id,
                    project_id=project_id,
                    workflow_id=idea.id,
                    actor_id=actor_id,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ideation.scoring_llm_unavailable", error=str(exc))
            return _deterministic_score(idea, analysis), None
        model_used = response.get("model") if isinstance(response, dict) else None
        try:
            content = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            content = ""
        parsed = _parse_score_json(content or "")
        if parsed is None:
            return _deterministic_score(idea, analysis), model_used
        return parsed, model_used

    async def _persist(
        self,
        *,
        idea: Idea,
        components: ScoreComponents,
        scored_by: ScoreSource,
    ) -> OpportunityScore:
        factory = get_session_factory()
        async with factory() as session:
            row = OpportunityScore(
                tenant_id=str(idea.tenant_id),
                project_id=str(idea.project_id),
                idea_id=idea.id,
                value_score=round(components.value, 2),
                feasibility_score=round(components.feasibility, 2),
                risk_score=round(components.risk, 2),
                reach_score=round(components.reach, 2),
                total_score=components.total,
                scoring_rationale=components.rationale,
                scored_by=scored_by,
                scored_at=datetime.now(UTC),
            )
            session.add(row)
            await session.commit()
            return row

    async def _load_idea(self, idea_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea

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
            stmt = select(OpportunityScore).where(OpportunityScore.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.scored_at, reverse=True)
        return rows[0]

    async def _transition_idea(
        self, idea_id: UUID | str, status: IdeaStatus, *, tenant_id: UUID | str
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None or str(idea.tenant_id) != str(tenant_id):
                return
            idea.status = status
            await session.commit()


opportunity_scoring_service = OpportunityScoringService()


__all__ = [
    "OpportunityScoringService",
    "ScoreComponents",
    "opportunity_scoring_service",
]

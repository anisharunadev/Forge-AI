"""PRD Generation service (F-206).

Generates a Product Requirements Document from an idea + its analysis
using LiteLLM with a BMad-compatible template. Stores as a typed
artifact (Rule 4) — append-only; new versions supersede the prior.

Sections produced:
- Problem
- Goals
- Non-Goals
- User Stories
- Requirements
- Success Metrics
- Open Questions
- Risks
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.ideation import (
    Idea,
    IdeaAnalysis,
    PRD,
    PRDStatus,
)
from app.db.session import get_session_factory
from app.services.cost_ledger import cost_ledger
from app.services.event_bus import EventType, bus as default_bus
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# BMad-compatible template
# ---------------------------------------------------------------------------

BMAD_SECTIONS: tuple[str, ...] = (
    "problem",
    "goals",
    "non_goals",
    "user_stories",
    "requirements",
    "success_metrics",
    "open_questions",
    "risks",
)


_BMAD_SYSTEM = (
    "You are a product manager writing a BMad-style PRD. "
    "Produce JSON with these exact keys: "
    + ", ".join(s for s in BMAD_SECTIONS)
    + ". "
    "Values should be strings for 'problem' and arrays of concise strings for the rest. "
    "Keep each array between 2 and 6 items. "
    "Reply with JSON only — no commentary."
)


def _bmad_user_prompt(idea: Idea, analysis: IdeaAnalysis | None) -> str:
    parts = [
        f"IDEA: {idea.title}",
        idea.description or "",
    ]
    if analysis is not None:
        parts.append(f"SUMMARY: {analysis.summary}")
        parts.append(f"PROBLEM STATEMENT: {analysis.problem_statement}")
        if analysis.target_users:
            parts.append(f"TARGET USERS: {', '.join(analysis.target_users)}")
        if analysis.success_metrics:
            parts.append(f"SUCCESS METRICS: {', '.join(analysis.success_metrics)}")
        if analysis.assumptions:
            parts.append(f"ASSUMPTIONS: {', '.join(analysis.assumptions)}")
        if analysis.risks:
            parts.append(f"RISKS: {', '.join(analysis.risks)}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _coerce_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _coerce_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if item is None:
                continue
            out.append(_coerce_str(item))
        return [x for x in out if x]
    if isinstance(value, str):
        parts = [p.strip() for p in value.replace("\n", ",").split(",")]
        return [p for p in parts if p]
    return [_coerce_str(value)]


def _parse_prd_json(content: str) -> dict[str, Any] | None:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    out: dict[str, Any] = {}
    for section in BMAD_SECTIONS:
        if section == "problem":
            out[section] = _coerce_str(data.get(section))
        else:
            out[section] = _coerce_list(data.get(section))
    return out


def _deterministic_prd(idea: Idea, analysis: IdeaAnalysis | None) -> dict[str, Any]:
    title = idea.title or "the idea"
    problem = (
        analysis.problem_statement
        if analysis and analysis.problem_statement
        else (idea.description or "").strip()[:400]
    ) or f"Users lack {title.lower()}."
    goals = ["Deliver a working v1", "Measure adoption in pilot"]
    non_goals = ["Out-of-scope platform migration", "Multi-region failover"]
    user_stories = []
    if analysis and analysis.target_users:
        for user in analysis.target_users[:4]:
            user_stories.append(f"As a {user}, I want to use {title.lower()} so that I can be more effective.")
    if not user_stories:
        user_stories = [f"As a user, I want to use {title.lower()} so that I can solve my problem."]
    requirements = ["Functional MVP", "Telemetry / metrics", "Basic auth"]
    success_metrics: list[str] = []
    if analysis and analysis.success_metrics:
        success_metrics = analysis.success_metrics
    else:
        success_metrics = ["Weekly active users >= 100 within 60 days"]
    open_questions = ["Who owns the rollout?", "What is the migration plan?"]
    risks: list[str] = []
    if analysis and analysis.risks:
        risks = analysis.risks
    else:
        risks = ["Scope creep", "Stakeholder alignment"]
    return {
        "problem": problem,
        "goals": goals,
        "non_goals": non_goals,
        "user_stories": user_stories,
        "requirements": requirements,
        "success_metrics": success_metrics,
        "open_questions": open_questions,
        "risks": risks,
    }


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class PRDGenerator:
    """Tenant-scoped PRD generation."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def generate_prd(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        template: str = "bmad",
        actor_id: UUID | str,
        model: str | None = None,
    ) -> PRD:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id
        analysis = await self._latest_analysis(idea.id)

        if template != "bmad":
            # Only BMad is supported in Phase 7; treat anything else as bmad
            # so an unexpected value doesn't break the user.
            template = "bmad"

        content, model_used = await self._generate(
            idea=idea,
            analysis=analysis,
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
            model=model,
        )

        prompt_tokens = max(1, len(_bmad_user_prompt(idea, analysis)) // 4)
        completion_tokens = max(1, sum(len(v) for v in content.values()) // 4)
        cost_usd = round((prompt_tokens + completion_tokens) * 0.000_002, 6)

        prd = await self._persist(
            idea=idea,
            content=content,
            template=template,
            generated_by=str(actor_id),
        )

        try:
            await cost_ledger.record(
                tenant_id=tenant_id,
                project_id=effective_project_id,
                workflow_id=idea.id,
                model=model_used or "deterministic_prd",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
                source="ideation_prd",
                metadata={"idea_id": str(idea.id), "template": template},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ideation.prd_cost_failed", error=str(exc))

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "domain": "ideation",
                "kind": "prd",
                "idea_id": str(idea.id),
                "prd_id": str(prd.id),
                "template": template,
                "model": model_used,
            },
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
        )
        return prd

    async def get_prd(
        self, idea_id: UUID | str, *, tenant_id: UUID | str
    ) -> PRD | None:
        await self._load_idea(idea_id, tenant_id=tenant_id)
        return await self._latest_prd(idea_id)

    async def update_prd_section(
        self,
        prd_id: UUID | str,
        section: str,
        content: Any,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> PRD:
        if section not in BMAD_SECTIONS:
            raise ValueError(f"unknown_prd_section:{section}")

        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(PRD, str(prd_id))
            if row is None:
                raise LookupError(f"prd {prd_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("prd_not_in_tenant")
            payload = dict(row.content or {})
            if section == "problem":
                payload[section] = _coerce_str(content)
            else:
                if not isinstance(content, list):
                    raise ValueError(f"prd_section_{section}_must_be_list")
                payload[section] = [_coerce_str(item) for item in content]
            row.content = payload
            await session.commit()
            await session.refresh(row)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {"domain": "ideation", "kind": "prd", "prd_id": str(row.id), "section": section},
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    async def submit_for_review(
        self,
        prd_id: UUID | str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> PRD:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(PRD, str(prd_id))
            if row is None:
                raise LookupError(f"prd {prd_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("prd_not_in_tenant")
            row.status = PRDStatus.REVIEW
            await session.commit()
            await session.refresh(row)
        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {"domain": "ideation", "kind": "prd", "prd_id": str(row.id), "status": "review"},
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    async def approve_prd(
        self,
        prd_id: UUID | str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str,
    ) -> PRD:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(PRD, str(prd_id))
            if row is None:
                raise LookupError(f"prd {prd_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("prd_not_in_tenant")
            row.status = PRDStatus.APPROVED
            row.reviewed_by = str(actor_id)
            await session.commit()
            await session.refresh(row)
        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {"domain": "ideation", "kind": "prd", "prd_id": str(row.id), "status": "approved"},
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    # -- internals --------------------------------------------------------

    async def _generate(
        self,
        *,
        idea: Idea,
        analysis: IdeaAnalysis | None,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        model: str | None,
    ) -> tuple[dict[str, Any], str | None]:
        messages = [
            {"role": "system", "content": _BMAD_SYSTEM},
            {"role": "user", "content": _bmad_user_prompt(idea, analysis)},
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
            logger.warning("ideation.prd_llm_unavailable", error=str(exc))
            return _deterministic_prd(idea, analysis), None
        model_used = response.get("model") if isinstance(response, dict) else None
        try:
            content = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            content = ""
        parsed = _parse_prd_json(content or "")
        if parsed is None:
            return _deterministic_prd(idea, analysis), model_used
        return parsed, model_used

    async def _persist(
        self,
        *,
        idea: Idea,
        content: dict[str, Any],
        template: str,
        generated_by: str,
    ) -> PRD:
        factory = get_session_factory()
        async with factory() as session:
            previous = await self._latest_prd_in_session(session, str(idea.id))
            next_version = (previous.version + 1) if previous is not None else 1
            row = PRD(
                tenant_id=str(idea.tenant_id),
                project_id=str(idea.project_id),
                idea_id=idea.id,
                version=next_version,
                content=content,
                status=PRDStatus.DRAFT,
                generated_by=generated_by,
            )
            session.add(row)
            await session.flush()
            if previous is not None:
                previous.superseded_by_id = row.id
            await session.commit()
            return row

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

    async def _latest_analysis(self, idea_id: UUID | str) -> IdeaAnalysis | None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(IdeaAnalysis).where(IdeaAnalysis.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.analyzed_at, reverse=True)
        return rows[0]

    async def _latest_prd(self, idea_id: UUID | str) -> PRD | None:
        factory = get_session_factory()
        async with factory() as session:
            return await self._latest_prd_in_session(session, str(idea_id))

    async def _latest_prd_in_session(self, session: Any, idea_id: str) -> PRD | None:
        stmt = select(PRD).where(PRD.idea_id == idea_id)
        rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.version, reverse=True)
        return rows[0]


prd_generator = PRDGenerator()


__all__ = ["PRDGenerator", "BMAD_SECTIONS", "prd_generator"]

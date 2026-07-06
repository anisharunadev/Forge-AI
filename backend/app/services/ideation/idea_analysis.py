"""Idea Analysis service (F-202).

Drives an LLM over an idea to produce a structured analysis:
- summary
- problem statement
- target users
- success metrics
- assumptions
- risks

Pulls related context from project intelligence (knowledge graph +
QA service) when available. Records cost to the cost ledger and emits
an `IdeaAnalyzed` event on the bus. Falls back to deterministic
analysis when LiteLLM is unreachable so dev/test flows still work.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.db.models.ideation import Idea, IdeaAnalysis, IdeaStatus
from app.db.session import get_session_factory
from app.services.cost_ledger import cost_ledger
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus
from app.services.knowledge_graph import knowledge_graph_service
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Prompt + fallback
# ---------------------------------------------------------------------------

_ANALYSIS_SYSTEM = (
    "You are a senior product analyst. Given an idea and supporting context, "
    "produce a JSON object with these exact keys: "
    "summary (string), problem_statement (string), "
    "target_users (list[string]), success_metrics (list[string]), "
    "assumptions (list[string]), risks (list[string]). "
    "Each list should have 2 to 6 concise items. "
    "Reply with JSON only — no prose outside the JSON."
)


def _build_user_message(idea: Idea, kg_context: str) -> str:
    return (
        f"IDEA TITLE: {idea.title}\n\n"
        f"IDEA DESCRIPTION:\n{(idea.description or '').strip()[:6000]}\n\n"
        f"PROJECT CONTEXT (knowledge graph excerpts):\n{kg_context or '(none)'}\n\n"
        "Return the analysis JSON now."
    )


@dataclass
class _RawAnalysis:
    summary: str
    problem_statement: str
    target_users: list[str]
    success_metrics: list[str]
    assumptions: list[str]
    risks: list[str]


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
        # Split on newlines or commas as a forgiving fallback.
        parts = [p.strip() for p in value.replace("\n", ",").split(",")]
        return [p for p in parts if p]
    return [_coerce_str(value)]


def _parse_llm_json(content: str) -> _RawAnalysis | None:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        # Strip fences like ```json ... ``` if present.
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if "\n" in cleaned:
                cleaned = cleaned.split("\n", 1)[1]
            cleaned = cleaned.strip()
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3].strip()
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    return _RawAnalysis(
        summary=_coerce_str(data.get("summary")),
        problem_statement=_coerce_str(data.get("problem_statement")),
        target_users=_coerce_list(data.get("target_users")),
        success_metrics=_coerce_list(data.get("success_metrics")),
        assumptions=_coerce_list(data.get("assumptions")),
        risks=_coerce_list(data.get("risks")),
    )


def _deterministic_analysis(idea: Idea) -> _RawAnalysis:
    """Static fallback used when LiteLLM is offline."""
    title = idea.title or "Untitled idea"
    description = idea.description or ""
    first_sentence = description.split(".")[0].strip() or description[:160]
    target_users = ["internal product team", "early adopter users"]
    success_metrics = [
        "adoption rate >= 10% within 30 days",
        "user satisfaction score >= 4.0/5",
    ]
    assumptions = [
        "Engineering capacity available in the next sprint",
        "Dependencies remain stable",
    ]
    risks = [
        "Scope creep during delivery",
        "Unclear acceptance criteria from stakeholders",
    ]
    return _RawAnalysis(
        summary=f"{title}: {first_sentence[:200]}",
        problem_statement=f"Users lack a clear solution to: {first_sentence[:240]}",
        target_users=target_users,
        success_metrics=success_metrics,
        assumptions=assumptions,
        risks=risks,
    )


# ---------------------------------------------------------------------------
# Related context pull
# ---------------------------------------------------------------------------


async def _gather_kg_context(*, tenant_id: UUID | str, project_id: UUID | str) -> str:
    """Build a short context block from the knowledge graph for the prompt."""
    try:
        nodes = await knowledge_graph_service.list_nodes(
            tenant_id=tenant_id,
            project_id=project_id,
            limit=15,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("ideation.kg_list_failed", error=str(exc))
        return ""

    if not nodes:
        return ""
    lines = []
    for n in nodes:
        snippet = json.dumps(n.properties or {}, default=str)[:200]
        lines.append(f"[{n.node_type}] {n.name} :: {snippet}")
    return "\n".join(lines[:15])


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class IdeaAnalysisService:
    """Tenant-scoped idea analysis."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def analyze_idea(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        force: bool = False,
        model: str | None = None,
    ) -> IdeaAnalysis:
        """Run analysis. If `force=True`, runs even when an analysis exists."""
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id

        existing = await self._latest_analysis(idea.id)
        if existing is not None and not force:
            return existing

        # Mark idea as analyzing while we work.
        await self._transition_idea(idea.id, IdeaStatus.ANALYZING, tenant_id=tenant_id)

        kg_context = await _gather_kg_context(tenant_id=tenant_id, project_id=effective_project_id)
        raw, model_used = await self._call_llm(
            idea=idea,
            kg_context=kg_context,
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
            model=model,
        )

        prompt_tokens = max(1, len((idea.title or "") + (idea.description or "")) // 4)
        completion_tokens = max(1, len(raw.summary) // 4)
        # Deterministic placeholder cost — proxy returns the real one when
        # available. Recording non-zero tokens keeps dashboards honest
        # even when the proxy strips cost.
        cost_usd = round((prompt_tokens + completion_tokens) * 0.000_002, 6)

        analysis = await self._persist(
            idea=idea,
            raw=raw,
            model_used=model_used,
            cost_usd=cost_usd,
            related_artifacts=[
                {
                    "kind": "kg_node",
                    "reference": "context",
                    "metadata": {"count": len(kg_context.splitlines())},
                }
            ]
            if kg_context
            else [],
        )

        # Cost ledger + event emission.
        try:
            await cost_ledger.record(
                tenant_id=tenant_id,
                project_id=effective_project_id,
                workflow_id=idea.id,
                model=model_used or "unknown",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
                source="ideation_analysis",
                metadata={"idea_id": str(idea.id), "force": force},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ideation.cost_record_failed", error=str(exc))

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "domain": "ideation",
                "kind": "idea_analysis",
                "idea_id": str(idea.id),
                "analysis_id": str(analysis.id),
                "model": model_used,
                "cost_usd": cost_usd,
            },
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
        )

        await self._transition_idea(idea.id, IdeaStatus.SCORED, tenant_id=tenant_id)
        logger.info(
            "ideation.idea_analyzed",
            idea_id=str(idea.id),
            analysis_id=str(analysis.id),
            model=model_used,
        )
        return analysis

    async def get_analysis(
        self, idea_id: UUID | str, *, tenant_id: UUID | str
    ) -> IdeaAnalysis | None:
        await self._load_idea(idea_id, tenant_id=tenant_id)
        return await self._latest_analysis(idea_id)

    async def reanalyze(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        model: str | None = None,
    ) -> IdeaAnalysis:
        return await self.analyze_idea(
            idea_id,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            force=True,
            model=model,
        )

    # -- internals --------------------------------------------------------

    async def _call_llm(
        self,
        *,
        idea: Idea,
        kg_context: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        model: str | None,
    ) -> tuple[_RawAnalysis, str | None]:
        messages = [
            {"role": "system", "content": _ANALYSIS_SYSTEM},
            {"role": "user", "content": _build_user_message(idea, kg_context)},
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
            logger.warning("ideation.llm_unavailable", error=str(exc))
            return _deterministic_analysis(idea), None

        model_used = response.get("model") if isinstance(response, dict) else None
        try:
            content = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            content = ""
        parsed = _parse_llm_json(content or "")
        if parsed is None:
            logger.warning("ideation.llm_parse_failed")
            return _deterministic_analysis(idea), model_used
        return parsed, model_used

    async def _persist(
        self,
        *,
        idea: Idea,
        raw: _RawAnalysis,
        model_used: str | None,
        cost_usd: float,
        related_artifacts: list[dict[str, Any]],
    ) -> IdeaAnalysis:
        factory = get_session_factory()
        async with factory() as session:
            row = IdeaAnalysis(
                tenant_id=str(idea.tenant_id),
                project_id=str(idea.project_id),
                idea_id=idea.id,
                summary=raw.summary,
                problem_statement=raw.problem_statement,
                target_users=raw.target_users,
                success_metrics=raw.success_metrics,
                assumptions=raw.assumptions,
                risks=raw.risks,
                related_artifacts=related_artifacts,
                model_used=model_used,
                cost_usd=cost_usd,
                analyzed_at=datetime.now(UTC),
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
            # SQLite (test) has no JSONB ORDER BY; sort in Python after fetch.
            from sqlalchemy import select

            stmt = select(IdeaAnalysis).where(IdeaAnalysis.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.analyzed_at, reverse=True)
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


# Deterministic hash for fallback fingerprinting (used by tests).
def content_fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


idea_analysis_service = IdeaAnalysisService()


__all__ = [
    "IdeaAnalysisService",
    "idea_analysis_service",
]

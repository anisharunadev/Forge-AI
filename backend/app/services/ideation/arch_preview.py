"""Architecture Preview service (F-207).

Generates a React-Flow-friendly architecture preview for an idea:
- components (services, databases, queues, …)
- integrations (links between components)
- data flows (sequence-style flow blocks)
- risks

Uses LiteLLM with an architecture prompt and falls back to a
deterministic preview built from the project's existing knowledge
graph when the proxy is unreachable. Versioned, append-only.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.ideation import (
    ArchitecturePreview,
    Idea,
    IdeaAnalysis,
)
from app.db.session import get_session_factory
from app.services.cost_ledger import cost_ledger
from app.services.event_bus import EventType, bus as default_bus
from app.services.knowledge_graph import knowledge_graph_service
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Prompt + deterministic fallback
# ---------------------------------------------------------------------------


_ARCH_SYSTEM = (
    "You are a software architect. Given an idea + analysis, propose a "
    "minimal architecture. Return JSON with keys: "
    "components (list of {id, name, kind, metadata}), "
    "integrations (list of {from_component, to_component, kind, metadata}), "
    "data_flows (list of {step, description, source, target}), "
    "risks (list of {description, severity, mitigation}). "
    "Keep arrays between 2 and 8 items. Reply with JSON only."
)


def _arch_user_prompt(idea: Idea, analysis: IdeaAnalysis | None) -> str:
    parts = [f"IDEA: {idea.title}", idea.description or ""]
    if analysis is not None:
        parts.append(f"SUMMARY: {analysis.summary}")
        if analysis.target_users:
            parts.append(f"TARGET USERS: {', '.join(analysis.target_users)}")
        if analysis.risks:
            parts.append(f"KNOWN RISKS: {', '.join(analysis.risks)}")
    return "\n\n".join(parts)


@dataclass
class ArchPreviewPayload:
    components: list[dict[str, Any]] = field(default_factory=list)
    integrations: list[dict[str, Any]] = field(default_factory=list)
    data_flows: list[dict[str, Any]] = field(default_factory=list)
    risks: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "components": self.components,
            "integrations": self.integrations,
            "data_flows": self.data_flows,
            "risks": self.risks,
        }


def _parse_arch_json(content: str) -> ArchPreviewPayload | None:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return ArchPreviewPayload(
        components=[dict(c) for c in (data.get("components") or []) if isinstance(c, dict)],
        integrations=[dict(i) for i in (data.get("integrations") or []) if isinstance(i, dict)],
        data_flows=[dict(f) for f in (data.get("data_flows") or []) if isinstance(f, dict)],
        risks=[dict(r) for r in (data.get("risks") or []) if isinstance(r, dict)],
    )


async def _build_from_kg(
    *, tenant_id: UUID | str, project_id: UUID | str, idea: Idea
) -> ArchPreviewPayload:
    """When LiteLLM is offline, derive a minimal preview from the project KG."""
    try:
        nodes = await knowledge_graph_service.list_nodes(
            tenant_id=tenant_id,
            project_id=project_id,
            limit=50,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("arch_preview.kg_failed", error=str(exc))
        nodes = []

    components: list[dict[str, Any]] = []
    integrations: list[dict[str, Any]] = []
    for n in nodes[:8]:
        components.append(
            {
                "id": str(n.id),
                "name": n.name,
                "kind": n.node_type,
                "metadata": {"source": "knowledge_graph"},
            }
        )
    if not components:
        components = [
            {"id": "svc:api", "name": f"{idea.title} API", "kind": "service", "metadata": {"language": "python"}},
            {"id": "db:primary", "name": "Primary DB", "kind": "database_table", "metadata": {"engine": "postgres"}},
        ]
    # Add a tiny default integration if KG is sparse.
    if len(components) >= 2:
        integrations.append(
            {
                "from_component": components[0]["id"],
                "to_component": components[1]["id"],
                "kind": "reads_writes",
                "metadata": {"protocol": "tcp"},
            }
        )

    data_flows = [
        {
            "step": 1,
            "description": "Client request enters the API gateway.",
            "source": "client",
            "target": components[0]["id"],
        },
        {
            "step": 2,
            "description": "API persists state via the primary database.",
            "source": components[0]["id"],
            "target": components[1]["id"],
        },
    ]
    risks = [
        {
            "description": "Single point of failure at the primary database",
            "severity": "medium",
            "mitigation": "Add a managed backup + restore runbook.",
        },
        {
            "description": "Latency spikes under load",
            "severity": "medium",
            "mitigation": "Introduce a cache layer for hot reads.",
        },
    ]
    return ArchPreviewPayload(
        components=components,
        integrations=integrations,
        data_flows=data_flows,
        risks=risks,
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ArchPreviewService:
    """Tenant-scoped architecture preview generation."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def generate_preview(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str,
        model: str | None = None,
    ) -> ArchitecturePreview:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id
        analysis = await self._latest_analysis(idea.id)

        payload, model_used = await self._generate(
            idea=idea,
            analysis=analysis,
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
            model=model,
        )

        prompt_tokens = max(1, len(_arch_user_prompt(idea, analysis)) // 4)
        completion_tokens = max(
            1,
            sum(
                len(json.dumps(item, default=str))
                for items in (
                    payload.components,
                    payload.integrations,
                    payload.data_flows,
                    payload.risks,
                )
                for item in items
            )
            // 4,
        )
        cost_usd = round((prompt_tokens + completion_tokens) * 0.000_002, 6)

        preview = await self._persist(
            idea=idea,
            payload=payload,
            generated_by=str(actor_id),
        )

        try:
            await cost_ledger.record(
                tenant_id=tenant_id,
                project_id=effective_project_id,
                workflow_id=idea.id,
                model=model_used or "deterministic_arch",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
                source="ideation_arch_preview",
                metadata={"idea_id": str(idea.id)},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ideation.arch_cost_failed", error=str(exc))

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "domain": "ideation",
                "kind": "arch_preview",
                "idea_id": str(idea.id),
                "preview_id": str(preview.id),
                "model": model_used,
            },
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
        )
        return preview

    async def get_preview(
        self, idea_id: UUID | str, *, tenant_id: UUID | str
    ) -> ArchitecturePreview | None:
        await self._load_idea(idea_id, tenant_id=tenant_id)
        return await self._latest_preview(idea_id)

    async def regenerate_preview(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str,
        model: str | None = None,
    ) -> ArchitecturePreview:
        # Regenerate is the same flow — versions append automatically.
        return await self.generate_preview(
            idea_id,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            model=model,
        )

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
    ) -> tuple[ArchPreviewPayload, str | None]:
        messages = [
            {"role": "system", "content": _ARCH_SYSTEM},
            {"role": "user", "content": _arch_user_prompt(idea, analysis)},
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
            logger.warning("ideation.arch_llm_unavailable", error=str(exc))
            payload = await _build_from_kg(
                tenant_id=tenant_id,
                project_id=str(project_id or idea.project_id),
                idea=idea,
            )
            return payload, None

        model_used = response.get("model") if isinstance(response, dict) else None
        try:
            content = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            content = ""
        parsed = _parse_arch_json(content or "")
        if parsed is None:
            payload = await _build_from_kg(
                tenant_id=tenant_id,
                project_id=str(project_id or idea.project_id),
                idea=idea,
            )
            return payload, model_used
        return parsed, model_used

    async def _persist(
        self,
        *,
        idea: Idea,
        payload: ArchPreviewPayload,
        generated_by: str,
    ) -> ArchitecturePreview:
        factory = get_session_factory()
        async with factory() as session:
            previous = await self._latest_preview_in_session(session, str(idea.id))
            next_version = (previous.version + 1) if previous is not None else 1
            row = ArchitecturePreview(
                tenant_id=str(idea.tenant_id),
                project_id=str(idea.project_id),
                idea_id=idea.id,
                version=next_version,
                components=payload.components,
                integrations=payload.integrations,
                data_flows=payload.data_flows,
                risks=payload.risks,
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

    async def _latest_preview(self, idea_id: UUID | str) -> ArchitecturePreview | None:
        factory = get_session_factory()
        async with factory() as session:
            return await self._latest_preview_in_session(session, str(idea_id))

    async def _latest_preview_in_session(
        self, session: Any, idea_id: str
    ) -> ArchitecturePreview | None:
        stmt = select(ArchitecturePreview).where(
            ArchitecturePreview.idea_id == idea_id
        )
        rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.version, reverse=True)
        return rows[0]


arch_preview_service = ArchPreviewService()


__all__ = ["ArchPreviewService", "arch_preview_service"]

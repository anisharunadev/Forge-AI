"""F-301 — ADR Generator (MADR format).

Produces Architecture Decision Records using LiteLLM, persists them
sequentially per project, and emits domain events on creation /
supersession.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.architecture import ADR
from app.db.session import get_session_factory
from app.services.event_bus import EventType

logger = get_logger(__name__)


# MADR 4.0 front-matter prompt. The model is asked to return strict JSON
# so we can map fields directly onto the ADR row.
MADR_SYSTEM_PROMPT = """You are a senior software architect that authors
Architecture Decision Records in the MADR 4.0 format.

Given a problem, the surrounding forces, and any constraints, produce a
single ADR. Return ONLY a JSON object with these keys:

{
  "title": "<short imperative sentence>",
  "status": "proposed" | "accepted" | "deprecated" | "superseded",
  "context": "<2-6 paragraphs describing the problem, forces, constraints>",
  "decision": "<1-3 paragraphs stating the chosen option and why>",
  "consequences": {
    "positive": ["..."],
    "negative": ["..."],
    "neutral": ["..."]
  },
  "alternatives": [
    {"name": "...", "summary": "...", "rejected_because": "..."}
  ]
}

Do not include markdown fences. Do not include commentary outside the JSON.
"""


class ADRGenerator:
    """Generate, fetch, and supersede ADRs."""

    def __init__(
        self,
        litellm_client: Any,
        artifact_registry: Any | None = None,
        event_bus: Any | None = None,
    ) -> None:
        from app.services.artifact_registry import artifact_registry as _default_registry

        self._llm = litellm_client
        self._registry = artifact_registry if artifact_registry is not None else _default_registry
        self._bus = event_bus

    async def generate_adr(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        context: dict[str, Any],
        actor_id: UUID | str,
    ) -> ADR:
        """Produce an ADR from the supplied context and persist it."""
        title_hint = context.get("title", "Untitled decision")
        problem = context.get("problem", "")
        forces = context.get("forces", [])
        constraints = context.get("constraints", [])
        related_adrs = list(context.get("related_adrs", []))
        related_artifacts = list(context.get("related_artifacts", []))

        user_payload = {
            "title_hint": title_hint,
            "problem": problem,
            "forces": forces,
            "constraints": constraints,
            "related_adrs": related_adrs,
            "related_artifacts": related_artifacts,
        }
        messages = [
            {"role": "system", "content": MADR_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload)},
        ]

        async with self._llm as client:
            response = await client.chat(
                messages=messages,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )

        parsed = _extract_json(response)

        factory = get_session_factory()
        async with factory() as session:  # type: AsyncSession
            number = await self._next_number(session, tenant_id, project_id)
            adr = ADR(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                number=number,
                title=parsed.get("title") or title_hint,
                status=parsed.get("status") or "proposed",
                context=parsed.get("context") or problem,
                decision=parsed.get("decision") or "",
                consequences=_as_dict(parsed.get("consequences")),
                alternatives=_as_list(parsed.get("alternatives")),
                related_adrs=[str(x) for x in related_adrs],
                generated_by=str(actor_id),
            )
            session.add(adr)
            await session.commit()
            await session.refresh(adr)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "artifact_type": "adr",
                "adr_id": str(adr.id),
                "number": adr.number,
                "title": adr.title,
                "status": adr.status,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        # M5-G2 — mirror the ADR row into the Knowledge Graph so the
        # React Flow viz (M8) and downstream features see a typed
        # ``KGNode(artifact_type='adr')`` node. Idempotency is left to
        # the consumer (the KG is append-only by Rule 4).
        await self._registry.register(
            artifact_type="adr",
            artifact_id=str(adr.id),
            tenant_id=tenant_id,
            project_id=project_id,
            payload={
                "number": adr.number,
                "title": adr.title,
                "status": adr.status,
            },
            actor_id=actor_id,
        )
        logger.info(
            "adr.created",
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            adr_id=str(adr.id),
            number=adr.number,
        )
        return adr

    async def supersede_adr(
        self,
        adr_id: UUID | str,
        new_adr_id: UUID | str,
    ) -> ADR:
        """Mark an ADR as superseded; return the replacement.

        History is chained through `related_adrs` on the new ADR so a
        future generator sees the prior decisions.
        """
        factory = get_session_factory()
        async with factory() as session:
            current = await session.get(ADR, str(adr_id))
            replacement = await session.get(ADR, str(new_adr_id))
            if current is None or replacement is None:
                raise LookupError("ADR not found for supersession")
            if current.tenant_id != replacement.tenant_id:
                raise ValueError("ADR cross-tenant supersession rejected")

            current.status = "superseded"
            existing = list(current.related_adrs or [])
            if str(current.id) not in existing:
                existing.append(str(current.id))
            replacement.related_adrs = existing
            await session.commit()
            await session.refresh(replacement)

        await self._bus.publish(
            EventType.ARTIFACT_SUPERSEDED,
            {
                "artifact_type": "adr",
                "superseded_id": str(adr_id),
                "new_id": str(new_adr_id),
            },
            tenant_id=replacement.tenant_id,
            project_id=replacement.project_id,
            actor_id=None,
        )
        return replacement

    async def get_adr(self, adr_id: UUID | str) -> ADR | None:
        factory = get_session_factory()
        async with factory() as session:
            return await session.get(ADR, str(adr_id))

    async def list_adrs(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        status: str | None = None,
    ) -> list[ADR]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(ADR).where(
                ADR.tenant_id == str(tenant_id),
                ADR.project_id == str(project_id),
            )
            if status is not None:
                stmt = stmt.where(ADR.status == status)
            stmt = stmt.order_by(ADR.number.asc())
            return list((await session.execute(stmt)).scalars().all())

    async def _next_number(
        self,
        session: AsyncSession,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> int:
        """Return 1 + the current max number for the (tenant, project)."""
        stmt = select(func.coalesce(func.max(ADR.number), 0)).where(
            ADR.tenant_id == str(tenant_id),
            ADR.project_id == str(project_id),
        )
        current = (await session.execute(stmt)).scalar_one()
        return int(current) + 1


def _extract_json(response: Any) -> dict[str, Any]:
    """Pull a JSON object out of a LiteLLM response.

    The proxy returns OpenAI-shaped dicts; ``choices[0].message.content``
    carries the assistant message. We accept a bare dict for tests that
    pass a stubbed response.
    """
    if isinstance(response, dict) and "choices" in response:
        content = response["choices"][0]["message"]["content"]
    elif isinstance(response, dict):
        return response
    else:
        content = str(response)

    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


__all__ = ["ADRGenerator", "MADR_SYSTEM_PROMPT"]

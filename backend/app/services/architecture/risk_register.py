"""F-304 — Risk Register service.

Derives a project risk ledger from an ADR, a task breakdown, or a
free-form idea. Risks are scored (likelihood * impact, 1-25) and the
top-N can be surfaced for review.
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.core.logging import get_logger
from app.db.models.architecture import ADR, RiskRegister, TaskBreakdown
from app.db.session import get_session_factory
from app.services.event_bus import EventType

logger = get_logger(__name__)


_RISK_PROMPT = """You are a senior risk analyst. Given the supplied
source artifact (ADR, task breakdown, or idea), produce a JSON object
of the form:

{
  "name": "<short label>",
  "mitigation_strategy": "<1-3 sentence overall mitigation framing>",
  "risks": [
    {
      "id": "<stable slug, e.g. RISK-1>",
      "title": "<imperative risk statement>",
      "category": "technical" | "security" | "operational" | "business" | "compliance",
      "likelihood": <1-5>,
      "impact": <1-5>,
      "mitigation": "<1-3 sentences>",
      "owner": "<role or team>"
    }
  ]
}

Use categories sparingly and realistically — at least three distinct
categories if the input is non-trivial. No markdown, no commentary.
"""


VALID_CATEGORIES = {"technical", "security", "operational", "business", "compliance"}
VALID_STATUSES = {"open", "mitigating", "closed", "accepted"}


class RiskRegisterService:
    """Generate, fetch, and update risk registers."""

    def __init__(
        self,
        litellm_client: Any,
        artifact_registry: Any,
        event_bus: Any,
        idea_service: Any | None = None,
    ) -> None:
        self._llm = litellm_client
        self._registry = artifact_registry
        self._bus = event_bus
        self._idea_service = idea_service

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    async def generate_from_adr(
        self,
        adr_id: UUID | str,
        actor_id: UUID | str,
    ) -> RiskRegister:
        """Read an ADR and ask the LLM to derive a risk register."""
        factory = get_session_factory()
        async with factory() as session:
            adr = await session.get(ADR, str(adr_id))
            if adr is None:
                raise LookupError("adr_not_found")
            tenant_id = adr.tenant_id
            project_id = adr.project_id
            source_payload = {
                "source_type": "adr",
                "number": adr.number,
                "title": adr.title,
                "status": adr.status,
                "context": adr.context,
                "decision": adr.decision,
                "consequences": adr.consequences,
                "alternatives": adr.alternatives,
            }

        risks, name, strategy = await self._ask_llm(source_payload, tenant_id, project_id, actor_id)

        return await self._persist(
            tenant_id=tenant_id,
            project_id=project_id,
            name=name or f"Risks for ADR #{source_payload['number']}",
            mitigation_strategy=strategy,
            risks=risks,
            actor_id=actor_id,
            source_type="adr",
            source_id=str(adr_id),
        )

    async def generate_from_breakdown(
        self,
        breakdown_id: UUID | str,
        actor_id: UUID | str,
    ) -> RiskRegister:
        """Read a task breakdown and ask the LLM to derive a risk register."""
        factory = get_session_factory()
        async with factory() as session:
            breakdown = await session.get(TaskBreakdown, str(breakdown_id))
            if breakdown is None:
                raise LookupError("task_breakdown_not_found")
            tenant_id = breakdown.tenant_id
            project_id = breakdown.project_id
            source_payload = {
                "source_type": "task_breakdown",
                "name": breakdown.name,
                "parent_artifact_type": breakdown.parent_artifact_type,
                "parent_artifact_id": str(breakdown.parent_artifact_id),
                "tasks": breakdown.tasks,
                "total_estimate_hours": breakdown.total_estimate_hours,
            }

        risks, name, strategy = await self._ask_llm(source_payload, tenant_id, project_id, actor_id)

        return await self._persist(
            tenant_id=tenant_id,
            project_id=project_id,
            name=name or f"Risks for {breakdown.name}",
            mitigation_strategy=strategy,
            risks=risks,
            actor_id=actor_id,
            source_type="breakdown",
            source_id=str(breakdown_id),
        )

    async def generate_from_idea(
        self,
        idea_id: UUID | str,
        actor_id: UUID | str,
    ) -> RiskRegister:
        """Derive a register from an Ideation idea (cross-service).

        Delegates to an injected `idea_service` (kept optional so the
        risk register can be exercised without coupling to ideation in
        tests / when ideation is disabled).
        """
        if self._idea_service is None:
            raise RuntimeError(
                "RiskRegisterService.generate_from_idea requires an idea_service "
                "(cross-service dependency not wired)"
            )

        idea = await self._idea_service.get_idea(idea_id)
        if idea is None:
            raise LookupError("idea_not_found")

        tenant_id = getattr(idea, "tenant_id", None) or uuid.uuid4()
        project_id = getattr(idea, "project_id", None) or uuid.uuid4()

        source_payload = {
            "source_type": "idea",
            "idea_id": str(idea_id),
            "title": getattr(idea, "title", ""),
            "description": getattr(idea, "description", ""),
            "problem": getattr(idea, "problem_statement", ""),
            "tags": getattr(idea, "tags", []) or [],
        }

        risks, name, strategy = await self._ask_llm(
            source_payload, tenant_id, project_id, actor_id
        )

        return await self._persist(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            name=name or f"Risks for idea {source_payload['title'][:40]}",
            mitigation_strategy=strategy,
            risks=risks,
            actor_id=actor_id,
            source_type="idea",
            source_id=str(idea_id),
        )

    # ------------------------------------------------------------------
    # Fetch / mutate
    # ------------------------------------------------------------------

    async def get_register(
        self, register_id: UUID | str
    ) -> RiskRegister | None:
        factory = get_session_factory()
        async with factory() as session:
            return await session.get(RiskRegister, str(register_id))

    async def list_for_project(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        status: str | None = None,
    ) -> list[RiskRegister]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(RiskRegister)
                .where(
                    RiskRegister.tenant_id == str(tenant_id),
                    RiskRegister.project_id == str(project_id),
                )
                .order_by(RiskRegister.created_at.desc())
            )
            if status is not None:
                stmt = stmt.where(RiskRegister.status == status)
            return list((await session.execute(stmt)).scalars().all())

    async def add_risk(
        self,
        register_id: UUID | str,
        risk: dict[str, Any],
        actor_id: UUID | str,
    ) -> RiskRegister:
        """Append a single risk to an existing register."""
        factory = get_session_factory()
        async with factory() as session:
            register = await session.get(RiskRegister, str(register_id))
            if register is None:
                raise LookupError("risk_register_not_found")
            risks = [dict(r) for r in (register.risks or [])]
            risks.append(_normalize_risk(risk, risks))
            register.risks = risks
            flag_modified(register, "risks")
            await session.commit()
            await session.refresh(register)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": "risk_register",
                "register_id": str(register.id),
                "operation": "add_risk",
                "risk_count": len(register.risks or []),
            },
            tenant_id=register.tenant_id,
            project_id=register.project_id,
            actor_id=actor_id,
        )
        return register

    async def update_risk(
        self,
        register_id: UUID | str,
        risk_id: str,
        updates: dict[str, Any],
        actor_id: UUID | str,
    ) -> RiskRegister:
        """Apply a partial update to one risk inside the register."""
        allowed_keys = {
            "title",
            "category",
            "likelihood",
            "impact",
            "mitigation",
            "owner",
            "status",
        }
        factory = get_session_factory()
        async with factory() as session:
            register = await session.get(RiskRegister, str(register_id))
            if register is None:
                raise LookupError("risk_register_not_found")
            risks = [dict(r) for r in (register.risks or [])]
            target = next(
                (r for r in risks if str(r.get("id")) == str(risk_id)),
                None,
            )
            if target is None:
                raise LookupError(f"risk_not_found:{risk_id}")
            for key, value in updates.items():
                if key in allowed_keys:
                    target[key] = value
            target["score"] = _score(target)
            register.risks = risks
            flag_modified(register, "risks")
            await session.commit()
            await session.refresh(register)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": "risk_register",
                "register_id": str(register.id),
                "operation": "update_risk",
                "risk_id": str(risk_id),
                "fields": list(updates.keys()),
            },
            tenant_id=register.tenant_id,
            project_id=register.project_id,
            actor_id=actor_id,
        )
        return register

    async def get_top_risks(
        self,
        register_id: UUID | str,
        top_n: int = 5,
    ) -> list[dict[str, Any]]:
        """Return the top-N risks sorted by score (desc), then title asc."""
        register = await self.get_register(register_id)
        if register is None:
            return []
        scored = sorted(
            list(register.risks or []),
            key=lambda r: (-int(r.get("score") or 0), str(r.get("title") or "")),
        )
        return scored[: max(1, int(top_n))]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _ask_llm(
        self,
        payload: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> tuple[list[dict[str, Any]], str, str]:
        """Call the LLM and return (risks, name, mitigation_strategy)."""
        messages = [
            {"role": "system", "content": _RISK_PROMPT},
            {"role": "user", "content": json.dumps(payload)},
        ]
        async with self._llm as client:
            response = await client.chat(
                messages=messages,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )
        parsed = _extract_json(response)
        risks = _normalize_risks(parsed.get("risks") or [])
        name = str(parsed.get("name") or "")
        strategy = str(parsed.get("mitigation_strategy") or "")
        return risks, name, strategy

    async def _persist(
        self,
        tenant_id: str,
        project_id: str,
        name: str,
        mitigation_strategy: str,
        risks: list[dict[str, Any]],
        actor_id: UUID | str,
        source_type: str,
        source_id: str,
    ) -> RiskRegister:
        factory = get_session_factory()
        async with factory() as session:
            register = RiskRegister(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                name=name,
                risks=risks,
                mitigation_strategy=mitigation_strategy,
                status="draft",
                generated_by=str(actor_id),
            )
            session.add(register)
            await session.commit()
            await session.refresh(register)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "artifact_type": "risk_register",
                "register_id": str(register.id),
                "source_type": source_type,
                "source_id": source_id,
                "risk_count": len(risks),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        logger.info(
            "risk_register.created",
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            register_id=str(register.id),
            risk_count=len(risks),
            source_type=source_type,
        )
        return register


def _score(risk: dict[str, Any]) -> int:
    likelihood = int(risk.get("likelihood") or 0)
    impact = int(risk.get("impact") or 0)
    return max(1, min(25, likelihood * impact))


def _normalize_risk(
    item: dict[str, Any],
    existing: list[dict[str, Any]],
) -> dict[str, Any]:
    """Coerce a single risk dict into the canonical shape with score."""
    if not isinstance(item, dict):
        item = {"title": str(item)}
    risk_id = str(item.get("id") or f"RISK-{len(existing) + 1}-{uuid.uuid4().hex[:6]}")
    category = str(item.get("category") or "technical")
    if category not in VALID_CATEGORIES:
        category = "technical"
    likelihood = _clamp(item.get("likelihood"))
    impact = _clamp(item.get("impact"))
    status = str(item.get("status") or "open")
    if status not in VALID_STATUSES:
        status = "open"
    return {
        "id": risk_id,
        "title": item.get("title") or risk_id,
        "category": category,
        "likelihood": likelihood,
        "impact": impact,
        "score": likelihood * impact,
        "mitigation": item.get("mitigation") or "",
        "owner": item.get("owner") or "",
        "status": status,
    }


def _normalize_risks(raw: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for idx, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            continue
        if "id" not in item:
            item = {**item, "id": f"RISK-{idx}"}
        out.append(_normalize_risk(item, out))
    return out


def _clamp(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 1
    return max(1, min(5, n))


def _extract_json(response: Any) -> dict[str, Any]:
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


__all__ = ["RiskRegisterService", "VALID_CATEGORIES", "VALID_STATUSES"]

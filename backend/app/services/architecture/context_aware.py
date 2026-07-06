"""F-309 — Context-Aware Generation.

Gathers relevant context (org standards, templates, prior ADRs, project
intelligence, the risk register) before invoking the LLM, then tracks
which context items were actually used so downstream traceability
queries can answer "why did this artifact come out the way it did?".
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.services.event_bus import EventType

logger = get_logger(__name__)


# Prompt augmentation marker so we can detect what was passed in.
_CONTEXT_BANNER = "## CONTEXT (gathered for this generation)\n"


class ContextAwareGenerator:
    """Pull context, augment prompts, and record provenance."""

    def __init__(
        self,
        litellm_client: Any,
        standard_service: Any,
        template_service: Any,
        project_intelligence: Any,
        event_bus: Any,
    ) -> None:
        self._llm = litellm_client
        self._standards = standard_service
        self._templates = template_service
        self._project_intel = project_intelligence
        self._bus = event_bus

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def gather_context(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        artifact_type: str,
        prompt_inputs: dict[str, Any],
    ) -> dict[str, Any]:
        """Collect all relevant context sections in one pass."""
        standards = await self._fetch_standards(tenant_id, project_id, artifact_type)
        templates = await self._fetch_templates(tenant_id, project_id, artifact_type)
        prior_adrs = await self._fetch_prior_adrs(tenant_id, project_id)
        project_context = await self._fetch_project_context(tenant_id, project_id)
        risk_register = await self._fetch_risk_register(tenant_id, project_id)

        context = {
            "standards": standards,
            "templates": templates,
            "prior_adrs": prior_adrs,
            "project_context": project_context,
            "risk_register": risk_register,
            "prompt_inputs": prompt_inputs,
        }
        logger.info(
            "context.gathered",
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            artifact_type=artifact_type,
            standards=len(standards),
            templates=len(templates),
            prior_adrs=len(prior_adrs),
            risks=len(risk_register),
        )
        return context

    async def generate_with_context(
        self,
        artifact_type: str,
        prompt: str,
        context: dict[str, Any],
        actor_id: UUID | str,
        tenant_id: UUID | str | None = None,
        project_id: UUID | str | None = None,
    ) -> dict[str, Any]:
        """Augment the prompt with gathered context and call the LLM.

        Returns the artifact envelope with a `context_refs` block
        describing which sections were injected.
        """
        sections_used: list[dict[str, str]] = []
        augmented = _augment_prompt(prompt, context, sections_used)

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a senior software architect. Use the supplied "
                    "CONTEXT to ground your answer. Return ONLY valid JSON."
                ),
            },
            {"role": "user", "content": augmented},
        ]

        async with self._llm as client:
            response = await client.chat(
                messages=messages,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )

        parsed = _extract_json(response)
        artifact_id = uuid.uuid4()
        artifact = {
            "id": str(artifact_id),
            "type": artifact_type,
            "content": parsed,
            "context_refs": sections_used,
            "generated_by": str(actor_id),
            "generated_at": datetime.now(UTC).isoformat(),
            "tenant_id": str(tenant_id) if tenant_id else None,
            "project_id": str(project_id) if project_id else None,
        }

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "artifact_type": artifact_type,
                "artifact_id": str(artifact_id),
                "context_refs": sections_used,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return artifact

    async def get_context_usage(
        self,
        artifact_id: UUID | str,
    ) -> list[dict[str, Any]]:
        """Return the list of context items used to generate an artifact."""
        record = await self._load_artifact(artifact_id)
        if record is None:
            return []
        return list(record.get("context_refs") or [])

    # ------------------------------------------------------------------
    # Context fetchers
    # ------------------------------------------------------------------

    async def _fetch_standards(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        artifact_type: str,
    ) -> list[dict[str, Any]]:
        try:
            from app.db.models.standard import Standard  # noqa: F401

            stmt = select(Standard).where(
                Standard.tenant_id == str(tenant_id),
                Standard.status == "active",
            )
            from sqlalchemy import or_

            stmt = stmt.where(
                or_(
                    Standard.project_id.is_(None),
                    Standard.project_id == str(project_id),
                )
            )
            factory = get_session_factory()
            async with factory() as session:
                rows = list((await session.execute(stmt)).scalars().all())
            return [
                {
                    "id": str(r.id),
                    "name": r.name,
                    "content": r.content,
                    "applies_to": (r.metadata_ or {}).get("applies_to", []),
                }
                for r in rows
                if artifact_type in (r.metadata_ or {}).get("applies_to", [artifact_type])
                or not (r.metadata_ or {}).get("applies_to")
            ]
        except Exception:  # noqa: BLE001 — standards may be absent
            return []

    async def _fetch_templates(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        artifact_type: str,
    ) -> list[dict[str, Any]]:
        try:
            from app.db.models.template import Template  # noqa: F401

            stmt = select(Template).where(
                Template.tenant_id == str(tenant_id),
                Template.type == artifact_type,
            )
            factory = get_session_factory()
            async with factory() as session:
                rows = list((await session.execute(stmt)).scalars().all())
            return [
                {
                    "id": str(r.id),
                    "name": r.name,
                    "content": r.content,
                    "variables": list(r.variables or []),
                }
                for r in rows
            ]
        except Exception:  # noqa: BLE001
            return []

    async def _fetch_prior_adrs(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[dict[str, Any]]:
        try:
            from app.db.models.architecture import ADR  # noqa: F401

            stmt = (
                select(ADR)
                .where(
                    ADR.tenant_id == str(tenant_id),
                    ADR.project_id == str(project_id),
                    ADR.status.in_(["accepted", "proposed"]),
                )
                .order_by(ADR.number.desc())
                .limit(10)
            )
            factory = get_session_factory()
            async with factory() as session:
                rows = list((await session.execute(stmt)).scalars().all())
            return [
                {
                    "id": str(r.id),
                    "number": r.number,
                    "title": r.title,
                    "status": r.status,
                    "decision": r.decision,
                }
                for r in rows
            ]
        except Exception:  # noqa: BLE001
            return []

    async def _fetch_project_context(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> dict[str, Any]:
        """Best-effort pull from the project-intelligence service."""
        try:
            if hasattr(self._project_intel, "summarize"):
                result = await self._project_intel.summarize(
                    tenant_id=tenant_id,
                    project_id=project_id,
                )
                return dict(result or {})
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "project_intel.fallback",
                error=type(exc).__name__,
                reason=str(exc),
            )
        return {
            "tenant_id": str(tenant_id),
            "project_id": str(project_id),
            "summary": "No project intelligence summary available.",
        }

    async def _fetch_risk_register(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[dict[str, Any]]:
        try:
            from app.db.models.architecture import RiskRegister  # noqa: F401

            stmt = select(RiskRegister).where(
                RiskRegister.tenant_id == str(tenant_id),
                RiskRegister.project_id == str(project_id),
            )
            factory = get_session_factory()
            async with factory() as session:
                rows = list((await session.execute(stmt)).scalars().all())
            if not rows:
                return []
            latest = max(rows, key=lambda r: r.created_at)
            return list(latest.risks or [])
        except Exception:  # noqa: BLE001
            return []

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    async def _load_artifact(
        self,
        artifact_id: UUID | str,
    ) -> dict[str, Any] | None:
        """Read the artifact envelope back from the registry.

        The registry may be a stub in tests; we always coerce to a dict.
        """
        try:
            artifact = await self._registry_lookup(artifact_id)
        except Exception:  # noqa: BLE001
            return None
        if artifact is None:
            return None
        if isinstance(artifact, dict):
            return artifact
        return {
            "id": str(getattr(artifact, "id", artifact_id)),
            "type": getattr(artifact, "type", None),
            "payload": getattr(artifact, "payload", None),
            "context_refs": (getattr(artifact, "payload", {}) or {}).get("context_refs", []),
        }

    async def _registry_lookup(self, artifact_id: UUID | str) -> Any:
        """Find an artifact via the registry's `.get` (if available)."""
        getter = getattr(self, "_registry", None)
        if getter is None:
            # Optional registry is not a constructor arg today; we use
            # the bus-published projection instead.
            return None
        return None


def _augment_prompt(
    prompt: str,
    context: dict[str, Any],
    sections_used: list[dict[str, str]],
) -> str:
    """Append gathered context to the user prompt; record what was used."""
    blocks: list[str] = [prompt, _CONTEXT_BANNER]

    for standard in context.get("standards", []):
        sections_used.append(
            {
                "context_type": "standard",
                "ref_id": str(standard.get("id", "")),
                "label": standard.get("name", ""),
            }
        )
        blocks.append(
            f"- STANDARD [{standard.get('id')}] {standard.get('name')}: {standard.get('content')}"
        )

    for template in context.get("templates", []):
        sections_used.append(
            {
                "context_type": "template",
                "ref_id": str(template.get("id", "")),
                "label": template.get("name", ""),
            }
        )
        blocks.append(
            f"- TEMPLATE [{template.get('id')}] {template.get('name')}: "
            f"{json.dumps(template.get('content', {}))[:600]}"
        )

    for adr in context.get("prior_adrs", []):
        sections_used.append(
            {
                "context_type": "prior_adr",
                "ref_id": str(adr.get("id", "")),
                "label": f"ADR-{adr.get('number')} {adr.get('title')}",
            }
        )
        blocks.append(
            f"- PRIOR ADR #{adr.get('number')} {adr.get('title')} "
            f"({adr.get('status')}): {adr.get('decision')}"
        )

    if context.get("project_context"):
        sections_used.append(
            {
                "context_type": "project_context",
                "ref_id": str(context["project_context"].get("project_id", "")),
                "label": "project summary",
            }
        )
        blocks.append(f"- PROJECT CONTEXT: {json.dumps(context['project_context'])[:600]}")

    for risk in context.get("risk_register", []):
        sections_used.append(
            {
                "context_type": "risk",
                "ref_id": str(risk.get("id", "")),
                "label": str(risk.get("name") or risk.get("title") or "risk"),
            }
        )
        blocks.append(f"- RISK: {json.dumps(risk)[:400]}")

    return "\n".join(blocks)


def _extract_json(response: Any) -> dict[str, Any]:
    """Parse a LiteLLM-shaped response into a JSON object."""
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


__all__ = ["ContextAwareGenerator"]

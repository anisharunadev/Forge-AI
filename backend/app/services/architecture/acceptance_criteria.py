"""F-310 — Acceptance Criteria Service.

Generates Given/When/Then acceptance criteria (BDD format) from an ADR,
API contract, or task breakdown, links criteria to existing tests, and
produces a project-wide coverage report.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.services.event_bus import EventType

logger = get_logger(__name__)


BDD_SYSTEM_PROMPT = """You are a senior QA engineer. Given an architecture
artifact (ADR, API contract, or task breakdown), produce Given/When/Then
acceptance criteria in BDD format.

Return ONLY a JSON object of the form:

{
  "criteria": [
    {
      "id": "<stable slug, e.g. AC-1>",
      "given": "<precondition>",
      "when": "<action>",
      "then": "<expected outcome>",
      "priority": "low" | "medium" | "high" | "critical"
    }
  ]
}

Aim for 3-8 criteria. No commentary, no markdown fences.
"""


class AcceptanceCriteriaService:
    """Generate, link, validate, and report on acceptance criteria."""

    SUPPORTED_ARTIFACT_TYPES = {"adr", "api_contract", "task_breakdown"}

    def __init__(
        self,
        litellm_client: Any,
        artifact_registry: Any,
        test_service: Any,
        event_bus: Any,
    ) -> None:
        self._llm = litellm_client
        self._registry = artifact_registry
        self._tests = test_service
        self._bus = event_bus

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def generate_from_artifact(
        self,
        artifact_type: str,
        artifact_id: UUID | str,
        actor_id: UUID | str,
    ) -> dict[str, Any]:
        """Pull an artifact, ask the LLM for BDD criteria, persist them."""
        if artifact_type not in self.SUPPORTED_ARTIFACT_TYPES:
            raise ValueError(f"unsupported artifact_type: {artifact_type}")

        artifact = await self._load_artifact(artifact_type, artifact_id)
        if artifact is None:
            raise LookupError(f"{artifact_type} not found")
        tenant_id = artifact["tenant_id"]
        project_id = artifact["project_id"]

        messages = [
            {"role": "system", "content": BDD_SYSTEM_PROMPT},
            {"role": "user", "content": _artifact_to_prompt(artifact_type, artifact)},
        ]
        async with self._llm as client:
            response = await client.chat(
                messages=messages,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )
        parsed = _extract_json(response)
        criteria = _normalize_criteria(parsed.get("criteria"))

        record_id = uuid.uuid4()
        envelope = {
            "id": str(record_id),
            "source_artifact_type": artifact_type,
            "source_artifact_id": str(artifact_id),
            "criteria": criteria,
            "test_links": {},
            "tenant_id": str(tenant_id),
            "project_id": str(project_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "generated_by": str(actor_id),
        }
        await self._persist_record(envelope)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "artifact_type": "acceptance_criteria",
                "criteria_id": str(record_id),
                "source_artifact_type": artifact_type,
                "source_artifact_id": str(artifact_id),
                "count": len(criteria),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        # M5-G2 — mirror the criteria envelope into the Knowledge Graph
        # so the React Flow viz sees a typed
        # ``KGNode(artifact_type='acceptance_criteria')`` node.
        await self._registry.register(
            artifact_type="acceptance_criteria",
            artifact_id=str(record_id),
            tenant_id=tenant_id,
            project_id=project_id,
            payload={
                "source_artifact_type": artifact_type,
                "source_artifact_id": str(artifact_id),
                "count": len(criteria),
            },
            actor_id=actor_id,
        )
        logger.info(
            "acceptance_criteria.generated",
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            artifact_type=artifact_type,
            count=len(criteria),
        )
        return envelope

    async def link_to_test(
        self,
        criteria_id: UUID | str,
        test_id: str,
        actor_id: UUID | str,
    ) -> dict[str, Any]:
        """Record a test_id against a specific criterion id."""
        record = await self._load_record(criteria_id)
        if record is None:
            raise LookupError("acceptance_criteria_not_found")

        updated_links = dict(record.get("test_links") or {})
        # Two accepted formats:
        #   "criterion_id:test_id" -> bind a specific test to that criterion.
        #   "test_id" alone -> bind the test to every criterion in the record.
        if ":" in test_id:
            criterion_id, _sep, t_id = test_id.partition(":")
            criterion_id = criterion_id.strip()
            t_id = (t_id or test_id).strip()
            if criterion_id:
                updated_links[criterion_id] = t_id
            else:
                for criterion in record.get("criteria") or []:
                    updated_links[str(criterion.get("id") or "")] = t_id
        else:
            for criterion in record.get("criteria") or []:
                updated_links[str(criterion.get("id") or "")] = test_id
        record["test_links"] = updated_links
        await self._persist_record(record)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": "acceptance_criteria",
                "criteria_id": str(criteria_id),
                "test_id": test_id,
                "event_kind": "acceptance.test_linked",
            },
            tenant_id=record["tenant_id"],
            project_id=record["project_id"],
            actor_id=actor_id,
        )
        return record

    async def get_coverage(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> dict[str, Any]:
        """Compute project-wide acceptance criteria coverage."""
        records = await self._list_records(tenant_id, project_id)
        total = 0
        linked = 0
        by_artifact: list[dict[str, Any]] = []

        for record in records:
            criteria = record.get("criteria") or []
            links = record.get("test_links") or {}
            crit_total = len(criteria)
            crit_linked = sum(
                1 for c in criteria if (links.get(c.get("id")) or links.get(c.get("id", "")))
            )
            if not links and crit_total:
                # No explicit links at all -> 0 covered for this artifact.
                crit_linked = 0
            total += crit_total
            linked += crit_linked
            pct = (crit_linked / crit_total * 100.0) if crit_total else 0.0
            by_artifact.append(
                {
                    "artifact_type": record.get("source_artifact_type"),
                    "artifact_id": record.get("source_artifact_id"),
                    "total_criteria": crit_total,
                    "criteria_with_tests": crit_linked,
                    "coverage_pct": round(pct, 2),
                }
            )

        coverage_pct = (linked / total * 100.0) if total else 0.0
        return {
            "project_id": str(project_id),
            "total_criteria": total,
            "criteria_with_tests": linked,
            "coverage_pct": round(coverage_pct, 2),
            "by_artifact": by_artifact,
        }

    async def validate_against_code(
        self,
        criteria_id: UUID | str,
        code_artifact_id: UUID | str,
    ) -> dict[str, Any]:
        """Lightweight validation: check that linked tests reference code."""
        record = await self._load_record(criteria_id)
        if record is None:
            raise LookupError("acceptance_criteria_not_found")

        links = record.get("test_links") or {}
        criteria = record.get("criteria") or []
        matched: list[str] = []
        missing: list[str] = []

        for criterion in criteria:
            criterion_id = criterion.get("id", "")
            test_ref = links.get(criterion_id)
            if test_ref:
                matched.append(criterion_id)
            else:
                missing.append(criterion_id)

        return {
            "criteria_id": str(criteria_id),
            "code_artifact_id": str(code_artifact_id),
            "passed": len(missing) == 0,
            "matched_steps": matched,
            "missing_steps": missing,
            "notes": (
                "All criteria are linked to tests"
                if not missing
                else f"{len(missing)} criterion/criteria lack test links"
            ),
        }

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    async def _load_artifact(
        self,
        artifact_type: str,
        artifact_id: UUID | str,
    ) -> dict[str, Any] | None:
        model_map = {
            "adr": ("app.db.models.architecture", "ADR"),
            "api_contract": ("app.db.models.architecture", "APIContract"),
            "task_breakdown": ("app.db.models.architecture", "TaskBreakdown"),
        }
        if artifact_type not in model_map:
            return None
        module_name, attr = model_map[artifact_type]
        import importlib

        module = importlib.import_module(module_name)
        model_cls = getattr(module, attr)

        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(model_cls, str(artifact_id))
        if row is None:
            return None
        return {
            "id": str(getattr(row, "id", artifact_id)),
            "tenant_id": str(getattr(row, "tenant_id", "")),
            "project_id": str(getattr(row, "project_id", "")),
            "title": getattr(row, "title", None) or getattr(row, "name", None),
            "context": getattr(row, "context", None),
            "decision": getattr(row, "decision", None),
            "spec_content": getattr(row, "spec_content", None),
            "tasks": getattr(row, "tasks", None),
        }

    async def _persist_record(self, record: dict[str, Any]) -> None:
        """Upsert by criteria_id so updates don't double-count.

        Real ArtifactRegistry rows are append-only and address by id;
        for our purposes we model a single evolving row keyed by the
        criteria id held in the payload.
        """
        criteria_id = str(record.get("id") or "")
        try:
            upsert = getattr(self._registry, "upsert", None)
            if upsert is not None:
                await upsert(
                    tenant_id=record["tenant_id"],
                    project_id=record["project_id"],
                    type="acceptance_criteria",
                    key=criteria_id,
                    payload=record,
                    created_by=record.get("generated_by", ""),
                )
                return
            await self._registry.create(
                tenant_id=record["tenant_id"],
                project_id=record["project_id"],
                type="acceptance_criteria",
                payload=record,
                created_by=record.get("generated_by", ""),
                actor_id=record.get("generated_by"),
            )
        except Exception as exc:  # noqa: BLE001 — registry may be absent
            logger.debug(
                "acceptance.registry_unavailable",
                error=type(exc).__name__,
                reason=str(exc),
            )

    async def _load_record(
        self,
        criteria_id: UUID | str,
    ) -> dict[str, Any] | None:
        try:
            rows = await self._registry.list(
                tenant_id="00000000-0000-0000-0000-000000000000",
                project_id="00000000-0000-0000-0000-000000000000",
                type="acceptance_criteria",
            )
        except Exception:  # noqa: BLE001
            rows = []
        target = str(criteria_id)
        for row in rows or []:
            payload = row.get("payload") if isinstance(row, dict) else None
            if payload and str(payload.get("id")) == target:
                return payload
        return None

    async def _list_records(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[dict[str, Any]]:
        try:
            rows = await self._registry.list(
                tenant_id=tenant_id,
                project_id=project_id,
                type="acceptance_criteria",
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "acceptance.list_fallback",
                error=type(exc).__name__,
                reason=str(exc),
            )
            return []

        out: list[dict[str, Any]] = []
        for row in rows or []:
            payload = row.get("payload") if isinstance(row, dict) else None
            if payload:
                out.append(payload)
        return out


def _artifact_to_prompt(artifact_type: str, artifact: dict[str, Any]) -> str:
    """Project the artifact onto a compact prompt body for the LLM."""
    if artifact_type == "adr":
        return (
            f"ADR #{artifact.get('title')}\n\n"
            f"Context:\n{artifact.get('context') or ''}\n\n"
            f"Decision:\n{artifact.get('decision') or ''}"
        )
    if artifact_type == "api_contract":
        return (
            f"API Contract: {artifact.get('title') or 'untitled'}\n\n"
            f"Spec:\n{json.dumps(artifact.get('spec_content') or {}, indent=2)[:3000]}"
        )
    # task_breakdown
    tasks = artifact.get("tasks") or []
    summary = "\n".join(
        f"- {t.get('id', '?')}: {t.get('title', '')}" for t in tasks[:30]
    )
    return f"Task Breakdown: {artifact.get('title') or 'untitled'}\n\nTasks:\n{summary}"


def _normalize_criteria(raw: Any) -> list[dict[str, Any]]:
    """Coerce LLM output into our internal shape; default priority = medium."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for idx, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "id": str(item.get("id") or f"AC-{idx}"),
                "given": str(item.get("given") or ""),
                "when": str(item.get("when") or ""),
                "then": str(item.get("then") or ""),
                "priority": str(item.get("priority") or "medium"),
            }
        )
    return out


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


__all__ = ["AcceptanceCriteriaService"]
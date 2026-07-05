"""F-303 — Task Breakdown Generator.

Derives an implementation task list from an ADR (or any parent artifact)
using LiteLLM, persists the structured result, and supports partial
updates to individual tasks.
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.core.logging import get_logger
from app.db.models.architecture import ADR, TaskBreakdown
from app.db.session import get_session_factory
from app.services.event_bus import EventType

logger = get_logger(__name__)


_BREAKDOWN_PROMPT = """You are a tech lead decomposing a decision into
implementation tasks. Given an ADR (or another parent artifact's
context, decision, and consequences), return ONLY a JSON object of the
form:

{
  "name": "<short label>",
  "tasks": [
    {
      "id": "<stable slug, e.g. TASK-1>",
      "title": "<imperative>",
      "description": "<2-4 sentences>",
      "estimate_hours": <number>,
      "dependencies": ["<other task id>", ...],
      "skills_required": ["python", ...],
      "agents_suggested": ["backend-engineer", ...],
      "acceptance_criteria": ["...", ...]
    }
  ]
}

No commentary. No markdown fences.
"""


class TaskBreakdownGenerator:
    """Generate, fetch, and update task breakdowns."""

    def __init__(self, litellm_client: Any, artifact_registry: Any | None = None, event_bus: Any | None = None) -> None:
        from app.services.artifact_registry import artifact_registry as _default_registry
        self._llm = litellm_client
        self._registry = artifact_registry if artifact_registry is not None else _default_registry
        self._bus = event_bus

    async def generate_from_adr(
        self,
        adr_id: UUID | str,
        actor_id: UUID | str,
    ) -> TaskBreakdown:
        """Read the ADR, ask the LLM to derive tasks, persist the result."""
        factory = get_session_factory()
        async with factory() as session:
            adr = await session.get(ADR, str(adr_id))
            if adr is None:
                raise LookupError("adr_not_found")
            tenant_id = adr.tenant_id
            project_id = adr.project_id
            parent_payload = {
                "number": adr.number,
                "title": adr.title,
                "status": adr.status,
                "context": adr.context,
                "decision": adr.decision,
                "consequences": adr.consequences,
                "alternatives": adr.alternatives,
            }

        messages = [
            {"role": "system", "content": _BREAKDOWN_PROMPT},
            {"role": "user", "content": json.dumps(parent_payload)},
        ]
        async with self._llm as client:
            response = await client.chat(
                messages=messages,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )

        parsed = _extract_json(response)
        tasks = _normalize_tasks(parsed.get("tasks") or [])
        total_hours = sum(float(t.get("estimate_hours") or 0) for t in tasks)

        async with factory() as session:
            breakdown = TaskBreakdown(
                tenant_id=tenant_id,
                project_id=project_id,
                name=parsed.get("name") or f"Tasks for ADR #{parent_payload['number']}",
                parent_artifact_type="adr",
                parent_artifact_id=str(adr_id),
                tasks=tasks,
                total_estimate_hours=total_hours,
                status="draft",
                generated_by=str(actor_id),
            )
            session.add(breakdown)
            await session.commit()
            await session.refresh(breakdown)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "artifact_type": "task_breakdown",
                "breakdown_id": str(breakdown.id),
                "parent_artifact_id": str(adr_id),
                "task_count": len(tasks),
                "total_estimate_hours": total_hours,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        # M5-G2 — mirror the task breakdown into the Knowledge Graph.
        await self._registry.register(
            artifact_type="task_breakdown",
            artifact_id=str(breakdown.id),
            tenant_id=tenant_id,
            project_id=project_id,
            payload={
                "name": breakdown.name,
                "parent_artifact_type": "adr",
                "parent_artifact_id": str(adr_id),
                "task_count": len(tasks),
                "total_estimate_hours": total_hours,
                "status": breakdown.status,
            },
            actor_id=actor_id,
        )
        logger.info(
            "task_breakdown.created",
            tenant_id=tenant_id,
            project_id=project_id,
            breakdown_id=str(breakdown.id),
            task_count=len(tasks),
        )
        return breakdown

    async def get_task_breakdown(self, breakdown_id: UUID | str) -> TaskBreakdown | None:
        factory = get_session_factory()
        async with factory() as session:
            return await session.get(TaskBreakdown, str(breakdown_id))

    async def update_task(
        self,
        breakdown_id: UUID | str,
        task_id: str,
        updates: dict[str, Any],
    ) -> TaskBreakdown:
        """Apply a partial update to a single task inside a breakdown."""
        allowed_keys = {
            "title",
            "description",
            "estimate_hours",
            "dependencies",
            "skills_required",
            "agents_suggested",
            "acceptance_criteria",
            "status",
        }
        factory = get_session_factory()
        async with factory() as session:
            breakdown = await session.get(TaskBreakdown, str(breakdown_id))
            if breakdown is None:
                raise LookupError("task_breakdown_not_found")
            tasks = list(breakdown.tasks or [])
            target = next(
                (t for t in tasks if str(t.get("id")) == str(task_id)),
                None,
            )
            if target is None:
                raise LookupError(f"task_not_found:{task_id}")
            for key, value in updates.items():
                if key in allowed_keys:
                    target[key] = value
            if "estimate_hours" in updates:
                breakdown.total_estimate_hours = sum(
                    float(t.get("estimate_hours") or 0) for t in tasks
                )
            breakdown.tasks = tasks
            flag_modified(breakdown, "tasks")
            await session.commit()
            await session.refresh(breakdown)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": "task_breakdown",
                "breakdown_id": str(breakdown.id),
                "task_id": str(task_id),
                "fields": list(updates.keys()),
            },
            tenant_id=breakdown.tenant_id,
            project_id=breakdown.project_id,
            actor_id=None,
        )
        return breakdown

    async def list_for_project(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[TaskBreakdown]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(TaskBreakdown)
                .where(
                    TaskBreakdown.tenant_id == str(tenant_id),
                    TaskBreakdown.project_id == str(project_id),
                )
                .order_by(TaskBreakdown.created_at.desc())
            )
            return list((await session.execute(stmt)).scalars().all())


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


def _normalize_tasks(raw: list[Any]) -> list[dict[str, Any]]:
    """Ensure every task has an id, sensible defaults, and stable ordering."""
    out: list[dict[str, Any]] = []
    for idx, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            continue
        task_id = str(item.get("id") or f"TASK-{idx}-{uuid.uuid4().hex[:6]}")
        out.append(
            {
                "id": task_id,
                "title": item.get("title") or task_id,
                "description": item.get("description") or "",
                "estimate_hours": float(item.get("estimate_hours") or 0),
                "dependencies": [str(d) for d in (item.get("dependencies") or [])],
                "skills_required": list(item.get("skills_required") or []),
                "agents_suggested": list(item.get("agents_suggested") or []),
                "acceptance_criteria": list(item.get("acceptance_criteria") or []),
                "status": item.get("status") or "todo",
            }
        )
    return out


__all__ = ["TaskBreakdownGenerator"]

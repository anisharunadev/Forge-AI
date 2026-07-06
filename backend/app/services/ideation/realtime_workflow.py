"""Realtime Ideation Workflow service (F-210).

A long-lived, step-by-step workflow session that streams progress
through WebSocket frames. Each step is persisted as a `WorkflowStep`
row so clients can reconnect and replay missed events. Interventions
(skip / retry / modify) are applied via the same DB row, keeping the
state durable across reconnects.

The service itself does NOT know about WebSockets — that's the
endpoint's job. It exposes a coroutine to fetch the current state and
helpers to emit events; the WS endpoint translates those into frames.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.ideation import (
    Idea,
    IdeaStatus,
    WorkflowSession,
    WorkflowSessionStatus,
    WorkflowStep,
    WorkflowStepStatus,
)
from app.db.session import get_session_factory
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus
from app.services.ideation import (
    agent_selector,
    arch_preview_service,
    idea_analysis_service,
)
from app.services.ideation.prd_generator import prd_generator
from app.services.ideation.roadmap_generator import roadmap_generator
from app.services.ideation.scoring import opportunity_scoring_service

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Pipeline definition
# ---------------------------------------------------------------------------


@dataclass
class PipelineStep:
    name: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description}


PIPELINE: tuple[PipelineStep, ...] = (
    PipelineStep("analyze", "Run AI analysis on the idea."),
    PipelineStep("score", "Score the idea across RICE + custom dimensions."),
    PipelineStep("arch_preview", "Generate a React-Flow architecture preview."),
    PipelineStep("prd", "Draft a BMad-compatible PRD."),
    PipelineStep("roadmap_entry", "Add the idea to a draft roadmap."),
    PipelineStep("agent_plan", "Pick an agent per delivery phase."),
)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class WorkflowState:
    session_id: UUID
    idea_id: UUID
    status: WorkflowSessionStatus
    current_step: str | None
    completed_at: datetime | None
    steps: list[dict[str, Any]] = field(default_factory=list)
    outputs: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": str(self.session_id),
            "idea_id": str(self.idea_id),
            "status": self.status.value if hasattr(self.status, "value") else str(self.status),
            "current_step": self.current_step,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "steps": self.steps,
            "outputs": self.outputs,
        }


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RealtimeWorkflow:
    """Tenant-scoped realtime ideation workflow orchestrator."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def start_workflow(
        self,
        idea_id: UUID | str,
        user_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> WorkflowSession:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id

        factory = get_session_factory()
        async with factory() as session:
            row = WorkflowSession(
                tenant_id=str(tenant_id),
                project_id=str(effective_project_id),
                idea_id=idea.id,
                user_id=str(user_id),
                status=WorkflowSessionStatus.RUNNING,
                state={"pipeline": [step.name for step in PIPELINE]},
                current_step=PIPELINE[0].name,
            )
            session.add(row)
            await session.commit()

            # Pre-create WorkflowStep rows so clients see a stable plan.
            for idx, step in enumerate(PIPELINE):
                step_row = WorkflowStep(
                    tenant_id=str(tenant_id),
                    session_id=row.id,
                    name=step.name,
                    position=idx,
                    status=WorkflowStepStatus.PENDING,
                )
                session.add(step_row)
            await session.commit()

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "domain": "ideation",
                "kind": "workflow_session",
                "session_id": str(row.id),
                "idea_id": str(idea.id),
            },
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=user_id,
        )
        # Kick off the pipeline in the background so the API returns
        # immediately and the client can connect to the WS. We schedule
        # only when (a) there is a running loop AND (b) the caller did
        # not opt out via FORGE_IDEATION_SYNC=1 (used by tests that
        # drive `run_pipeline` synchronously).
        import os

        sync_mode = os.environ.get("FORGE_IDEATION_SYNC") == "1"
        if not sync_mode:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            if loop is not None:
                loop.create_task(
                    self._run_pipeline(row.id, tenant_id=tenant_id, project_id=effective_project_id)
                )
        return row

    async def run_pipeline(
        self,
        session_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> None:
        """Synchronously execute the workflow pipeline.

        Useful for tests, batch jobs, or callers that prefer to await
        completion rather than listen on a WebSocket.
        """
        await self._run_pipeline(session_id, tenant_id=tenant_id, project_id=project_id)

    async def get_workflow_state(
        self, session_id: UUID | str, *, tenant_id: UUID | str
    ) -> WorkflowState:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(WorkflowSession, str(session_id))
            if row is None:
                raise LookupError(f"workflow session {session_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("workflow_session_not_in_tenant")
            step_rows = list(
                (
                    await session.execute(
                        select(WorkflowStep)
                        .where(WorkflowStep.session_id == row.id)
                        .order_by(WorkflowStep.position)
                    )
                )
                .scalars()
                .all()
            )
        steps = [
            {
                "id": str(s.id),
                "name": s.name,
                "position": s.position,
                "status": s.status.value if hasattr(s.status, "value") else str(s.status),
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "finished_at": s.finished_at.isoformat() if s.finished_at else None,
                "result": dict(s.result or {}),
                "error": s.error,
            }
            for s in step_rows
        ]
        return WorkflowState(
            session_id=row.id,
            idea_id=row.idea_id,
            status=row.status,
            current_step=row.current_step,
            completed_at=row.completed_at,
            steps=steps,
            outputs=dict(row.state or {}).get("outputs", {}),
        )

    async def intervene(
        self,
        session_id: UUID | str,
        action: str,
        *,
        tenant_id: UUID | str,
        step: str | None = None,
        payload: dict[str, Any] | None = None,
        actor_id: UUID | str | None = None,
    ) -> WorkflowState:
        """Apply a user intervention.

        Supported actions:
        - skip: mark the named step (or current) as SKIPPED
        - retry: rewind the named step (or current) to PENDING
        - modify: attach an override payload to the current step
        - cancel: cancel the session
        """
        action = (action or "").lower().strip()
        if action not in {"skip", "retry", "modify", "cancel"}:
            raise ValueError(f"unknown_intervention:{action}")

        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(WorkflowSession, str(session_id))
            if row is None:
                raise LookupError(f"workflow session {session_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("workflow_session_not_in_tenant")

            target_step_name = step or row.current_step
            target: WorkflowStep | None = None
            if target_step_name is not None:
                stmt = select(WorkflowStep).where(
                    WorkflowStep.session_id == row.id,
                    WorkflowStep.name == target_step_name,
                )
                target = (await session.execute(stmt)).scalars().first()

            state = dict(row.state or {})

            if action == "cancel":
                row.status = WorkflowSessionStatus.CANCELLED
                row.completed_at = datetime.now(UTC)
                state["cancelled_by"] = str(actor_id) if actor_id else None
            elif target is not None:
                if action == "skip":
                    target.status = WorkflowStepStatus.SKIPPED
                    target.finished_at = datetime.now(UTC)
                    target.result = {"skipped_by": str(actor_id) if actor_id else None}
                elif action == "retry":
                    target.status = WorkflowStepStatus.PENDING
                    target.started_at = None
                    target.finished_at = None
                    target.error = None
                    target.result = {}
                elif action == "modify":
                    mods = state.setdefault("modifications", {})
                    mods[target.name] = dict(payload or {})
                    target.result = {"modified": True, "payload": dict(payload or {})}

            row.state = state
            await session.commit()

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "workflow_session",
                "session_id": str(row.id),
                "intervention": action,
                "step": target_step_name,
                "actor_id": str(actor_id) if actor_id else None,
            },
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return await self.get_workflow_state(row.id, tenant_id=tenant_id)

    async def complete_workflow(
        self, session_id: UUID | str, *, tenant_id: UUID | str
    ) -> dict[str, Any]:
        """Return the final outputs dict for a completed session."""
        state = await self.get_workflow_state(session_id, tenant_id=tenant_id)
        return {
            "session_id": state.session_id,
            "idea_id": state.idea_id,
            "status": state.status,
            "outputs": state.outputs,
        }

    # -- pipeline execution ----------------------------------------------

    async def _run_pipeline(
        self,
        session_id: UUID,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
    ) -> None:
        """Sequentially execute each pipeline step.

        Runs as a background task; failures are isolated to the step so
        the next step can still proceed (skipping broken output).
        """
        for pipeline_step in PIPELINE:
            try:
                await self._execute_step(
                    session_id=session_id,
                    step=pipeline_step,
                    tenant_id=tenant_id,
                    project_id=project_id,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "ideation.workflow_step_error",
                    session_id=str(session_id),
                    step=pipeline_step.name,
                )
                await self._mark_step(
                    session_id=session_id,
                    step_name=pipeline_step.name,
                    status=WorkflowStepStatus.FAILED,
                    error=f"{type(exc).__name__}: {exc}",
                )

        # After the pipeline completes, mark session completed.
        await self._finalize_session(session_id, status=WorkflowSessionStatus.COMPLETED)

    async def _execute_step(
        self,
        *,
        session_id: UUID,
        step: PipelineStep,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
    ) -> None:
        await self._mark_step(
            session_id=session_id,
            step_name=step.name,
            status=WorkflowStepStatus.RUNNING,
        )

        # Resolve the idea from the session row.
        idea = await self._idea_for_session(session_id, tenant_id=tenant_id)

        # Skip if the user already intervened.
        state = await self.get_workflow_state(session_id, tenant_id=tenant_id)
        for s in state.steps:
            if s["name"] == step.name and s["status"] == WorkflowStepStatus.SKIPPED.value:
                return

        if step.name == "analyze":
            analysis = await idea_analysis_service.analyze_idea(
                idea.id,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            await self._store_step_result(
                session_id=session_id,
                step_name=step.name,
                result={"analysis_id": str(analysis.id)},
            )
        elif step.name == "score":
            score = await opportunity_scoring_service.score_idea(
                idea.id,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            await self._store_step_result(
                session_id=session_id,
                step_name=step.name,
                result={
                    "score_id": str(score.id),
                    "total_score": score.total_score,
                },
            )
        elif step.name == "arch_preview":
            preview = await arch_preview_service.generate_preview(
                idea.id,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=idea.submitted_by,
            )
            await self._store_step_result(
                session_id=session_id,
                step_name=step.name,
                result={
                    "preview_id": str(preview.id),
                    "components": len(preview.components or []),
                },
            )
        elif step.name == "prd":
            prd = await prd_generator.generate_prd(
                idea.id,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=idea.submitted_by,
            )
            await self._store_step_result(
                session_id=session_id,
                step_name=step.name,
                result={"prd_id": str(prd.id), "version": prd.version},
            )
        elif step.name == "roadmap_entry":
            roadmap = await roadmap_generator.generate_roadmap(
                project_id=project_id or idea.project_id,
                tenant_id=tenant_id,
                horizon="now",
                top_n=5,
                name=f"Auto roadmap {datetime.now(UTC).strftime('%Y%m%d-%H%M')}",
                actor_id=idea.submitted_by,
            )
            # Add the idea into the new roadmap so it isn't orphaned.
            try:
                roadmap = await roadmap_generator.add_to_roadmap(
                    roadmap.id,
                    idea.id,
                    position=0,
                    tenant_id=tenant_id,
                    actor_id=idea.submitted_by,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("ideation.workflow_add_to_roadmap_failed", error=str(exc))
            await self._store_step_result(
                session_id=session_id,
                step_name=step.name,
                result={"roadmap_id": str(roadmap.id)},
            )
        elif step.name == "agent_plan":
            plan = await agent_selector.select_agents_for_idea(
                idea.id,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            await self._store_step_result(
                session_id=session_id,
                step_name=step.name,
                result={
                    "agent_plan_steps": len(plan.steps),
                    "phases": [step.phase for step in plan.steps],
                },
            )
        else:  # pragma: no cover — defensive
            raise ValueError(f"unknown_pipeline_step:{step.name}")

        await self._mark_step(
            session_id=session_id,
            step_name=step.name,
            status=WorkflowStepStatus.COMPLETED,
        )

    # -- DB helpers -------------------------------------------------------

    async def _idea_for_session(self, session_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(WorkflowSession, str(session_id))
            if row is None:
                raise LookupError("workflow_session_not_found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("workflow_session_not_in_tenant")
            idea = await session.get(Idea, str(row.idea_id))
            if idea is None:
                raise LookupError("idea_not_found")
            return idea

    async def _mark_step(
        self,
        *,
        session_id: UUID | str,
        step_name: str,
        status: WorkflowStepStatus,
        error: str | None = None,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(WorkflowStep).where(
                WorkflowStep.session_id == str(session_id),
                WorkflowStep.name == step_name,
            )
            row = (await session.execute(stmt)).scalars().first()
            if row is None:
                return
            now = datetime.now(UTC)
            row.status = status
            if status == WorkflowStepStatus.RUNNING and row.started_at is None:
                row.started_at = now
            if status in (
                WorkflowStepStatus.COMPLETED,
                WorkflowStepStatus.FAILED,
                WorkflowStepStatus.SKIPPED,
            ):
                row.finished_at = now
            if error:
                row.error = error
            await session.commit()

    async def _store_step_result(
        self,
        *,
        session_id: UUID | str,
        step_name: str,
        result: dict[str, Any],
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(WorkflowStep).where(
                WorkflowStep.session_id == str(session_id),
                WorkflowStep.name == step_name,
            )
            row = (await session.execute(stmt)).scalars().first()
            if row is None:
                return
            row.result = result

            # Update session.state.outputs as a running aggregate.
            sess_row = await session.get(WorkflowSession, str(session_id))
            if sess_row is not None:
                state = dict(sess_row.state or {})
                outputs = dict(state.get("outputs") or {})
                outputs[step_name] = result
                state["outputs"] = outputs
                sess_row.state = state
                # Advance current_step pointer to the next pending step.
                next_stmt = (
                    select(WorkflowStep)
                    .where(
                        WorkflowStep.session_id == str(session_id),
                        WorkflowStep.status == WorkflowStepStatus.PENDING,
                    )
                    .order_by(WorkflowStep.position)
                )
                next_step = (await session.execute(next_stmt)).scalars().first()
                sess_row.current_step = next_step.name if next_step is not None else None
            await session.commit()

    async def _finalize_session(
        self, session_id: UUID | str, *, status: WorkflowSessionStatus
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(WorkflowSession, str(session_id))
            if row is None:
                return
            # Idempotency: if a previous runner already marked this session
            # terminal, don't overwrite. CANCELLED is sticky; COMPLETED /
            # FAILED may transition into each other for the first write only.
            terminal_states = {
                WorkflowSessionStatus.CANCELLED,
                WorkflowSessionStatus.COMPLETED,
                WorkflowSessionStatus.FAILED,
            }
            if row.status in terminal_states:
                return
            row.status = status
            row.completed_at = datetime.now(UTC)
            row.current_step = None
            # If we completed successfully, transition the idea to SCORED
            # so downstream consumers can react.
            if status == WorkflowSessionStatus.COMPLETED:
                idea = await session.get(Idea, str(row.idea_id))
                if idea is not None and idea.status in (
                    IdeaStatus.NEW,
                    IdeaStatus.ANALYZING,
                    IdeaStatus.SCORED,
                ):
                    idea.status = IdeaStatus.SCORED
            await session.commit()

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "workflow_session",
                "session_id": str(row.id),
                "final_status": status.value if hasattr(status, "value") else str(status),
            },
            tenant_id=str(row.tenant_id),
            project_id=str(row.project_id) if row.project_id else None,
        )

    async def _load_idea(self, idea_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea


# Helpful helpers used by the WS endpoint.
def serialize_event(event_type: str, payload: dict[str, Any]) -> str:
    """Wrap an event into a JSON string suitable for an outgoing WS frame."""
    return json.dumps(
        {
            "type": event_type,
            "payload": payload,
            "ts": datetime.now(UTC).isoformat(),
        }
    )


def new_session_id() -> UUID:
    """Generate a stable session id (used by tests)."""
    return uuid.uuid4()


realtime_workflow = RealtimeWorkflow()


__all__ = [
    "PIPELINE",
    "PipelineStep",
    "RealtimeWorkflow",
    "WorkflowState",
    "new_session_id",
    "realtime_workflow",
    "serialize_event",
]

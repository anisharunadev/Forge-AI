"""WorkflowExecutor — DAG runner for user-authored workflows.

Given a :class:`app.db.models.workflow.WorkflowRun` row in
``PENDING``/``RUNNING``/``WAITING_APPROVAL`` state, walks the saved
``WorkflowDefinition`` in topological order and dispatches each node by
its ``type`` discriminator:

* ``trigger``  — marks itself ``SUCCEEDED`` immediately and advances.
* ``command``  — delegates to :func:`route_to_gsd` (the same path
  ``POST /api/v1/commands/{name}/run`` uses) and captures output,
  duration, and cost.
* ``approval`` — POSTs to the approvals service with
  ``payload.kind == "workflow"``, persists the returned ``approval_id``
  on the step result, transitions the run to ``WAITING_APPROVAL``,
  sets ``current_step_id``, and returns. A later call to
  :meth:`WorkflowExecutor.resume` continues from the next step.
* ``script``   — invokes :class:`ScriptSandbox`, captures stdout/stderr,
  exit code, and ``network_blocked``.

Every step writes a result envelope into
``run.state["stepResults"][step_id]`` and emits a ``WORKFLOW_STEP_*``
event on the bus (Rule 6).

Rule 1 (provider-agnostic) — executor dispatches commands via
:func:`route_to_gsd` only; never imports a provider SDK directly.
Rule 2 (multi-tenancy) — every audit row and event carries
``tenant_id`` + ``project_id``.
Rule 3 (approval gates) — pause/resume around approval nodes.
Rule 4 (typed artifacts) — step results are typed envelopes.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.logging import get_logger
from app.db.models.workflow import (
    Workflow,
    WorkflowRun,
    WorkflowRunStatus,
    WorkflowStepStatus,
)
from app.schemas.workflow import (
    ApprovalNodeData,
    CommandNodeData,
    ScriptNodeData,
    TriggerNodeData,
    WorkflowDefinition,
)
from app.services.event_bus import EventType, bus
from app.services.forge_commands import route_to_gsd
from app.services.script_sandbox import ScriptSandbox, ScriptSandboxResult

logger = get_logger(__name__)


class WorkflowExecutorError(Exception):
    """Base error for the executor."""


class WorkflowDefinitionMismatch(WorkflowExecutorError):
    """Raised when the saved definition no longer matches the run state."""


class WorkflowApprovalResumeRequired(WorkflowExecutorError):
    """The run is paused awaiting an approval decision."""

    def __init__(self, run_id: UUID, approval_id: UUID, step_id: str) -> None:
        super().__init__(f"run {run_id} paused awaiting approval {approval_id} on step {step_id}")
        self.run_id = run_id
        self.approval_id = approval_id
        self.step_id = step_id


# Module-level singleton — mirrors WorkflowService.service.
_executor = None


def get_executor() -> WorkflowExecutor:
    global _executor
    if _executor is None:
        _executor = WorkflowExecutor()
    return _executor


class WorkflowExecutor:
    """Stateless DAG runner — methods take a session explicitly."""

    def __init__(self, *, sandbox: ScriptSandbox | None = None) -> None:
        self._sandbox = sandbox or ScriptSandbox()

    # ---- Public API -------------------------------------------------------

    async def execute(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID,
        run_id: UUID,
    ) -> WorkflowRun:
        """Run a workflow from the trigger until a pause/failure/completion.

        Idempotent — re-running an already-terminal run is a no-op.
        """
        run = await self._load_run(db, tenant_id=tenant_id, run_id=run_id)
        if run.status in (
            WorkflowRunStatus.SUCCEEDED,
            WorkflowRunStatus.FAILED,
            WorkflowRunStatus.CANCELLED,
        ):
            return run

        wf = await self._load_workflow(db, tenant_id=tenant_id, workflow_id=run.workflow_id)
        definition = self._coerce_definition(wf.definition)

        # Lock the run row for the duration of execute() so a concurrent
        # cancel() cannot race our status flip.
        await db.refresh(run, with_for_update=True)

        run.status = WorkflowRunStatus.RUNNING
        run.started_at = run.started_at or datetime.now(UTC)
        run.error = None
        await db.commit()

        topo_order = self._topological_sort(definition)
        step_results: dict[str, dict[str, Any]] = dict(run.state.get("stepResults", {}))

        for step_id in topo_order:
            node = next(n for n in definition.nodes if n.id == step_id)
            # Skip already-completed steps on resume.
            existing = step_results.get(step_id)
            if existing and existing.get("status") in (
                WorkflowStepStatus.SUCCEEDED.value,
                WorkflowStepStatus.FAILED.value,
                WorkflowStepStatus.SKIPPED.value,
            ):
                continue
            # Skip steps downstream of a failed command.
            if self._has_downstream_failure(definition, step_id, step_results):
                step_results[step_id] = self._skipped_result(reason="upstream_failed")
                await self._publish_step(
                    db,
                    run,
                    node,
                    step_results[step_id],
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=run.triggered_by,
                )
                continue

            step_results[step_id] = await self._run_step(
                db,
                run,
                node,
                definition,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            # Persist the latest state JSON each step. We use
            # ``expire_on_commit=False`` on the session so that the
            # run object keeps its in-memory attributes after the
            # commit; re-assigning ``run.state`` to a freshly-built
            # dict (rather than mutating in place) is required because
            # the underlying JSONB column compares by serialized form
            # and only fires the change event on a brand-new dict
            # object.
            run.state = {"stepResults": dict(step_results)}
            run.current_step_id = step_id
            await db.commit()

            status = step_results[step_id]["status"]
            if status == WorkflowStepStatus.WAITING_APPROVAL.value:
                run.status = WorkflowRunStatus.WAITING_APPROVAL
                await db.commit()
                await bus.publish(
                    EventType.WORKFLOW_RUN_PAUSED,
                    {
                        "run_id": str(run.id),
                        "workflow_id": str(run.workflow_id),
                        "step_id": step_id,
                        "approval_id": step_results[step_id].get("approval_id"),
                    },
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=run.triggered_by,
                )
                approval_id = UUID(step_results[step_id]["approval_id"])
                raise WorkflowApprovalResumeRequired(
                    run_id=run.id, approval_id=approval_id, step_id=step_id
                )

            if status == WorkflowStepStatus.FAILED.value:
                run.status = WorkflowRunStatus.FAILED
                run.error = step_results[step_id].get("error") or "step_failed"
                run.finished_at = datetime.now(UTC)
                await db.commit()
                await bus.publish(
                    EventType.WORKFLOW_RUN_FAILED,
                    {
                        "run_id": str(run.id),
                        "workflow_id": str(run.workflow_id),
                        "step_id": step_id,
                        "error": run.error,
                    },
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=run.triggered_by,
                )
                return run

        run.status = WorkflowRunStatus.SUCCEEDED
        run.finished_at = datetime.now(UTC)
        run.current_step_id = None
        await db.commit()
        await bus.publish(
            EventType.WORKFLOW_RUN_COMPLETED,
            {"run_id": str(run.id), "workflow_id": str(run.workflow_id)},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=run.triggered_by,
        )
        return run

    async def resume(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        run_id: UUID,
        approval_id: UUID,
        decision: str,  # "granted" | "denied"
    ) -> WorkflowRun:
        """Continue a ``WAITING_APPROVAL`` run after an approval decision."""
        run = await self._load_run(db, tenant_id=tenant_id, run_id=run_id)
        if run.status != WorkflowRunStatus.WAITING_APPROVAL:
            return run
        step_results: dict[str, dict[str, Any]] = dict(run.state.get("stepResults", {}))
        approval_step_id = next(
            (sid for sid, r in step_results.items() if r.get("approval_id") == str(approval_id)),
            None,
        )
        if approval_step_id is None:
            raise WorkflowDefinitionMismatch(f"approval {approval_id} not found on run {run_id}")

        step_results[approval_step_id]["status"] = (
            WorkflowStepStatus.SUCCEEDED.value
            if decision == "granted"
            else WorkflowStepStatus.FAILED.value
        )
        step_results[approval_step_id]["finished_at"] = datetime.now(UTC).isoformat()
        if decision == "denied":
            step_results[approval_step_id]["error"] = "approval_denied"
        run.state = {**run.state, "stepResults": step_results}
        # ponytail: JSONB column has no MutableDict.as_mutable(); force the
        # change event so the UPDATE fires even on Postgres where nested
        # mutations alone wouldn't be detected by SQLAlchemy's attribute
        # tracker.
        flag_modified(run, "state")
        run.status = WorkflowRunStatus.RUNNING
        await db.commit()
        await bus.publish(
            EventType.WORKFLOW_RUN_RESUMED,
            {"run_id": str(run.id), "step_id": approval_step_id},
            tenant_id=tenant_id,
            project_id=run.project_id,
            actor_id=run.triggered_by,
        )
        return await self.execute(db, tenant_id=tenant_id, project_id=run.project_id, run_id=run_id)

    async def cancel(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        run_id: UUID,
    ) -> WorkflowRun:
        """Idempotent cancel — flips a non-terminal run to CANCELLED."""
        run = await self._load_run(db, tenant_id=tenant_id, run_id=run_id)
        if run.status in (
            WorkflowRunStatus.SUCCEEDED,
            WorkflowRunStatus.FAILED,
            WorkflowRunStatus.CANCELLED,
        ):
            return run
        run.status = WorkflowRunStatus.CANCELLED
        run.finished_at = datetime.now(UTC)
        await db.commit()
        await bus.publish(
            EventType.WORKFLOW_RUN_CANCELLED,
            {"run_id": str(run.id)},
            tenant_id=tenant_id,
            project_id=run.project_id,
            actor_id=run.triggered_by,
        )
        return run

    # ---- Step dispatch ---------------------------------------------------

    async def _run_step(
        self,
        db: AsyncSession,
        run: WorkflowRun,
        node,
        definition: WorkflowDefinition,
        *,
        tenant_id: UUID,
        project_id: UUID,
    ) -> dict[str, Any]:
        started_at = datetime.now(UTC)
        step_id = node.id
        started_perf = time.monotonic()

        envelope: dict[str, Any] = {
            "step_id": step_id,
            "status": WorkflowStepStatus.RUNNING.value,
            "started_at": started_at.isoformat(),
            "finished_at": None,
            "duration_ms": None,
            "error": None,
        }

        await bus.publish(
            EventType.WORKFLOW_STEP_STARTED,
            {"run_id": str(run.id), "step_id": step_id, "type": node.data.type},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=run.triggered_by,
        )

        try:
            data = node.data
            if isinstance(data, TriggerNodeData):
                envelope["status"] = WorkflowStepStatus.SUCCEEDED.value
            elif isinstance(data, CommandNodeData):
                envelope = await self._dispatch_command(
                    envelope,
                    data,
                    tenant_id=tenant_id,
                    project_id=project_id,
                )
            elif isinstance(data, ApprovalNodeData):
                envelope = await self._dispatch_approval(
                    db,
                    envelope,
                    data,
                    run,
                    tenant_id=tenant_id,
                    project_id=project_id,
                )
            elif isinstance(data, ScriptNodeData):
                envelope = await self._dispatch_script(envelope, data)
            else:
                # Discriminated union exhaustiveness — fail loud.
                raise WorkflowExecutorError(f"unhandled node type: {type(data).__name__}")
        except BaseException as exc:
            envelope["status"] = WorkflowStepStatus.FAILED.value
            envelope["error"] = str(exc)

        envelope["finished_at"] = datetime.now(UTC).isoformat()
        envelope["duration_ms"] = int((time.monotonic() - started_perf) * 1000)
        if "step_id" not in envelope:
            envelope["step_id"] = step_id

        await bus.publish(
            EventType.WORKFLOW_STEP_COMPLETED
            if envelope["status"] == WorkflowStepStatus.SUCCEEDED.value
            else EventType.WORKFLOW_STEP_FAILED,
            {
                "run_id": str(run.id),
                "step_id": step_id,
                "status": envelope["status"],
                "duration_ms": envelope["duration_ms"],
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=run.triggered_by,
        )
        return envelope

    async def _dispatch_command(
        self,
        envelope: dict[str, Any],
        data: CommandNodeData,
        *,
        tenant_id: UUID,
        project_id: UUID,
    ) -> dict[str, Any]:
        # Delegate to the same surface `POST /api/v1/commands/{name}/run`
        # uses, so the workflow executor and the on-demand Command Center
        # share one canonical dispatch path (no drift).
        try:
            result = await asyncio.to_thread(
                route_to_gsd,
                data.command_name,
                {
                    **data.args,
                    "_caller": "workflow_executor",
                    "tenant_id": str(tenant_id),
                    "project_id": str(project_id),
                },
            )
        except Exception as exc:
            if data.on_error == "continue":
                envelope["status"] = WorkflowStepStatus.SUCCEEDED.value
                envelope["output"] = {"skipped_reason": str(exc)}
                return envelope
            envelope["error"] = f"command {data.command_name!r} failed: {exc}"
            envelope["status"] = WorkflowStepStatus.FAILED.value
            return envelope
        envelope["status"] = WorkflowStepStatus.SUCCEEDED.value
        envelope["output"] = _serializable(result)
        return envelope

    async def _dispatch_approval(
        self,
        db: AsyncSession,
        envelope: dict[str, Any],
        data: ApprovalNodeData,
        run: WorkflowRun,
        *,
        tenant_id: UUID,
        project_id: UUID,
    ) -> dict[str, Any]:
        # We synthesize an ApprovalRequest row directly so the executor
        # never has to call itself over HTTP. The approval-decide
        # endpoint reads `payload.kind == "workflow"` and calls
        # ``WorkflowExecutor.resume`` — see api/v1/approvals.py.
        from app.db.models.approval import ApprovalRequest, ApprovalStatus

        approval_id = uuid4()
        payload = {
            "kind": "workflow",
            "run_id": str(run.id),
            "workflow_id": str(run.workflow_id),
            "step_id": envelope["step_id"],
            "approver_role": data.approver_role,
            "timeout_hours": data.timeout_hours,
            "label": data.label,
        }
        row = ApprovalRequest(
            id=approval_id,
            tenant_id=tenant_id,
            project_id=project_id,
            type="workflow",
            requested_by=run.triggered_by,
            status=ApprovalStatus.PENDING,
            payload=payload,
        )
        db.add(row)
        await db.commit()

        envelope["status"] = WorkflowStepStatus.WAITING_APPROVAL.value
        envelope["approval_id"] = str(approval_id)
        return envelope

    async def _dispatch_script(
        self,
        envelope: dict[str, Any],
        data: ScriptNodeData,
    ) -> dict[str, Any]:
        try:
            result: ScriptSandboxResult = await asyncio.to_thread(
                self._sandbox.run,
                data.language,
                data.source,
                data.timeout_seconds(data.source) if hasattr(data, "timeout_seconds") else None,
            )
        except ValueError as exc:
            envelope["status"] = WorkflowStepStatus.FAILED.value
            envelope["error"] = f"unsupported language: {exc}"
            return envelope
        except NotImplementedError as exc:
            envelope["status"] = WorkflowStepStatus.FAILED.value
            envelope["error"] = str(exc)
            return envelope

        envelope["status"] = (
            WorkflowStepStatus.SUCCEEDED.value
            if result.exit_code == 0
            else WorkflowStepStatus.FAILED.value
        )
        envelope["output"] = result.to_dict()
        if result.exit_code != 0:
            envelope["error"] = (
                f"script exited with code {result.exit_code}: {(result.stderr or '').strip()[:500]}"
            )
        return envelope

    # ---- Helpers ---------------------------------------------------------

    async def _load_run(self, db: AsyncSession, *, tenant_id: UUID, run_id: UUID) -> WorkflowRun:
        run = (
            await db.execute(
                select(WorkflowRun).where(
                    WorkflowRun.id == run_id,
                    WorkflowRun.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if run is None:
            raise WorkflowExecutorError(f"run {run_id} not found")
        return run

    async def _load_workflow(
        self, db: AsyncSession, *, tenant_id: UUID, workflow_id: UUID
    ) -> Workflow:
        wf = (
            await db.execute(
                select(Workflow).where(
                    Workflow.id == workflow_id,
                    Workflow.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if wf is None:
            raise WorkflowExecutorError(f"workflow {workflow_id} not found")
        return wf

    @staticmethod
    def _coerce_definition(raw: Any) -> WorkflowDefinition:
        if isinstance(raw, WorkflowDefinition):
            return raw
        return WorkflowDefinition.model_validate(raw)

    @staticmethod
    def _topological_sort(definition: WorkflowDefinition) -> list[str]:
        """Kahn's algorithm. Raises WorkflowExecutorError on cycle (defensive — save-time validation already rejected cycles)."""
        adj: dict[str, list[str]] = defaultdict(list)
        in_degree: dict[str, int] = {n.id: 0 for n in definition.nodes}
        for e in definition.edges:
            adj[e.source].append(e.target)
            in_degree[e.target] += 1
        queue: deque[str] = deque(nid for nid, deg in in_degree.items() if deg == 0)
        order: list[str] = []
        while queue:
            nid = queue.popleft()
            order.append(nid)
            for child in adj[nid]:
                in_degree[child] -= 1
                if in_degree[child] == 0:
                    queue.append(child)
        if len(order) != len(definition.nodes):
            raise WorkflowExecutorError("cycle detected in workflow graph")
        return order

    @staticmethod
    def _has_downstream_failure(
        definition: WorkflowDefinition,
        step_id: str,
        results: dict[str, dict[str, Any]],
    ) -> bool:
        # A step is upstream of `step_id` if there is a path
        # upstream → ... → step_id. We precompute predecessors.
        predecessors: dict[str, set[str]] = defaultdict(set)
        for e in definition.edges:
            predecessors[e.target].add(e.source)
        visited: set[str] = set()
        stack = [step_id]
        while stack:
            current = stack.pop()
            for pred in predecessors.get(current, ()):
                if pred in visited:
                    continue
                visited.add(pred)
                if results.get(pred, {}).get("status") == WorkflowStepStatus.FAILED.value:
                    return True
                stack.append(pred)
        return False

    @staticmethod
    def _skipped_result(*, reason: str) -> dict[str, Any]:
        ts = datetime.now(UTC).isoformat()
        return {
            "step_id": None,
            "status": WorkflowStepStatus.SKIPPED.value,
            "started_at": ts,
            "finished_at": ts,
            "duration_ms": 0,
            "output": {"reason": reason},
            "error": None,
        }

    async def _publish_step(
        self,
        db: AsyncSession,
        run: WorkflowRun,
        node,
        step_result: dict[str, Any],
        *,
        tenant_id: UUID,
        project_id: UUID,
        actor_id: UUID,
    ) -> None:
        await bus.publish(
            EventType.WORKFLOW_STEP_COMPLETED,
            {
                "run_id": str(run.id),
                "step_id": node.id,
                "status": step_result.get("status"),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )


def _serializable(obj: Any) -> Any:
    """Convert dataclass / set / UUID objects to JSON-safe primitives."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, dict):
        return {k: _serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [_serializable(v) for v in obj]
    if hasattr(obj, "to_dict"):
        return _serializable(obj.to_dict())
    if hasattr(obj, "__dict__"):
        return _serializable(obj.__dict__)
    return str(obj)


__all__ = [
    "WorkflowApprovalResumeRequired",
    "WorkflowDefinitionMismatch",
    "WorkflowExecutor",
    "WorkflowExecutorError",
    "get_executor",
]

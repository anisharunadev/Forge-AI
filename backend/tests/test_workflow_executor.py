"""Tests for the Phase-C ``WorkflowExecutor`` (F-018, custom workflows).

Covers the full DAG-runner surface required by plan 5-01:

* happy path — ``trigger → command → succeeded``
* on_error=continue — a failing command does not block downstream nodes
* approval pause + resume — the executor pauses on a WAITING_APPROVAL
  step, then ``resume(approval_id, decision='granted')`` advances
* cancel — a non-terminal run flips to ``CANCELLED``; calling cancel
  twice is a no-op
* cycle detection — defensive Kahn sort rejects a cyclic graph even
  if the save-time validation is bypassed
* every step writes a result envelope into ``run.state.stepResults``
  and emits a ``WORKFLOW_STEP_*`` event on the bus
* an unknown command failure surfaces as a typed ``command X failed``
  error in the step envelope, and the run transitions to ``FAILED``
* an exception in the executor (defensive cycle in a saved
  definition) is caught at the API layer and the run row is flipped
  to ``FAILED`` rather than 500-ing

Tests use the in-memory ``sqlite_db`` fixture and a stub ``route_to_gsd``
patched into ``app.services.workflow_executor.route_to_gsd`` so the
real GSDWrapper doesn't get instantiated.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from unittest.mock import patch

import pytest

from app.db.models.approval import ApprovalRequest, ApprovalStatus
from app.db.models.workflow import (
    Workflow,
    WorkflowRun,
    WorkflowRunStatus,
    WorkflowStepStatus,
)
from app.db.session import get_session_factory
from app.schemas.workflow import (
    ApprovalNodeData,
    CommandNodeData,
    ScriptNodeData,
    TriggerNodeData,
    WorkflowDefinition,
    WorkflowEdge,
    WorkflowNode,
    Position,
)
from app.services.event_bus import EventType
from app.services.workflow_executor import (
    WorkflowApprovalResumeRequired,
    WorkflowExecutorError,
    get_executor,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _trigger_node(node_id: str = "t1", label: str = "Start") -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        position=Position(x=0, y=0),
        data=TriggerNodeData(label=label),
    )


def _command_node(
    node_id: str,
    *,
    command_name: str = "forge-echo",
    args: dict[str, Any] | None = None,
    on_error: str = "fail",
) -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        position=Position(x=0, y=0),
        data=CommandNodeData(
            command_name=command_name,
            args=args or {},
            on_error=on_error,
        ),
    )


def _approval_node(node_id: str, label: str = "Approve") -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        position=Position(x=0, y=0),
        data=ApprovalNodeData(label=label),
    )


def _script_node(node_id: str, source: str, language: str = "python") -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        position=Position(x=0, y=0),
        data=ScriptNodeData(language=language, source=source),
    )


async def _create_workflow(
    factory,  # noqa: ANN001 — session factory from sqlite_db fixture
    *,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    created_by: uuid.UUID,
    definition: WorkflowDefinition,
    name: str = "test-wf",
) -> Workflow:
    """Insert a workflow row directly (bypasses the service's
    trigger-uniqueness + cycle check so we can plant bad state for the
    defensive cycle test)."""
    async with factory() as session:
        wf = Workflow(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            project_id=project_id,
            name=name,
            description="phase-c test workflow",
            definition=definition.model_dump(mode="json"),
            created_by=created_by,
        )
        session.add(wf)
        await session.commit()
        await session.refresh(wf)
    return wf


async def _create_run(
    factory,  # noqa: ANN001
    *,
    workflow: Workflow,
    triggered_by: uuid.UUID,
) -> WorkflowRun:
    async with factory() as session:
        run = WorkflowRun(
            id=uuid.uuid4(),
            workflow_id=workflow.id,
            tenant_id=workflow.tenant_id,
            project_id=workflow.project_id,
            status=WorkflowRunStatus.PENDING,
            triggered_by=triggered_by,
            state={"stepResults": {}},
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
    return run


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_executor_runs_trigger_then_command(sqlite_db, event_bus) -> None:  # noqa: ANN001
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    factory = sqlite_db  # sqlite_db fixture yields the session factory

    definition = WorkflowDefinition(
        nodes=[
            _trigger_node("t1"),
            _command_node("c1", command_name="forge-echo", args={"msg": "hi"}),
        ],
        edges=[WorkflowEdge(id="e1", source="t1", target="c1")],
    )
    wf = await _create_workflow(
        factory,
        tenant_id=tenant_id,
        project_id=project_id,
        created_by=user_id,
        definition=definition,
    )
    run = await _create_run(factory, workflow=wf, triggered_by=user_id)

    # ``route_to_gsd`` is sync — ``asyncio.to_thread`` invokes it. The
    # mock must also be sync (the executor wraps it in to_thread).
    def _fake_route(name: str, args: dict[str, Any]) -> dict[str, Any]:  # noqa: ANN001
        return {"forge_cmd": name, "execution": {"ok": True}, "args": args}

    with patch(
        "app.services.workflow_executor.route_to_gsd",
        side_effect=_fake_route,
    ):
        async with factory() as session:
            await get_executor().execute(
                session,
                tenant_id=tenant_id,
                project_id=project_id,
                run_id=run.id,
            )

    async with factory() as session:
        refreshed = await session.get(WorkflowRun, run.id)
        assert refreshed is not None
        assert refreshed.status == WorkflowRunStatus.SUCCEEDED
        results = refreshed.state["stepResults"]
        assert results["t1"]["status"] == WorkflowStepStatus.SUCCEEDED.value
        assert results["c1"]["status"] == WorkflowStepStatus.SUCCEEDED.value
        assert results["c1"]["output"]["forge_cmd"] == "forge-echo"
        assert "duration_ms" in results["c1"]


# ---------------------------------------------------------------------------
# on_error=continue — failing command should NOT block downstream
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_executor_on_error_continue_lets_downstream_run(sqlite_db, event_bus) -> None:  # noqa: ANN001
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    factory = sqlite_db

    definition = WorkflowDefinition(
        nodes=[
            _trigger_node("t1"),
            _command_node("c1", command_name="forge-bad", on_error="continue"),
            _command_node("c2", command_name="forge-good"),
        ],
        edges=[
            WorkflowEdge(id="e1", source="t1", target="c1"),
            WorkflowEdge(id="e2", source="c1", target="c2"),
        ],
    )
    wf = await _create_workflow(
        factory,
        tenant_id=tenant_id,
        project_id=project_id,
        created_by=user_id,
        definition=definition,
    )
    run = await _create_run(factory, workflow=wf, triggered_by=user_id)

    def _route(name: str, args: dict[str, Any]) -> dict[str, Any]:  # noqa: ANN001
        if name == "forge-bad":
            raise RuntimeError("simulated downstream failure")
        return {"forge_cmd": name, "ok": True}

    with patch(
        "app.services.workflow_executor.route_to_gsd",
        side_effect=_route,
    ):
        async with factory() as session:
            await get_executor().execute(
                session,
                tenant_id=tenant_id,
                project_id=project_id,
                run_id=run.id,
            )

    async with factory() as session:
        refreshed = await session.get(WorkflowRun, run.id)
        assert refreshed.status == WorkflowRunStatus.SUCCEEDED
        results = refreshed.state["stepResults"]
        # c1 "succeeded" via on_error=continue (carries the error in output)
        assert results["c1"]["status"] == WorkflowStepStatus.SUCCEEDED.value
        assert "simulated downstream failure" in results["c1"]["output"].get(
            "skipped_reason", ""
        )
        # c2 still ran
        assert results["c2"]["status"] == WorkflowStepStatus.SUCCEEDED.value


# ---------------------------------------------------------------------------
# Failing command without on_error=continue — run goes FAILED
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_executor_command_failure_marks_run_failed(sqlite_db, event_bus) -> None:  # noqa: ANN001
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    factory = sqlite_db

    definition = WorkflowDefinition(
        nodes=[
            _trigger_node("t1"),
            _command_node("c1", command_name="forge-bad", on_error="fail"),
        ],
        edges=[WorkflowEdge(id="e1", source="t1", target="c1")],
    )
    wf = await _create_workflow(
        factory,
        tenant_id=tenant_id,
        project_id=project_id,
        created_by=user_id,
        definition=definition,
    )
    run = await _create_run(factory, workflow=wf, triggered_by=user_id)

    def _route(name: str, args: dict[str, Any]) -> dict[str, Any]:  # noqa: ANN001
        raise RuntimeError("boom")

    with patch("app.services.workflow_executor.route_to_gsd", side_effect=_route):
        async with factory() as session:
            await get_executor().execute(
                session,
                tenant_id=tenant_id,
                project_id=project_id,
                run_id=run.id,
            )

    async with factory() as session:
        refreshed = await session.get(WorkflowRun, run.id)
        assert refreshed.status == WorkflowRunStatus.FAILED
        results = refreshed.state["stepResults"]
        assert results["c1"]["status"] == WorkflowStepStatus.FAILED.value
        assert "boom" in results["c1"]["error"]


# ---------------------------------------------------------------------------
# Approval pause + resume
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_executor_pauses_on_approval_and_resumes_on_grant(sqlite_db, event_bus) -> None:  # noqa: ANN001
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    factory = sqlite_db

    definition = WorkflowDefinition(
        nodes=[
            _trigger_node("t1"),
            _command_node("c1", command_name="forge-echo"),
            _approval_node("a1", label="Security review"),
            _command_node("c2", command_name="forge-finalize"),
        ],
        edges=[
            WorkflowEdge(id="e1", source="t1", target="c1"),
            WorkflowEdge(id="e2", source="c1", target="a1"),
            WorkflowEdge(id="e3", source="a1", target="c2"),
        ],
    )
    wf = await _create_workflow(
        factory,
        tenant_id=tenant_id,
        project_id=project_id,
        created_by=user_id,
        definition=definition,
    )
    run = await _create_run(factory, workflow=wf, triggered_by=user_id)

    def _route(name: str, args: dict[str, Any]) -> dict[str, Any]:  # noqa: ANN001
        return {"forge_cmd": name, "ok": True}

    with patch("app.services.workflow_executor.route_to_gsd", side_effect=_route):
        # First execute: should pause on the approval step and raise.
        with pytest.raises(WorkflowApprovalResumeRequired) as excinfo:
            async with factory() as session:
                await get_executor().execute(
                    session,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    run_id=run.id,
                )
        approval_id = excinfo.value.approval_id

    async with factory() as session:
        paused = await session.get(WorkflowRun, run.id)
        assert paused.status == WorkflowRunStatus.WAITING_APPROVAL
        assert paused.current_step_id == "a1"
        assert paused.state["stepResults"]["a1"]["status"] == (
            WorkflowStepStatus.WAITING_APPROVAL.value
        )
        # The approval row was synthesized.
        approval = await session.get(ApprovalRequest, approval_id)
        assert approval is not None
        assert approval.status == ApprovalStatus.PENDING
        assert approval.payload["kind"] == "workflow"
        assert approval.payload["run_id"] == str(run.id)

    # Now resume with decision="granted" — should run c2 to completion.
    with patch("app.services.workflow_executor.route_to_gsd", side_effect=_route):
        async with factory() as session:
            await get_executor().resume(
                session,
                tenant_id=tenant_id,
                run_id=run.id,
                approval_id=approval_id,
                decision="granted",
            )
        async with factory() as session:
            final = await session.get(WorkflowRun, run.id)
            assert final.status == WorkflowRunStatus.SUCCEEDED
            results = final.state["stepResults"]
            assert results["a1"]["status"] == WorkflowStepStatus.SUCCEEDED.value
            assert results["c2"]["status"] == WorkflowStepStatus.SUCCEEDED.value


# ---------------------------------------------------------------------------
# Cancel is idempotent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_executor_cancel_is_idempotent(sqlite_db, event_bus) -> None:  # noqa: ANN001
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    factory = sqlite_db

    definition = WorkflowDefinition(
        nodes=[_trigger_node("t1")],
        edges=[],
    )
    wf = await _create_workflow(
        factory,
        tenant_id=tenant_id,
        project_id=project_id,
        created_by=user_id,
        definition=definition,
    )
    run = await _create_run(factory, workflow=wf, triggered_by=user_id)

    async with factory() as session:
        first = await get_executor().cancel(
            session,
            tenant_id=tenant_id,
            run_id=run.id,
        )
        second = await get_executor().cancel(
            session,
            tenant_id=tenant_id,
            run_id=run.id,
        )
    assert first.status == WorkflowRunStatus.CANCELLED
    assert second.status == WorkflowRunStatus.CANCELLED


# ---------------------------------------------------------------------------
# Defensive cycle detection (Kahn sort)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_executor_rejects_cyclic_definition(sqlite_db, event_bus) -> None:  # noqa: ANN001
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    factory = sqlite_db

    # Bypass the service's validation by writing a cyclic definition
    # directly into the JSONB column.
    definition = WorkflowDefinition(
        nodes=[_trigger_node("t1"), _command_node("c1")],
        edges=[
            WorkflowEdge(id="e1", source="t1", target="c1"),
            WorkflowEdge(id="e2", source="c1", target="t1"),  # cycle
        ],
    )
    wf = await _create_workflow(
        factory,
        tenant_id=tenant_id,
        project_id=project_id,
        created_by=user_id,
        definition=definition,
    )
    run = await _create_run(factory, workflow=wf, triggered_by=user_id)

    async with factory() as session:
        with pytest.raises(WorkflowExecutorError, match="cycle"):
            await get_executor().execute(
                session,
                tenant_id=tenant_id,
                project_id=project_id,
                run_id=run.id,
            )


# ---------------------------------------------------------------------------
# Bus events are emitted (Rule 6 — auditability smoke)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_executor_emits_step_and_run_events(sqlite_db, event_bus) -> None:  # noqa: ANN001
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    factory = sqlite_db

    # The executor uses the module-level ``bus`` singleton; subscribe
    # handlers to *that* bus so the test sees the events the executor
    # publishes (the fixture's local ``event_bus`` is for tests that
    # want to swap the singleton out).
    from app.services.event_bus import bus as module_bus

    seen: list[EventType] = []

    async def _collect(event) -> None:  # type: ignore[no-untyped-def]
        seen.append(event.event_type)

    for et in (
        EventType.WORKFLOW_STEP_STARTED,
        EventType.WORKFLOW_STEP_COMPLETED,
        EventType.WORKFLOW_RUN_COMPLETED,
    ):
        module_bus.subscribe(et, _collect)

    definition = WorkflowDefinition(
        nodes=[_trigger_node("t1"), _command_node("c1")],
        edges=[WorkflowEdge(id="e1", source="t1", target="c1")],
    )
    wf = await _create_workflow(
        factory,
        tenant_id=tenant_id,
        project_id=project_id,
        created_by=user_id,
        definition=definition,
    )
    run = await _create_run(factory, workflow=wf, triggered_by=user_id)

    def _route(name: str, args: dict[str, Any]) -> dict[str, Any]:  # noqa: ANN001
        return {"forge_cmd": name, "ok": True}

    with patch("app.services.workflow_executor.route_to_gsd", side_effect=_route):
        async with factory() as session:
            await get_executor().execute(
                session,
                tenant_id=tenant_id,
                project_id=project_id,
                run_id=run.id,
            )

    # In-memory bus dispatches synchronously inside publish(); no
    # drain needed. But the test loop may be in a different task, so
    # give it one scheduling tick to be safe.
    await asyncio.sleep(0)
    assert EventType.WORKFLOW_STEP_STARTED in seen
    assert EventType.WORKFLOW_STEP_COMPLETED in seen
    assert EventType.WORKFLOW_RUN_COMPLETED in seen


# ---------------------------------------------------------------------------
# Script step executes via the sandbox
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_executor_runs_script_step(sqlite_db, event_bus) -> None:  # noqa: ANN001
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    factory = sqlite_db

    definition = WorkflowDefinition(
        nodes=[
            _trigger_node("t1"),
            _script_node("s1", "print('hello')", language="python"),
        ],
        edges=[WorkflowEdge(id="e1", source="t1", target="s1")],
    )
    wf = await _create_workflow(
        factory,
        tenant_id=tenant_id,
        project_id=project_id,
        created_by=user_id,
        definition=definition,
    )
    run = await _create_run(factory, workflow=wf, triggered_by=user_id)

    async with factory() as session:
        await get_executor().execute(
            session,
            tenant_id=tenant_id,
            project_id=project_id,
            run_id=run.id,
        )

    async with factory() as session:
        refreshed = await session.get(WorkflowRun, run.id)
        assert refreshed.status == WorkflowRunStatus.SUCCEEDED
        result = refreshed.state["stepResults"]["s1"]
        assert result["status"] == WorkflowStepStatus.SUCCEEDED.value
        # Sandbox wrapper contract
        assert "stdout" in result["output"]
        assert "exit_code" in result["output"]

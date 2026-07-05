"""Workflow endpoints (NFR-044 budget + F-018 custom workflows).

Budget endpoints (NFR-044):

* ``POST /api/v1/workflows/{workflow_id}/budget`` — declare a ceiling.
* ``GET  /api/v1/workflows/{workflow_id}/budget`` — current state.
* ``GET  /api/v1/workflows/{workflow_id}/budget/history`` — admission audit trail.

Custom workflow endpoints (F-018):

* ``GET    /api/v1/workflows``                       — list workflows in tenant.
* ``POST   /api/v1/workflows``                       — create a workflow.
* ``GET    /api/v1/workflows/{workflow_id}``         — read one workflow.
* ``PATCH  /api/v1/workflows/{workflow_id}``         — update metadata or definition.
* ``DELETE /api/v1/workflows/{workflow_id}``         — soft delete.
* ``POST   /api/v1/workflows/{workflow_id}/runs``    — start a run.
* ``GET    /api/v1/workflows/{workflow_id}/runs``    — list runs for one workflow.
* ``GET    /api/v1/workflows/runs/{run_id}``         — read one run.
* ``POST   /api/v1/workflows/runs/{run_id}/cancel``  — cancel an in-flight run.

The executor (Phase C) wires the run lifecycle end-to-end; these
endpoints create the run row + publish the start event but do not
yet block on step execution.
"""

from __future__ import annotations

import asyncio
import json
from typing import Annotated, AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse

from app.api.deps import DbSession, Principal, get_current_principal
from app.core.security import AuthenticatedPrincipal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.core.logging import get_logger
from app.db.models.workflow import Workflow, WorkflowRunStatus
from app.schemas.workflow import (
    WorkflowCreate,
    WorkflowRead,
    WorkflowRunCreate,
    WorkflowRunRead,
    WorkflowUpdate,
)
from app.schemas.workflow_budget import BudgetDeclareRequest, BudgetRead
from app.services.event_bus import EventType, bus
from app.services.workflow_budget import workflow_budget_service
from app.services.workflow_service import (
    WorkflowConflictError,
    WorkflowNotFound,
    WorkflowService,
    WorkflowValidationError,
)
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

logger = get_logger(__name__)

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _snapshot_to_read(snapshot) -> BudgetRead:
    ceiling = float(snapshot.ceiling_usd)
    spent = float(snapshot.spent_usd)
    headroom_pct = round((snapshot.remaining_usd / ceiling) * 100, 2) if ceiling > 0 else 0.0
    return BudgetRead(
        workflow_id=snapshot.workflow_id,
        ceiling_usd=ceiling,
        spent_usd=spent,
        remaining_usd=snapshot.remaining_usd,
        status=snapshot.status,
        headroom_pct=headroom_pct,
    )
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/{workflow_id}/budget",
    response_model=BudgetRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="workflow.budget.declare", target_type="workflow_budget")
async def declare_budget(
    workflow_id: UUID,
    body: BudgetDeclareRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> BudgetRead:
    if body.workflow_id != workflow_id:
        raise HTTPException(
            status_code=400, detail="workflow_id_mismatch_with_path"
        )
    snapshot = await workflow_budget_service.declare_budget(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or workflow_id,
        workflow_id=workflow_id,
        ceiling_usd=body.ceiling_usd,
        actor_id=principal.user_id,
        metadata=body.metadata,
    )
    return _snapshot_to_read(snapshot)


@router.get("/{workflow_id}/budget", response_model=BudgetRead)
@audit(action="workflow.budget.read", target_type="workflow_budget")
async def get_budget(
    workflow_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> BudgetRead:
    snapshot = await workflow_budget_service.get_budget(workflow_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="workflow_budget_not_found")
    return _snapshot_to_read(snapshot)


@router.get("/{workflow_id}/budget/history", response_model=list[dict])
@audit(action="workflow.budget.history", target_type="workflow_budget")
async def budget_history(
    workflow_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> list[dict]:
    return await workflow_budget_service.history(workflow_id)


# ---------------------------------------------------------------------------
# Custom Workflows (F-018)
# ---------------------------------------------------------------------------

_workflow_service = WorkflowService()


def _workflow_to_read(wf: Workflow) -> WorkflowRead:
    return WorkflowRead(
        id=wf.id,
        tenant_id=wf.tenant_id,
        project_id=wf.project_id,
        name=wf.name,
        description=wf.description,
        status=getattr(wf, "status", "draft") or "draft",
        definition=wf.definition,
        created_by=wf.created_by,
        created_at=wf.created_at,
        updated_at=wf.updated_at,
        latest_run_id=wf.latest_run_id,
    )


@router.get("", response_model=list[WorkflowRead])
@audit(action="workflows.list", target_type="workflow")
async def list_workflows(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
    include_deleted: bool = Query(default=False),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[WorkflowRead]:
    rows = await _workflow_service.list_workflows(
        db,
        tenant_id=principal.tenant_id,
        project_id=project_id,
        include_deleted=include_deleted,
    )
    return [_workflow_to_read(r) for r in rows]
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post("", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
@audit(action="workflows.create", target_type="workflow")
async def create_workflow(
    body: WorkflowCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRead:
    try:
        wf = await _workflow_service.create_workflow(
            db,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            created_by=principal.user_id,
            body=body,
        )
    except WorkflowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except WorkflowConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _workflow_to_read(wf)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post("/{workflow_id}/publish", response_model=WorkflowRead)
@audit(action="workflows.publish", target_type="workflow")
async def publish_workflow(
    workflow_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRead:
    """Flip a draft workflow to ``published`` (Rule 3: gate implicit)."""
    try:
        wf = await _workflow_service.update_workflow(
            db,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
            workflow_id=workflow_id,
            body=WorkflowUpdate(status="published"),
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WorkflowConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _workflow_to_read(wf)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post("/{workflow_id}/duplicate", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
@audit(action="workflows.duplicate", target_type="workflow")
async def duplicate_workflow(
    workflow_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRead:
    """Clone the workflow with a " (copy)" suffix (Rule 4 typed artifact)."""
    try:
        wf = await _workflow_service.get_workflow(
            db, tenant_id=principal.tenant_id, workflow_id=workflow_id
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    clone = WorkflowCreate(
        name=f"{wf.name} (copy)",
        description=wf.description,
        definition=wf.definition,
    )
    new_wf = await _workflow_service.create_workflow(
        db,
        tenant_id=principal.tenant_id,
        project_id=wf.project_id,
        created_by=principal.user_id,
        body=clone,
    )
    return _workflow_to_read(new_wf)


# Run-scoped routes declared BEFORE /{workflow_id} so FastAPI doesn't
# capture "runs" as a UUID path parameter.
@router.get("/runs/{run_id}", response_model=WorkflowRunRead)
@audit(action="workflows.runs.read", target_type="workflow_run")
async def get_workflow_run(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRunRead:
    try:
        run = await _workflow_service.get_run(
            db, tenant_id=principal.tenant_id, run_id=run_id
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return WorkflowRunRead.model_validate(run)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post("/runs/{run_id}/cancel", response_model=WorkflowRunRead)
@audit(action="workflows.runs.cancel", target_type="workflow_run")
async def cancel_workflow_run(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRunRead:
    try:
        run = await _workflow_service.cancel_run(
            db,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
            run_id=run_id,
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WorkflowConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return WorkflowRunRead.model_validate(run)


@router.get("/{workflow_id}", response_model=WorkflowRead)
@audit(action="workflows.read", target_type="workflow")
async def get_workflow(
    workflow_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRead:
    try:
        wf = await _workflow_service.get_workflow(
            db, tenant_id=principal.tenant_id, workflow_id=workflow_id
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _workflow_to_read(wf)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.patch("/{workflow_id}", response_model=WorkflowRead)
@audit(action="workflows.update", target_type="workflow")
async def update_workflow(
    workflow_id: UUID,
    body: WorkflowUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRead:
    try:
        wf = await _workflow_service.update_workflow(
            db,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
            workflow_id=workflow_id,
            body=body,
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WorkflowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except WorkflowConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _workflow_to_read(wf)
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.delete(
    "/{workflow_id}",
    response_model=None,
    response_class=Response,
)
@audit(action="workflows.delete", target_type="workflow")
async def delete_workflow(
    workflow_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> None:
    try:
        await _workflow_service.soft_delete_workflow(
            db,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
            workflow_id=workflow_id,
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs", response_model=list[WorkflowRunRead])
@audit(action="workflows.runs.list_all", target_type="workflow_run")
async def list_all_workflow_runs(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[WorkflowRunRead]:
    """Tenant-wide workflow-runs index (used by the Runs Center)."""
    rows = await _workflow_service.list_all_runs(
        db, tenant_id=principal.tenant_id, limit=limit, offset=offset
    )
    return [WorkflowRunRead.model_validate(r) for r in rows]


@router.get("/{workflow_id}/runs", response_model=list[WorkflowRunRead])
@audit(action="workflows.runs.list", target_type="workflow_run")
async def list_workflow_runs(
    workflow_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> list[WorkflowRunRead]:
    rows = await _workflow_service.list_runs(
        db, tenant_id=principal.tenant_id, workflow_id=workflow_id
    )
    return [WorkflowRunRead.model_validate(r) for r in rows]
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/{workflow_id}/runs",
    response_model=WorkflowRunRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="workflows.runs.start", target_type="workflow_run")
async def start_workflow_run(
    workflow_id: UUID,
    body: WorkflowRunCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRunRead:
    try:
        wf = await _workflow_service.get_workflow(
            db, tenant_id=principal.tenant_id, workflow_id=workflow_id
        )
        run = await _workflow_service.create_run(
            db,
            tenant_id=principal.tenant_id,
            project_id=wf.project_id,
            triggered_by=principal.user_id,
            workflow_id=wf.id,
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Kick off the DAG runner. ``WorkflowApprovalResumeRequired`` is the
    # normal pause-after-approval case — the run row is already saved in
    # ``WAITING_APPROVAL`` and we just return that state. Any other
    # exception is a 500 with typed detail (Rule 4 — typed artifacts).
    try:
        from app.services.workflow_executor import (
            WorkflowApprovalResumeRequired,
            WorkflowExecutorError,
            get_executor,
        )

        await get_executor().execute(
            db,
            tenant_id=principal.tenant_id,
            project_id=wf.project_id,
            run_id=run.id,
        )
    except WorkflowApprovalResumeRequired:
        # Expected — refresh so the caller sees the current state row.
        await db.refresh(run)
    except WorkflowExecutorError as exc:
        # Persist the failure on the row so polling endpoints see it.
        run.status = WorkflowRunStatus.FAILED
        run.error = str(exc)
        await db.commit()
        await db.refresh(run)
        logger.warning(
            "workflow.executor_error", run_id=str(run.id), error=str(exc)
        )
    except Exception as exc:  # noqa: BLE001 — surface typed failure
        logger.error("workflow.executor_unexpected", run_id=str(run.id), error=str(exc))
        run.status = WorkflowRunStatus.FAILED
        run.error = f"executor crashed: {exc}"
        await db.commit()
        await db.refresh(run)

    return WorkflowRunRead.model_validate(run)


# ---------------------------------------------------------------------------
# Run-scoped SSE stream + manual resume.
#
# The SSE stream emits a `data:` line per workflow event scoped to the
# run_id, plus keep-alives every 15s. It closes when the run reaches a
# terminal state (SUCCEEDED / FAILED / CANCELLED) or when the client
# disconnects.
# ---------------------------------------------------------------------------


def _sse_format(payload: dict) -> bytes:
    """Format a single ``data:`` line for the SSE stream."""
    return f"data: {json.dumps(payload, default=str)}\n\n".encode("utf-8")


# Events that flow through the SSE stream for a single run.
_RUN_SCOPED_EVENTS: tuple[EventType, ...] = (
    EventType.WORKFLOW_STEP_STARTED,
    EventType.WORKFLOW_STEP_COMPLETED,
    EventType.WORKFLOW_STEP_FAILED,
    EventType.WORKFLOW_RUN_PAUSED,
    EventType.WORKFLOW_RUN_RESUMED,
    EventType.WORKFLOW_RUN_COMPLETED,
    EventType.WORKFLOW_RUN_FAILED,
    EventType.WORKFLOW_RUN_CANCELLED,
)


@router.get("/runs/{run_id}/events")
async def stream_run_events(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal | None, Depends(get_current_principal)] = None,
    token: str | None = Query(default=None, description="SSE auth fallback (EventSource can't set headers)"),
    db: DbSession = None,  # type: ignore[assignment]
) -> StreamingResponse:
    """SSE stream: emit one ``data:`` line per workflow event for this run.

    Replays the current run state on connect, then forwards every
    workflow event whose ``payload.run_id`` matches. The stream closes
    when the run reaches a terminal status.
    """
    # Authorization — the run must belong to the caller's tenant.
    # When the caller authenticates via ?token= (EventSource can't set
    # headers), resolve the principal from the query token. Otherwise
    # fall through to the header-derived principal injected by FastAPI.
    if principal is None and token:
        from app.core.security import principal_from_token
        principal = principal_from_token(token)  # type: ignore[assignment]
        if principal is None:
            raise HTTPException(status_code=401, detail="invalid_query_token")
    if principal is None:
        raise HTTPException(status_code=401, detail="missing_principal")

    try:
        run = await _workflow_service.get_run(
            db, tenant_id=principal.tenant_id, run_id=run_id
        )
    except WorkflowNotFound as exc:
        raise HTTPException(status_code=404, detail="run_not_found") from exc

    initial_snapshot = {
        "id": str(run.id),
        "workflow_id": str(run.workflow_id),
        "status": run.status.value,
        "current_step_id": run.current_step_id,
        "state": run.state,
        "error": run.error,
    }

    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def _handler(event) -> None:  # type: ignore[no-untyped-def]
        # Filter on payload.run_id so other runs in the same tenant
        # don't leak into this stream.
        if event.payload.get("run_id") == str(run_id):
            loop.call_soon_threadsafe(queue.put_nowait, event)

    for et in _RUN_SCOPED_EVENTS:
        bus.subscribe(et, _handler)

    TERMINAL = (
        WorkflowRunStatus.SUCCEEDED,
        WorkflowRunStatus.FAILED,
        WorkflowRunStatus.CANCELLED,
    )

    async def _gen() -> AsyncIterator[bytes]:
        try:
            yield _sse_format({"type": "snapshot", "data": initial_snapshot})
            while True:
                # Re-read terminal status in case it flipped before the
                # event loop dequeued an event.
                refreshed = await _workflow_service.get_run(
                    db, tenant_id=principal.tenant_id, run_id=run_id
                )
                if refreshed is not None and refreshed.status in TERMINAL:
                    yield _sse_format(
                        {
                            "type": "snapshot",
                            "data": {
                                "id": str(refreshed.id),
                                "workflow_id": str(refreshed.workflow_id),
                                "status": refreshed.status.value,
                                "current_step_id": refreshed.current_step_id,
                                "state": refreshed.state,
                                "error": refreshed.error,
                            },
                        }
                    )
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield b": keep-alive\n\n"
                    continue
                yield _sse_format(
                    {
                        "type": event.event_type.value,
                        "data": event.to_dict(),
                    }
                )
        finally:
            for et in _RUN_SCOPED_EVENTS:
                bus._typed_handlers[et].remove(_handler)  # noqa: SLF001

    return StreamingResponse(_gen(), media_type="text/event-stream")
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post("/runs/{run_id}/resume", response_model=WorkflowRunRead)
@audit(action="workflows.runs.resume", target_type="workflow_run")
async def resume_workflow_run(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
) -> WorkflowRunRead:
    """Manually resume a ``WAITING_APPROVAL`` run.

    In the typical path, the approval is decided via
    ``POST /api/v1/approvals/{id}/decide`` and that endpoint calls
    ``WorkflowExecutor.resume`` directly. This endpoint exists for the
    edge case where a run is paused with no live approval row (e.g. a
    legacy row, or a manual operator override).
    """
    run = await _workflow_service.get_run(
        db, tenant_id=principal.tenant_id, run_id=run_id
    )
    if run.status != WorkflowRunStatus.WAITING_APPROVAL:
        raise HTTPException(
            status_code=409,
            detail={"error": "not_waiting_approval", "status": run.status.value},
        )

    from app.services.workflow_executor import (
        WorkflowApprovalResumeRequired,
        WorkflowExecutorError,
        get_executor,
    )

    # Find the approval_id the run is waiting on (last WAITING_APPROVAL step).
    step_results = (run.state or {}).get("stepResults", {})
    approval_step = next(
        (
            (sid, r)
            for sid, r in step_results.items()
            if r.get("status") == "waiting_approval"
        ),
        None,
    )
    if approval_step is None:
        raise HTTPException(
            status_code=409,
            detail="run_is_waiting_approval_but_no_pending_step",
        )
    _, result = approval_step
    approval_id = result.get("approval_id")
    if not approval_id:
        raise HTTPException(status_code=409, detail="approval_id_missing_on_step")

    try:
        await get_executor().resume(
            db,
            tenant_id=principal.tenant_id,
            run_id=run_id,
            approval_id=UUID(approval_id),
            decision="granted",
        )
    except WorkflowApprovalResumeRequired:
        # Re-paused on a subsequent approval — leave it that way.
        pass
    except WorkflowExecutorError as exc:
        logger.warning(
            "workflow.resume_failed", run_id=str(run_id), error=str(exc)
        )

    refreshed = await _workflow_service.get_run(
        db, tenant_id=principal.tenant_id, run_id=run_id
    )
    return WorkflowRunRead.model_validate(refreshed)



__all__ = ["router"]
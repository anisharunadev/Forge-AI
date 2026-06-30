"""F-014 — Agent Runtime REST endpoints."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.runtime import (
    RuntimeHandle,
    RuntimeMetrics,
    RuntimeStartRequest,
)
from app.services.agent_runtime import agent_runtime

router = APIRouter(prefix="/runtimes", tags=["agent-runtimes"])


@router.get("", response_model=list[RuntimeHandle])
@audit(action="runtimes.list", target_type="runtime")
async def list_runtimes(
    principal: Principal,
    _perm: Principal = require_permission("runtimes:read"),
) -> list[RuntimeHandle]:
    handles = await agent_runtime.list_runtimes(principal.tenant_id)
    return [_handle_to_schema(h) for h in handles]


@router.post("/start", response_model=RuntimeHandle)
@audit(action="runtimes.start", target_type="runtime")
async def start_runtime(
    body: RuntimeStartRequest,
    principal: Principal,
    _perm: Principal = require_permission("runtimes:start"),
) -> RuntimeHandle:
    handle = await agent_runtime.start(
        agent_id=body.agent_id,
        workspace_path=body.workspace_path,
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        kind=body.kind,
    )
    return _handle_to_schema(handle)


@router.post("/{handle_id}/stop", response_model=RuntimeHandle)
@audit(action="runtimes.stop", target_type="runtime")
async def stop_runtime(
    handle_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("runtimes:stop"),
) -> RuntimeHandle:
    try:
        await agent_runtime.stop(handle_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    # Return a synthetic handle reflecting the stopped state.
    from app.services.agent_runtime import RuntimeHandle as RH

    rh = RH(
        id=handle_id,
        tenant_id=UUID(str(principal.tenant_id)),
        project_id=None,
        agent_id=handle_id,  # placeholder; we don't reload from storage in M2.
        workspace_path="",
        kind=body_kind_default(),
        started_at=datetime.now(timezone.utc),
        stopped_at=datetime.now(timezone.utc),
    )
    rh.state = _state_after_stop()
    return _handle_to_schema(rh)


@router.get("/{handle_id}/metrics", response_model=RuntimeMetrics)
@audit(action="runtimes.metrics", target_type="runtime")
async def runtime_metrics(
    handle_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("runtimes:read"),
) -> RuntimeMetrics:
    try:
        metrics = await agent_runtime.get_runtime_metrics(handle_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return metrics


def _handle_to_schema(handle) -> RuntimeHandle:
    from app.schemas.runtime import RuntimeKind, RuntimeState

    now = datetime.now(timezone.utc)
    started = getattr(handle, "started_at", None)
    stopped = getattr(handle, "stopped_at", None)
    return RuntimeHandle(
        id=handle.id,
        tenant_id=handle.tenant_id,
        project_id=handle.project_id,
        created_at=started or now,
        updated_at=stopped or started or now,
        agent_id=handle.agent_id,
        workspace_path=handle.workspace_path,
        kind=handle.kind if isinstance(handle.kind, RuntimeKind) else RuntimeKind(handle.kind),
        state=handle.state if isinstance(handle.state, RuntimeState) else RuntimeState(handle.state),
        started_at=started,
        stopped_at=stopped,
    )


def body_kind_default():
    from app.schemas.runtime import RuntimeKind

    return RuntimeKind.LOCAL_SUBPROCESS


def _state_after_stop():
    from app.schemas.runtime import RuntimeState

    return RuntimeState.STOPPED


__all__ = ["router"]

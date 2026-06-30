"""F-016 — Runtime Management admin REST endpoints."""

from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.runtime import RuntimeHandle, RuntimeMetrics
from app.services.runtime_management import runtime_management

router = APIRouter(prefix="/runtime", tags=["runtime-management"])


@router.get("/agents", response_model=list[RuntimeHandle])
@audit(action="runtime_management.list", target_type="runtime")
async def list_all_runtimes(
    principal: Principal,
    _perm: Principal = require_permission("runtimes:admin"),
) -> list[RuntimeHandle]:
    from app.schemas.runtime import RuntimeKind, RuntimeState

    handles = await runtime_management.list_all_runtimes()
    out: list[RuntimeHandle] = []
    for h in handles:
        out.append(
            RuntimeHandle(
                id=h.id,
                tenant_id=h.tenant_id,
                project_id=h.project_id,
                created_at=h.started_at or _utcnow(),
                updated_at=h.stopped_at or h.started_at or _utcnow(),
                agent_id=h.agent_id,
                workspace_path=h.workspace_path,
                kind=h.kind if isinstance(h.kind, RuntimeKind) else RuntimeKind(h.kind),
                state=h.state if isinstance(h.state, RuntimeState) else RuntimeState(h.state),
                started_at=h.started_at,
                stopped_at=h.stopped_at,
            )
        )
    return out


@router.post("/agents/{handle_id}/restart", response_model=RuntimeHandle)
@audit(action="runtime_management.restart", target_type="runtime")
async def restart_runtime(
    handle_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("runtimes:admin"),
) -> RuntimeHandle:
    new_handle = await runtime_management.restart_runtime(handle_id)
    return _handle_to_schema(new_handle)


@router.post("/agents/{handle_id}/stop", response_model=RuntimeHandle)
@audit(action="runtime_management.stop", target_type="runtime")
async def stop_runtime_admin(
    handle_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("runtimes:admin"),
) -> RuntimeHandle:
    handle = await runtime_management.stop_runtime(handle_id)
    return _handle_to_schema(handle)


@router.get("/metrics", response_model=dict)
@audit(action="runtime_management.metrics", target_type="runtime")
async def platform_metrics(
    principal: Principal,
    _perm: Principal = require_permission("runtimes:admin"),
) -> dict:
    metrics = await runtime_management.platform_metrics()
    d = asdict(metrics)
    d["collected_at"] = d["collected_at"].isoformat()
    return d


def _handle_to_schema(handle) -> RuntimeHandle:
    from app.schemas.runtime import RuntimeKind, RuntimeState

    return RuntimeHandle(
        id=handle.id,
        tenant_id=handle.tenant_id,
        project_id=handle.project_id,
        created_at=handle.started_at or _utcnow(),
        updated_at=handle.stopped_at or handle.started_at or _utcnow(),
        agent_id=handle.agent_id,
        workspace_path=handle.workspace_path,
        kind=handle.kind if isinstance(handle.kind, RuntimeKind) else RuntimeKind(handle.kind),
        state=handle.state if isinstance(handle.state, RuntimeState) else RuntimeState(handle.state),
        started_at=handle.started_at,
        stopped_at=handle.stopped_at,
    )


def _utcnow():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


__all__ = ["router"]

"""Runtime Management (F-016).

Platform-wide admin operations on agent runtimes: restart, stop,
cross-tenant metrics. The single-tenant runtime adapter lives in
`agent_runtime.AgentRuntime`; this service composes a multi-tenant
view on top.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from app.core.logging import get_logger
from app.schemas.runtime import RuntimeState
from app.services.agent_runtime import AgentRuntime, RuntimeHandle, agent_runtime

logger = get_logger(__name__)


@dataclass
class PlatformRuntimeMetrics:
    total_runtimes: int
    running: int
    stopped: int
    failed: int
    total_uptime_seconds: float
    collected_at: datetime


class RuntimeManagementService:
    """Admin view over the in-process AgentRuntime."""

    def __init__(self, runtime: AgentRuntime | None = None) -> None:
        self._runtime = runtime or agent_runtime

    async def list_all_runtimes(self) -> list[RuntimeHandle]:
        # The adapter keeps a per-tenant index; flatten for the admin view.
        # For Phase 2 we don't yet know every tenant id, so callers can
        # pre-filter; we expose a passthrough that returns all handles
        # currently tracked in the local process.
        all_handles: list[RuntimeHandle] = []
        for handle_id, handle in self._runtime._handles.items():  # type: ignore[attr-defined]
            _ = handle_id
            all_handles.append(handle)
        return all_handles

    async def restart_runtime(self, handle_id: UUID | str) -> RuntimeHandle:
        handle = self._runtime._handles.get(UUID(str(handle_id)))  # type: ignore[attr-defined]
        if handle is None:
            raise LookupError(f"runtime_handle {handle_id} not found")
        # Phase 2: stop+start is enough; K8s rollouts land in F-014 deeper wiring.
        await self._runtime.stop(handle_id)
        new_handle = await self._runtime.start(
            agent_id=handle.agent_id,
            workspace_path=handle.workspace_path,
            tenant_id=handle.tenant_id,
            project_id=handle.project_id,
            kind=handle.kind,
        )
        logger.info("runtime.restarted", handle_id=str(handle_id), new_id=str(new_handle.id))
        return new_handle

    async def stop_runtime(self, handle_id: UUID | str) -> RuntimeHandle:
        handle = self._runtime._handles.get(UUID(str(handle_id)))  # type: ignore[attr-defined]
        if handle is None:
            raise LookupError(f"runtime_handle {handle_id} not found")
        await self._runtime.stop(handle_id)
        return handle

    async def platform_metrics(self) -> PlatformRuntimeMetrics:
        handles = await self.list_all_runtimes()
        running = sum(1 for h in handles if h.state == RuntimeState.RUNNING)
        stopped = sum(1 for h in handles if h.state == RuntimeState.STOPPED)
        failed = sum(1 for h in handles if h.state == RuntimeState.FAILED)
        total_uptime = 0.0
        for h in handles:
            if h.started_at is None:
                continue
            end = h.stopped_at or datetime.now(UTC)
            total_uptime += (end - h.started_at).total_seconds()
        return PlatformRuntimeMetrics(
            total_runtimes=len(handles),
            running=running,
            stopped=stopped,
            failed=failed,
            total_uptime_seconds=round(total_uptime, 2),
            collected_at=datetime.now(UTC),
        )


runtime_management = RuntimeManagementService()


__all__ = [
    "PlatformRuntimeMetrics",
    "RuntimeManagementService",
    "runtime_management",
]

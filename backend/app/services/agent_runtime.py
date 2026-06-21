"""Agent Runtime Adapter (F-014).

Adapts agent startup/shutdown/metrics to either a local subprocess
or a remote Kubernetes pod based on configuration. The K8s branch
is a thin wrapper around a hypothetical `kube` helper — actual
calls land in F-016 (Runtime Management).

F-505 adds `invoke_tool` to enforce per-stage tool bundle guardrails
at the agent-runtime tool-invocation boundary.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.runtime import RuntimeKind, RuntimeMetrics, RuntimeState
from app.schemas.tool_bundles import Stage, ToolBundleDecision
from app.services.tool_bundles import (
    ToolBundleViolation,
    tool_bundles,
)

logger = get_logger(__name__)


@dataclass
class RuntimeHandle:
    """Bookkeeping for one running agent process."""

    id: UUID
    tenant_id: UUID
    project_id: UUID | None
    agent_id: UUID
    workspace_path: str
    kind: RuntimeKind
    state: RuntimeState = RuntimeState.STARTING
    started_at: datetime | None = None
    stopped_at: datetime | None = None
    process: asyncio.subprocess.Process | None = field(default=None, repr=False)
    pid: int | None = None


class AgentRuntime:
    """Owns the lifecycle of agent runtimes.

    Runtimes are kept in memory (process-local) and tracked per tenant.
    """

    def __init__(self) -> None:
        self._handles: dict[UUID, RuntimeHandle] = {}
        self._by_tenant: dict[str, set[UUID]] = {}

    async def start(
        self,
        *,
        agent_id: UUID | str,
        workspace_path: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        kind: RuntimeKind = RuntimeKind.LOCAL_SUBPROCESS,
    ) -> RuntimeHandle:
        workspace_path = os.path.abspath(workspace_path)
        os.makedirs(workspace_path, exist_ok=True)

        handle = RuntimeHandle(
            id=uuid.uuid4(),
            tenant_id=UUID(str(tenant_id)),
            project_id=UUID(str(project_id)) if project_id else None,
            agent_id=UUID(str(agent_id)),
            workspace_path=workspace_path,
            kind=kind,
        )

        if kind == RuntimeKind.LOCAL_SUBPROCESS:
            handle.process = await asyncio.create_subprocess_exec(
                "echo",
                f"forge-agent:{handle.agent_id}",
                cwd=workspace_path,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            handle.pid = handle.process.pid
        elif kind == RuntimeKind.KUBERNETES_POD:
            # Real K8s wiring lives in F-016 Runtime Management; here we
            # just record the would-be pod id so the API contract holds.
            handle.pid = None
        else:
            raise ValueError(f"unsupported_runtime_kind:{kind}")

        handle.started_at = datetime.now(timezone.utc)
        handle.state = RuntimeState.RUNNING
        self._handles[handle.id] = handle
        self._by_tenant.setdefault(str(tenant_id), set()).add(handle.id)
        logger.info(
            "runtime.started",
            handle_id=str(handle.id),
            agent_id=str(handle.agent_id),
            kind=kind.value,
        )
        return handle

    async def stop(self, handle_id: UUID | str) -> None:
        handle = self._handles.get(UUID(str(handle_id)))
        if handle is None:
            raise LookupError(f"runtime_handle {handle_id} not found")
        if handle.process is not None and handle.process.returncode is None:
            handle.process.terminate()
            try:
                await asyncio.wait_for(handle.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                handle.process.kill()
                await handle.process.wait()
        handle.stopped_at = datetime.now(timezone.utc)
        handle.state = RuntimeState.STOPPED
        self._by_tenant.get(handle.tenant_id.hex, set()).discard(handle.id)
        logger.info("runtime.stopped", handle_id=str(handle.id))

    async def list_runtimes(self, tenant_id: UUID | str) -> list[RuntimeHandle]:
        ids = self._by_tenant.get(str(tenant_id), set())
        return [self._handles[i] for i in ids if i in self._handles]

    async def get_runtime_metrics(self, handle_id: UUID | str) -> RuntimeMetrics:
        handle = self._handles.get(UUID(str(handle_id)))
        if handle is None:
            raise LookupError(f"runtime_handle {handle_id} not found")
        cpu_percent = 0.0
        memory_mb = 0.0
        tokens_used = 0
        tool_calls = 0
        uptime = 0.0
        if handle.started_at is not None:
            uptime = (datetime.now(timezone.utc) - handle.started_at).total_seconds()
        if handle.process is not None and handle.process.returncode is None:
            rss = handle.process.pid and 0  # psutil not added in Phase 2.
            _ = rss
        return RuntimeMetrics(
            handle_id=handle.id,
            cpu_percent=cpu_percent,
            memory_mb=memory_mb,
            tokens_used=tokens_used,
            tool_calls=tool_calls,
            uptime_seconds=uptime,
            collected_at=datetime.now(timezone.utc),
        )

    # -- F-505 tool-invocation hook -----------------------------------------
    async def invoke_tool(
        self,
        *,
        handle_id: UUID | str,
        tool: str,
        agent_state: dict[str, Any] | None = None,
        current_stage: Stage,
        args: dict[str, Any] | None = None,
        actor_id: str | None = None,
    ) -> ToolBundleDecision:
        """Invoke a tool through the runtime's bundle guardrail.

        The bundle enforcement layer runs first; if `tool` is permitted
        for `current_stage` we record the invocation and return the
        decision. Violations raise `ToolBundleViolation` and have
        already been written to F-005 by the registry.
        """
        handle = self._handles.get(UUID(str(handle_id)))
        if handle is None:
            raise LookupError(f"runtime_handle {handle_id} not found")

        state: dict[str, Any] = dict(agent_state or {})
        state.setdefault("agent_id", str(handle.agent_id))

        decision = await tool_bundles.enforce(
            agent_state=state,
            current_stage=current_stage,
            attempted_tool=tool,
            tenant_id=str(handle.tenant_id),
            project_id=str(handle.project_id) if handle.project_id else None,
            actor_id=actor_id,
        )
        logger.info(
            "runtime.tool_invoked",
            handle_id=str(handle.id),
            agent_id=str(handle.agent_id),
            stage=current_stage,
            tool=tool,
            allowed=decision.allowed,
        )
        return decision


agent_runtime = AgentRuntime()


__all__ = ["AgentRuntime", "RuntimeHandle", "agent_runtime"]

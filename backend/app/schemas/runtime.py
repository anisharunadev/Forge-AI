"""Schemas for F-014/F-016 — Agent Runtimes."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel


class RuntimeState(str, Enum):
    """Lifecycle of a runtime handle."""

    STARTING = "starting"
    RUNNING = "running"
    STOPPED = "stopped"
    FAILED = "failed"
    UNKNOWN = "unknown"


class RuntimeKind(str, Enum):
    """Where the agent is hosted."""

    LOCAL_SUBPROCESS = "local_subprocess"
    KUBERNETES_POD = "kubernetes_pod"


class RuntimeStartRequest(ForgeBaseModel):
    agent_id: UUID
    workspace_path: str = Field(..., min_length=1)
    kind: RuntimeKind = RuntimeKind.LOCAL_SUBPROCESS


class RuntimeHandle(TenantScopedModel):
    id: UUID
    agent_id: UUID
    workspace_path: str
    kind: RuntimeKind
    state: RuntimeState
    started_at: datetime | None
    stopped_at: datetime | None


class RuntimeMetrics(ForgeBaseModel):
    handle_id: UUID
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    tokens_used: int = 0
    tool_calls: int = 0
    uptime_seconds: float = 0.0
    collected_at: datetime

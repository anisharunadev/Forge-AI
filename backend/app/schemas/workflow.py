"""Pydantic schemas for custom workflows (F-018 extension).

The editor's payload is mirrored here in three layers:

1. ``WorkflowNode*`` — one per node kind (trigger / command / approval /
   script). The full ``WorkflowDefinition`` is a discriminated union via
   ``node.type``.
2. ``WorkflowDefinition`` — the JSONB blob the editor saves. Validation
   lives in the service layer (cycle detection, trigger uniqueness) per
   the project convention — schemas do not use ``model_validator``.
3. ``WorkflowCreate`` / ``WorkflowUpdate`` / ``WorkflowRead`` — request /
   response envelopes. ``WorkflowRead`` extends ``TenantScopedModel`` so
   every read carries ``tenant_id`` + ``project_id`` (Rule 2).

``WorkflowRunRead`` and ``WorkflowStepResultRead`` cover the executor's
output surface.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import ConfigDict, Field

from app.db.models.workflow import WorkflowRunStatus, WorkflowStepStatus
from app.schemas.common import ForgeBaseModel, TenantScopedModel


# ---- Node data shapes --------------------------------------------------------

NodeType = Literal["trigger", "command", "approval", "script"]


class Position(ForgeBaseModel):
    """2D canvas position in pixels."""

    x: float
    y: float


class TriggerNodeData(ForgeBaseModel):
    type: Literal["trigger"] = "trigger"
    label: str = Field(default="Start", max_length=200)


class CommandNodeData(ForgeBaseModel):
    type: Literal["command"] = "command"
    command_name: str = Field(..., min_length=1, max_length=200)
    args: dict[str, Any] = Field(default_factory=dict)
    on_error: Literal["fail", "continue"] = "fail"


class ApprovalNodeData(ForgeBaseModel):
    type: Literal["approval"] = "approval"
    label: str = Field(..., min_length=1, max_length=200)
    approver_role: str | None = Field(default=None, max_length=64)
    timeout_hours: int = Field(default=24, ge=1, le=24 * 30)


class ScriptNodeData(ForgeBaseModel):
    type: Literal["script"] = "script"
    language: Literal["python", "javascript"] = "python"
    source: str = Field(..., min_length=1, max_length=64_000)


# Discriminated union — validated by `node.type` discriminator.
WorkflowNodeData = Annotated[
    TriggerNodeData | CommandNodeData | ApprovalNodeData | ScriptNodeData,
    Field(discriminator="type"),
]


class WorkflowNode(ForgeBaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    position: Position
    data: WorkflowNodeData


class WorkflowEdge(ForgeBaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    source: str = Field(..., min_length=1, max_length=64)
    target: str = Field(..., min_length=1, max_length=64)


class WorkflowSettings(ForgeBaseModel):
    cost_ceiling_usd: float | None = Field(default=None, ge=0)
    timeout_seconds: int | None = Field(default=None, ge=1, le=86_400)


class WorkflowDefinition(ForgeBaseModel):
    """JSONB payload the editor saves."""

    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    settings: WorkflowSettings = Field(default_factory=WorkflowSettings)


# ---- Envelopes ---------------------------------------------------------------

class WorkflowCreate(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2_000)
    definition: WorkflowDefinition


class WorkflowUpdate(ForgeBaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2_000)
    definition: WorkflowDefinition | None = None


class WorkflowRead(TenantScopedModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    name: str
    description: str | None
    definition: WorkflowDefinition
    created_by: UUID
    latest_run_id: UUID | None


# ---- Run envelopes -----------------------------------------------------------

class WorkflowStepResultRead(ForgeBaseModel):
    """One per-node result inside a run's ``state.stepResults``."""

    step_id: str
    status: WorkflowStepStatus
    output: dict[str, Any] | None = None
    approval_id: UUID | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    error: str | None = None


class WorkflowRunCreate(ForgeBaseModel):
    """Body for ``POST /workflows/{id}/runs`` — currently empty; reserved
    for future per-invocation overrides."""


class WorkflowRunRead(TenantScopedModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    workflow_id: UUID
    status: WorkflowRunStatus
    started_at: datetime | None
    finished_at: datetime | None
    triggered_by: UUID
    current_step_id: str | None
    state: dict[str, Any]
    error: str | None


__all__ = [
    "ApprovalNodeData",
    "CommandNodeData",
    "Position",
    "ScriptNodeData",
    "TriggerNodeData",
    "WorkflowCreate",
    "WorkflowDefinition",
    "WorkflowEdge",
    "WorkflowNode",
    "WorkflowNodeData",
    "WorkflowRead",
    "WorkflowRunCreate",
    "WorkflowRunRead",
    "WorkflowSettings",
    "WorkflowStepResultRead",
    "WorkflowUpdate",
]

"""Custom Workflows — user-authored DAGs (F-018 extension).

A :class:`Workflow` is a tenant-scoped, named DAG the user composed via
the editor. A :class:`WorkflowRun` is one execution of that DAG.

The ``definition`` JSONB column carries the editor's payload:

.. code-block:: json

    {
      "nodes": [
        {"id": "trig",   "type": "trigger",  "position": {"x": 0,   "y": 0}, "data": {}},
        {"id": "cmd-1", "type": "command", "position": {"x": 200, "y": 0},
          "data": {"commandName": "forge-dev-refactor", "args": {}}},
        {"id": "appr-1", "type": "approval", "position": {"x": 400, "y": 0},
          "data": {"label": "Security review", "approverRole": "security-lead"}},
        {"id": "scr-1", "type": "script", "position": {"x": 600, "y": 0},
          "data": {"language": "python", "source": "print('hi')"}}
      ],
      "edges": [
        {"id": "e1", "source": "trig",   "target": "cmd-1"},
        {"id": "e2", "source": "cmd-1",  "target": "appr-1"},
        {"id": "e3", "source": "appr-1", "target": "scr-1"}
      ],
      "settings": {"costCeilingUsd": 5.0, "timeoutSeconds": 300}
    }

The ``state`` JSONB on :class:`WorkflowRun` holds per-step results:

.. code-block:: json

    {
      "stepResults": {
      # noqa: E501
        "cmd-1": {"status": "succeeded", "output": {"ok": true},
          "startedAt": "...", "finishedAt": "...", "durationMs": 1234},
        "appr-1": {"status": "waiting_approval", "approvalId": "..."}
      }
    }

Rule 2 (multi-tenancy) — ``tenant_id`` / ``project_id`` are never optional.
Rule 4 (typed artifacts) — the run row itself is a typed artifact.
Rule 6 (auditability) — every transition emits a ``WORKFLOW_*`` event on the bus.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class WorkflowRunStatus(StrEnum):
    """Lifecycle of a single execution of a :class:`Workflow`."""

    PENDING = "pending"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class WorkflowStepStatus(StrEnum):
    """Lifecycle of an individual node within a run."""

    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"
    WAITING_APPROVAL = "waiting_approval"
    CANCELLED = "cancelled"


class Workflow(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A user-authored DAG definition.

    Soft-deletable (``deleted_at``); uniqueness on
    ``(tenant_id, project_id, name)`` is enforced only across live rows.
    """

    __tablename__ = "workflows"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="draft", default="draft"
    )
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    latest_run_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "project_id",
            "name",
            name="uq_workflows_tenant_project_name",
        ),
        Index("ix_workflows_tenant_project", "tenant_id", "project_id"),
        Index("ix_workflows_tenant_project_deleted", "tenant_id", "project_id", "deleted_at"),
    )


class WorkflowRun(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single execution instance of a :class:`Workflow`.

    ``state`` carries per-node results as a JSONB blob; ``current_step_id``
    is a small denormalization so the SSE stream can resume after reconnect
    without scanning state.
    """

    __tablename__ = "workflow_runs"

    workflow_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    status: Mapped[WorkflowRunStatus] = mapped_column(
        SAEnum(WorkflowRunStatus, name="workflow_run_status"),
        nullable=False,
        default=WorkflowRunStatus.PENDING,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    triggered_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    current_step_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_workflow_runs_tenant_project", "tenant_id", "project_id"),
        Index("ix_workflow_runs_workflow_status", "workflow_id", "status"),
        Index("ix_workflow_runs_status", "status"),
    )


__all__ = [
    "Workflow",
    "WorkflowRun",
    "WorkflowRunStatus",
    "WorkflowStepStatus",
]

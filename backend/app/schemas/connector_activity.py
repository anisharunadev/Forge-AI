"""Schemas for F-007 Connector Activity surface (M3 — Gap M3-G1).

The Activity tab in the Connector Center consumes a unified
:class:`ConnectorSyncEventRead` row covering installation, sync, webhook,
test, error, reveal and rotate events — in production these would each
have their own audit-log tables; for Step-55-v2 we aggregate them into
the single ``connector_activity`` table so the UI can render a uniform
timeline.

Wire shape is identical to the ORM model in
``app.db.models.connector_activity.ConnectorActivity`` so the read
endpoint can return ORM rows directly via ``model_validate``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from app.schemas.common import ForgeBaseModel


ConnectorActivityEventType = Literal[
    "sync",
    "webhook",
    "test",
    "install",
    "disconnect",
    "error",
    "reveal",
    "rotate",
]
"""Closed set of activity event categories the UI filters on."""

ConnectorActivityStatus = Literal[
    "success",
    "failed",
    "partial",
    "in_progress",
]
"""Closed set of activity outcome statuses."""


class ConnectorSyncEventRead(ForgeBaseModel):
    """One row in the Connector Center "Activity" feed.

    Mirrors :class:`app.db.models.connector_activity.ConnectorActivity`
    minus the ``project_id`` column (activity rows are tenant-scoped
    only — the Connector Center surface doesn't pivot on project).
    """

    id: UUID
    connector_id: UUID
    tenant_id: UUID
    event_type: ConnectorActivityEventType
    status: ConnectorActivityStatus
    started_at: datetime
    finished_at: datetime | None = None
    records_affected: int | None = None
    actor_id: UUID | None = None
    error_message: str | None = None
    metadata: dict[str, Any]


__all__ = [
    "ConnectorActivityEventType",
    "ConnectorActivityStatus",
    "ConnectorSyncEventRead",
]

"""Connectors — external system integrations (F-007)."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class ConnectorType(str, enum.Enum):
    """Closed set of supported connector kinds."""

    GITHUB = "github"
    JIRA = "jira"
    CONFLUENCE = "confluence"
    FIGMA = "figma"
    AWS = "aws"
    SLACK = "slack"
    SONARQUBE = "sonarqube"
    DATABRICKS = "databricks"
    AZURE_DEVOPS = "azure_devops"
    CLICKUP = "clickup"
    ZENDESK = "zendesk"
    SECRETS = "secrets"


class ConnectorStatus(str, enum.Enum):
    """Connector lifecycle — mirrors connector_states.ConnectorState."""

    PENDING = "pending"
    SYNCING = "syncing"
    HEALTHY = "healthy"
    STALE = "stale"
    QUARANTINED = "quarantined"
    FAILED = "failed"
    DISCONNECTED = "disconnected"


class SyncStatus(str, enum.Enum):
    """Outcome of a single sync attempt."""

    STARTED = "started"
    SUCCESS = "success"
    FAILURE = "failure"
    TIMEOUT = "timeout"


class Connector(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A configured integration with an external system.

    `config` holds type-specific credentials and connection settings
    (URLs, API keys, repo allow-lists). The DB column is JSONB so the
    shape varies per ConnectorType.
    """

    __tablename__ = "connectors"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[ConnectorType] = mapped_column(
        SAEnum(ConnectorType, name="connector_type"), nullable=False
    )
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[ConnectorStatus] = mapped_column(
        SAEnum(ConnectorStatus, name="connector_status"),
        nullable=False,
        default=ConnectorStatus.PENDING,
    )
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)

    __table_args__ = (
        Index("ix_connectors_tenant_project_type", "tenant_id", "project_id", "type"),
        Index("ix_connectors_tenant_status", "tenant_id", "status"),
    )


class ConnectorSyncHistory(Base, UUIDPrimaryKeyMixin):
    """Append-only log of connector sync attempts."""

    __tablename__ = "connector_sync_history"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    connector_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("connectors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[SyncStatus] = mapped_column(
        SAEnum(SyncStatus, name="sync_status"), nullable=False
    )
    items_synced: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_sync_history_connector_started", "connector_id", "started_at"),
    )


class ConnectorHealthHistory(Base, UUIDPrimaryKeyMixin):
    """Append-only log of connector health probe outcomes (step-55)."""

    __tablename__ = "connector_health_history"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    connector_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("connectors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    probed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_health_history_connector_probed", "connector_id", "probed_at"),
    )


__all__ = [
    "Connector",
    "ConnectorHealthHistory",
    "ConnectorStatus",
    "ConnectorSyncHistory",
    "ConnectorType",
    "SyncStatus",
]

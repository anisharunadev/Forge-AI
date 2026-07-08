"""Repo ingestion models (F-101, F-102).

A `Repo` is a pointer to a source-code repository attached to a project.
Each ingestion run produces a row in `IngestionRun` plus the persisted
artifacts in `IngestionArtifact` (repomix XML, GSD graphify output,
GSD map-codebase output, raw archive, etc).
"""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class IngestionStatus(enum.StrEnum):
    """Lifecycle of an ingestion run."""

    PENDING = "pending"
    CLONING = "cloning"
    EXTRACTING = "extracting"
    GRAPHIFYING = "graphifying"
    MAPPING = "mapping"
    PERSISTING = "persisting"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class IngestionArtifactType(enum.StrEnum):
    """Closed set of artifacts produced by an ingestion run."""

    REPO_TARBALL = "repo_tarball"
    REPOMIX_XML = "repomix_xml"
    GRAPHIFY_JSON = "graphify_json"
    MAP_CODEBASE_JSON = "map_codebase_json"
    KNOWLEDGE_GRAPH_SNAPSHOT = "knowledge_graph_snapshot"
    DEPENDENCY_GRAPH = "dependency_graph"
    SERVICE_CATALOG = "service_catalog"
    API_CATALOG = "api_catalog"
    DATABASE_MAP = "database_map"


class Repo(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A repo registered for ingestion in a project."""

    __tablename__ = "repos"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    source_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    default_branch: Mapped[str] = mapped_column(String(120), nullable=False, default="main")
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="github")
    last_ingested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ingestion_status: Mapped[IngestionStatus] = mapped_column(
        SAEnum(IngestionStatus, name="repo_ingestion_status"),
        nullable=False,
        default=IngestionStatus.PENDING,
    )
    ingestion_meta: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
    credentials_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)

    __table_args__ = (
        Index("ix_repos_tenant_project", "tenant_id", "project_id"),
        Index("ix_repos_tenant_status", "tenant_id", "ingestion_status"),
    )


class IngestionRun(Base, UUIDPrimaryKeyMixin):
    """A single attempt to ingest a repo end-to-end."""

    __tablename__ = "ingestion_runs"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    repo_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("repos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[IngestionStatus] = mapped_column(
        SAEnum(IngestionStatus, name="ingestion_run_status"),
        nullable=False,
        default=IngestionStatus.PENDING,
    )
    items_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifacts_produced: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    started_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    started_commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    finished_commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_ingestion_runs_tenant_project", "tenant_id", "project_id"),
        Index("ix_ingestion_runs_repo_started", "repo_id", "started_at"),
        Index("ix_ingestion_runs_status", "status"),
    )


class IngestionArtifact(Base, UUIDPrimaryKeyMixin):
    """An artifact persisted by an ingestion run (DL-027 append-only)."""

    __tablename__ = "ingestion_artifacts"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    ingestion_run_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("ingestion_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[IngestionArtifactType] = mapped_column(
        SAEnum(IngestionArtifactType, name="ingestion_artifact_type"), nullable=False
    )
    content_ref: Mapped[str] = mapped_column(String(1024), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_ingestion_artifacts_tenant_project", "tenant_id", "project_id"),
        Index("ix_ingestion_artifacts_run_type", "ingestion_run_id", "type"),
    )


__all__ = [
    "Repo",
    "IngestionRun",
    "IngestionArtifact",
    "IngestionStatus",
    "IngestionArtifactType",
]

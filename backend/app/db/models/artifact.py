"""Artifact — typed, append-only (Rule 4 + DL-027).

Artifacts are ADR, API Contract, Task Breakdown, Risk Register,
Security Report, Deployment Plan. They are NEVER updated or deleted.
New versions are inserted and the previous row's `superseded_by_id`
points at the new one.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Index, String, event
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin
from app.core.logging import get_logger

logger = get_logger(__name__)


class ArtifactStatus(str, Enum):
    """Lifecycle state of an artifact version."""

    DRAFT = "draft"
    ACTIVE = "active"
    SUPERSEDED = "superseded"
    ARCHIVED = "archived"


class Artifact(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Append-only typed artifact.

    `type` is a free-form string but the policy engine constrains the
    set: adr, api_contract, task_breakdown, risk_register,
    security_report, deployment_plan, plus plug-in custom types.
    """

    __tablename__ = "artifacts"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False, default=1)
    status: Mapped[ArtifactStatus] = mapped_column(
        SAEnum(ArtifactStatus, name="artifact_status"),
        nullable=False,
        default=ArtifactStatus.DRAFT,
    )
    created_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    superseded_by_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("artifacts.id"), nullable=True
    )
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_artifacts_tenant_project_type_status", "tenant_id", "project_id", "type", "status"),
        Index("ix_artifacts_tenant_type", "tenant_id", "type"),
    )


@event.listens_for(Artifact, "before_update", propagate=True)
@event.listens_for(Artifact, "before_delete", propagate=True)
def _reject_mutation(_mapper: Any, _connection: Any, _target: Any) -> None:  # type: ignore[no-untyped-def]
    """Application-level immutability; DB trigger is the second line."""
    logger.error("artifact.immutability_violation")
    raise RuntimeError(
        "Artifact is append-only; use ArtifactRegistry.supersede() (Rule 4 + DL-027)"
    )


__all__ = ["Artifact", "ArtifactStatus"]

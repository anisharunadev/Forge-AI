"""ApprovalRequest — human gate (Rule 3)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class ApprovalStatus(str, Enum):
    """Lifecycle of a request for human approval."""

    PENDING = "pending"
    GRANTED = "granted"
    DENIED = "denied"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ApprovalRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A gate that must be cleared before a workflow proceeds.

    Boundary types per Rule 3:
    - architecture: ADR promotion
    - security: Security Report sign-off
    - deployment: Deployment Plan execution
    """

    __tablename__ = "approval_requests"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_artifact_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("artifacts.id"), nullable=True
    )
    requested_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    status: Mapped[ApprovalStatus] = mapped_column(
        SAEnum(ApprovalStatus, name="approval_status"),
        nullable=False,
        default=ApprovalStatus.PENDING,
    )
    decided_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_approvals_tenant_project_status", "tenant_id", "project_id", "status"),
    )


__all__ = ["ApprovalRequest", "ApprovalStatus"]

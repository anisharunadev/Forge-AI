"""Conflict model — cross-source disagreement ledger (F-115 + ADR-003 demo).

A conflict arises when two sources disagree about the same fact
(e.g. Jira says launch is Q3, Confluence says Q2). ``Conflict`` records
the disagreement; resolution is governed by ADR-003 (hybrid MDM +
Steward-editable priority policy). The acme-corp demo seeds 3
intentional conflicts for the demo flow.
"""

from __future__ import annotations

from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    ARRAY,
    JSONB,
    Base,
    GUID,
    TenantScopedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class ConflictSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ConflictStatus(str, Enum):
    OPEN = "open"
    RESOLVED = "resolved"
    DEFERRED = "deferred"
    WONT_FIX = "wont_fix"


class Conflict(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """A disagreement between two or more sources of truth."""

    __tablename__ = "conflicts"

    conflict_key: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    severity: Mapped[ConflictSeverity] = mapped_column(
        SAEnum(ConflictSeverity, name="conflict_severity"),
        nullable=False,
        default=ConflictSeverity.MEDIUM,
    )
    status: Mapped[ConflictStatus] = mapped_column(
        SAEnum(ConflictStatus, name="conflict_status"),
        nullable=False,
        default=ConflictStatus.OPEN,
    )
    sources: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    resolution_path: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    resolved_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    resolved_at: Mapped["__import__('datetime').datetime | None"] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    related_node_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(GUID()), nullable=False, default=list
    )

    __table_args__ = (
        Index("uq_conflicts_tenant_key", "tenant_id", "conflict_key", unique=True),
        Index("ix_conflicts_tenant_status", "tenant_id", "status"),
        Index("ix_conflicts_tenant_severity", "tenant_id", "severity"),
    )


__all__ = [
    "Conflict",
    "ConflictSeverity",
    "ConflictStatus",
]
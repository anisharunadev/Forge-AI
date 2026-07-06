"""Standard — org-level or project-level codified conventions (F-001)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class Standard(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A coding or process standard.

    `project_id IS NULL` means the standard is organization-wide and
    inherits down to every project in the tenant.
    """

    __tablename__ = "standards"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    version: Mapped[int] = mapped_column(nullable=False, default=1)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )

    __table_args__ = (
        Index("ix_standards_tenant_project_status", "tenant_id", "project_id", "status"),
    )


__all__ = ["Standard"]

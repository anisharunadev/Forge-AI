"""Project model — the per-tenant project container.

Required by FK constraints in standards, templates, and steering_rules.
Multi-tenant by design: every project belongs to exactly one tenant.

The full project lifecycle service (CRUD endpoints, bootstrap, RBAC) is
served by the projects router. This module is the schema anchor.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    GUID,
    JSONB,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Project(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A Forge project inside a tenant.

    Carries tenant_id (Rule 2 — never optional) and project_id is the
    row's primary key, referenced by every TenantScopedMixin table.
    """

    __tablename__ = "projects"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_branch: Mapped[str] = mapped_column(String(128), nullable=False, default="main")
    visibility: Mapped[str] = mapped_column(String(32), nullable=False, default="private")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_by: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_projects_tenant_slug"),
        Index("ix_projects_tenant_status", "tenant_id", "status"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Project id={self.id} slug={self.slug!r}>"


__all__ = ["Project"]

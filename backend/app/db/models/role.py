"""Role — RBAC binding (F-004)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import ARRAY, Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class Role(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A named bundle of permissions.

    `permissions` is a JSON list of `<resource>:<action>` strings
    (e.g. `artifact:create`, `connector:reset`). The RBAC service
    expands role hierarchies at evaluation time.
    """

    __tablename__ = "roles"

    tenant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    permissions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    parent_role_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("roles.id"), nullable=True
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_roles_tenant_name"),
        Index("ix_roles_tenant", "tenant_id"),
    )


__all__ = ["Role"]

"""User model — Keycloak-managed, mirrored into Forge for joins."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import ARRAY, GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Mirror of the Keycloak user.

    Forge never creates credentials locally; users are created on first
    login via OIDC. `role_ids` is a denormalized list of role UUIDs that
    the RBAC service joins against the `roles` table.
    """

    __tablename__ = "users"

    tenant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    keycloak_sub: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    role_ids: Mapped[list[UUID]] = mapped_column(ARRAY(GUID()), nullable=False, default=list)
    profile: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        # Unique email within a tenant.
        {"extend_existing": True},
    )


__all__ = ["User"]

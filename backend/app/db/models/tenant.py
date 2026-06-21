"""Tenant model — the root of every multi-tenant query."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class Tenant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A Forge tenant (organization).

    `slug` is the URL-safe identifier used in JWT `forge.tenant` claims.
    `settings` holds per-tenant feature flags and limits; default empty
    dict at the application layer.
    """

    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    def __repr__(self) -> str:  # pragma: no cover — trivial
        return f"<Tenant id={self.id} slug={self.slug!r}>"


__all__ = ["Tenant", "UUID"]

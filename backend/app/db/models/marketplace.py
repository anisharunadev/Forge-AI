"""Connector Marketplace — catalog of installable connectors (F-015)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class MarketplaceConnector(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Catalog entry for a connector that tenants can install.

    `slug` is the URL-safe unique identifier tenants reference when
    installing. `config_schema` is a JSON Schema describing the
    per-tenant configuration the installer must supply.
    """

    __tablename__ = "marketplace_connectors"

    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    config_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    icon: Mapped[str | None] = mapped_column(String(500), nullable=True)
    version: Mapped[str] = mapped_column(String(64), nullable=False, default="1.0.0")
    author: Mapped[str] = mapped_column(String(200), nullable=False, default="forge")
    downloads: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rating: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    __table_args__ = (
        Index("ix_marketplace_type", "type"),
    )


    _audit_skip = ("catalog", "Vendor catalog (marketplace). Read-only.")

__all__ = ["MarketplaceConnector"]

"""Tool bundles — reusable tool groupings for governance (F-507).

A tool bundle is a named, versioned set of tool permissions that can
be granted to an agent or role. The kn-base reference seed provides 6
bundles (architecture-readonly, development-write, security-scan,
deployment-prod-gated, ideation-propose, refactor-execute).
"""

from __future__ import annotations

from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, UniqueConstraint
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


class ToolBundleTier(str, Enum):
    READ_ONLY = "read_only"
    PROPOSE = "propose"
    WRITE = "write"
    EXECUTE = "execute"
    GATED = "gated"


class ToolBundle(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """A named, versioned set of tool permissions."""

    __tablename__ = "tool_bundles"

    bundle_key: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    tier: Mapped[ToolBundleTier] = mapped_column(
        SAEnum(ToolBundleTier, name="tool_bundle_tier"),
        nullable=False,
        default=ToolBundleTier.READ_ONLY,
    )
    tools: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)

    __table_args__ = (
        UniqueConstraint("tenant_id", "bundle_key", name="uq_tool_bundles_tenant_key"),
        Index("ix_tool_bundles_tenant_tier", "tenant_id", "tier"),
    )


__all__ = [
    "ToolBundle",
    "ToolBundleTier",
]
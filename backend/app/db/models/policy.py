"""Policy — JSONLogic/CEL expression bound to a tenant (F-003, DL-027)."""

from __future__ import annotations

from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, Index, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class PolicySeverity(str, Enum):
    """Severity drives notification + auto-block behavior."""

    INFO = "info"
    WARN = "warn"
    BLOCK = "block"


class Policy(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A versioned policy expression.

    `expression` is JSONLogic or CEL (serialized as JSON). The policy
    engine compiles once and caches in-memory until the row is updated.
    """

    __tablename__ = "policies"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    expression: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    severity: Mapped[PolicySeverity] = mapped_column(
        SAEnum(PolicySeverity, name="policy_severity"),
        nullable=False,
        default=PolicySeverity.WARN,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (Index("ix_policies_tenant_enabled", "tenant_id", "enabled"),)


__all__ = ["Policy", "PolicySeverity"]

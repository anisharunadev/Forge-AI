"""F12 RBAC — Organization (the policy boundary under a Tenant).

Phase 3 Feature 12. An org is the policy/white-label boundary that
groups teams and (optionally) customers under one Tenant. The Tenant
remains the billing boundary; the org is the policy boundary.

Hierarchy: Tenant → Organization → Team → Project.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    GUID,
    JSONB,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Organization(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A policy/white-label boundary under a Tenant.

    `brand` holds white-label assets (logo URL, primary color, etc.).
    `billing_ref` is an optional external billing id (Stripe customer,
    etc.) so the parent Tenant can roll up org-level spend.
    """

    __tablename__ = "organizations"

    tenant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    billing_ref: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    __table_args__ = (Index("ix_organizations_tenant", "tenant_id"),)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Organization id={self.id} name={self.name!r}>"

    _audit_scope = "tenant-only"


__all__ = ["Organization"]

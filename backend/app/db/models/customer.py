"""F12 RBAC — Customer (white-label sub-account under an Organization).

Phase 3 Feature 12 §"Customer accounts (white-label)". A customer is a
sub-org with its own users/teams/budgets. Customer spend rolls up to
the parent org for billing. Customer users cannot see other customers'
data (enforced by tenant_id + org_id scoping in queries).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    GUID,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Customer(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A white-label customer account under an Organization.

    `blocked` is the customer-level emergency stop (separate from the
    team-level one). `billing_ref` is the external billing id used by
    the parent org's billing rollup.
    """

    __tablename__ = "customers"

    tenant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    billing_ref: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    __table_args__ = (Index("ix_customers_tenant_org", "tenant_id", "org_id"),)


__all__ = ["Customer"]

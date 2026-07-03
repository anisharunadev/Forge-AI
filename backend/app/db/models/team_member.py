"""F12 RBAC — TeamMember (User ↔ Team ↔ Role binding).

Phase 3 Feature 12. The `role` column is a string constrained by the
RBAC role enum (super_admin / org_admin / team_admin / project_admin /
member / viewer / customer_admin) defined in
``app.schemas.rbac_v2.RoleEnum``. We store the role name directly
(not a FK to ``roles.id``) so role inheritance is a code-level
concern in ``rbac_v2_service.py`` rather than a JOIN in every query.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    Base,
    GUID,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class TeamMember(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A user assigned to a team with a specific role.

    Composite unique on (team_id, user_id) — a user belongs to a given
    team at most once. Status drives the active/pending lifecycle.
    """

    __tablename__ = "team_members"

    tenant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    team_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")

    __table_args__ = (
        Index(
            "ix_team_members_team_user",
            "team_id",
            "user_id",
            unique=True,
        ),
        Index("ix_team_members_tenant", "tenant_id"),
    )


__all__ = ["TeamMember"]

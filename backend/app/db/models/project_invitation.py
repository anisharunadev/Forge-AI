"""ProjectInvitation — pending email invite to a project.

Used by Settings → Members tab "Invite member" flow. Carries a one-time
token that the invitee can present to /accept-invite (out of scope for
step-62 — accepted invitations convert into ProjectMember rows).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    Base,
    GUID,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class ProjectInvitation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A pending invitation to join a project.

    `token` is a one-time use bearer secret. `expires_at` defaults to
    7 days from creation at the call site.
    """

    __tablename__ = "project_invitations"

    project_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("roles.id"), nullable=False
    )
    invited_by: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    token: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index("ix_project_invitations_email", "email"),
        Index("ix_project_invitations_status", "status"),
        Index("ix_project_invitations_project_status", "project_id", "status"),
    )


    _audit_scope = "project-only"

__all__ = ["ProjectInvitation"]

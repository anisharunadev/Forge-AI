"""ProjectMember — RBAC binding of a user to a project + role.

Used by Settings → Members tab. Lives between User, Project, and Role.
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


class ProjectMember(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A user assigned to a project with a specific role.

    Composite unique index on (project_id, user_id) — a user belongs to
    a given project at most once. Status drives the active/pending
    lifecycle; "removed" soft-deletes are flagged rather than deleted.
    """

    __tablename__ = "project_members"

    project_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("roles.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)

    __table_args__ = (
        Index(
            "ix_project_members_project_user",
            "project_id",
            "user_id",
            unique=True,
        ),
        Index("ix_project_members_status", "status"),
    )


__all__ = ["ProjectMember"]

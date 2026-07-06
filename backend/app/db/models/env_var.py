"""EnvVar — per-project environment variables (encrypted at rest).

Settings → Env Vars tab. Values are Fernet-encrypted before insert and
never returned in list responses (the /reveal endpoint decrypts on
demand and writes an audit row).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    GUID,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class EnvVar(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "env_vars"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    encrypted_value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope: Mapped[str] = mapped_column(String(32), default="runtime", nullable=False)
    visibility: Mapped[str] = mapped_column(String(32), default="secret", nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_by: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), nullable=False)

    __table_args__ = (
        Index("ix_env_vars_tenant_project", "tenant_id", "project_id"),
        Index("ix_env_vars_project_key", "project_id", "key", unique=True),
        Index("ix_env_vars_tenant", "tenant_id"),
    )


__all__ = ["EnvVar"]

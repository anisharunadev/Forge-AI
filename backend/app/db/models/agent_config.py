"""AgentConfig — per-project overrides for an Agent.

Settings → Agents tab. Patches a project-local default model + tool list
on top of the org-level Agent registration.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    Base,
    GUID,
    JSONB,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class AgentConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "agent_configs"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    agent_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    default_model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    temperature: Mapped[float] = mapped_column(Float, default=0.7, nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096, nullable=False)
    allowed_tools: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index(
            "ix_agent_configs_project_agent",
            "project_id",
            "agent_id",
            unique=True,
        ),
    )


__all__ = ["AgentConfig"]

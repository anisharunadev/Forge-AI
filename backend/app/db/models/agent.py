"""Agent Registry — registered agent profiles (F-011)."""

from __future__ import annotations

import enum
from typing import Any
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class AgentType(enum.StrEnum):
    """The set of supported agent runtimes."""

    CLAUDE_CODE = "claude_code"
    CODEX = "codex"
    GEMINI = "gemini"
    CUSTOM = "custom"


class AgentStatus(enum.StrEnum):
    """Registration state of an agent profile."""

    ENABLED = "enabled"
    DISABLED = "disabled"
    DEPRECATED = "deprecated"


class Agent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A registered agent profile.

    `capabilities` declares what tasks this agent can handle
    (e.g. {"languages": ["python", "typescript"], "tools": ["shell", "browser"]}).
    `project_id IS NULL` means the registration is org-level and
    available to every project in the tenant.
    """

    __tablename__ = "agents"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[AgentType] = mapped_column(SAEnum(AgentType, name="agent_type"), nullable=False)
    capabilities: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[AgentStatus] = mapped_column(
        SAEnum(AgentStatus, name="agent_status"),
        nullable=False,
        default=AgentStatus.ENABLED,
    )
    version: Mapped[str] = mapped_column(String(64), nullable=False, default="1.0.0")

    __table_args__ = (
        Index("ix_agents_tenant_project_status", "tenant_id", "project_id", "status"),
        Index("ix_agents_tenant_type", "tenant_id", "type"),
    )


__all__ = ["Agent", "AgentStatus", "AgentType"]

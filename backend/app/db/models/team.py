"""F12 RBAC — Team (the execution boundary under an Organization).

Phase 3 Feature 12. A team owns a model allowlist, default agent
config, and the set of projects that the team can operate on. Teams
can be `blocked` to emergency-stop all of their virtual keys.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    Base,
    GUID,
    JSONB,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Team(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A team inside an Organization.

    `model_allowlist` is a JSON list of model names the team may use
    (enforced in the chat path). `default_agent_config` is the JSON
    default that the agent factory applies for new agents in this
    team. `blocked` is the emergency-stop switch — set to True by
    `team/block` and unset by `team/unblock` (step-78 F12 §"Spec").
    """

    __tablename__ = "teams"

    tenant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model_allowlist: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    default_agent_config: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict
    )
    blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_teams_tenant_org", "tenant_id", "org_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Team id={self.id} name={self.name!r} blocked={self.blocked}>"


__all__ = ["Team"]

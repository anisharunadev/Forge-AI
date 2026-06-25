"""F-829a — 1:1 Forge tenant ↔ LiteLLM Team mapping.

Persists the LiteLLM Team id assigned to a Forge tenant. Created when
a Forge tenant is provisioned; archived (set status='archived') when
the tenant is archived. The actual LiteLLM Team is also deleted via
:mod:`app.integrations.litellm.tenant_sync` on archive per OQ-30.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class LiteLLMTeamStatus(str, Enum):
    """Lifecycle of a tenant's LiteLLM Team mapping.

    ACTIVE: team exists in LiteLLM; sync is up to date.
    SYNCING: a sync operation is in flight.
    DRIFTED: a reconcile pass found divergence from LiteLLM.
    ARCHIVED: tenant was archived; team was deleted in LiteLLM.
    """

    ACTIVE = "active"
    SYNCING = "syncing"
    DRIFTED = "drifted"
    ARCHIVED = "archived"


class LiteLLMTeamMapping(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One row per Forge tenant. Holds the LiteLLM Team id.

    `litellm_team_id` is the integer/string id returned by the
    LiteLLM ``/team/new`` endpoint. The mapping is created on tenant
    provisioning and archived (status=ARCHIVED) when the tenant is
    archived. The spend logs in LiteLLM are preserved (OQ-30).
    """

    __tablename__ = "litellm_team_mappings"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    litellm_team_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    status: Mapped[LiteLLMTeamStatus] = mapped_column(
        String(32),
        nullable=False,
        default=LiteLLMTeamStatus.ACTIVE.value,
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )

    __table_args__ = (
        Index(
            "ix_litellm_team_mappings_tenant_project",
            "tenant_id",
            "project_id",
        ),
    )


__all__ = ["LiteLLMTeamMapping", "LiteLLMTeamStatus"]

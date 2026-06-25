"""F-829g — Per-tenant model assignment.

Maps a (tenant, model_kind) pair to a concrete model name string that
LiteLLM can dispatch. ``model_kind`` is a Forge-side abstraction
(e.g. ``"fast"``, ``"standard"``, ``"premium"``, ``"embedding"``) so
that the Steward can rebind which underlying model each tier uses
without code changes (Rule 8).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class LiteLLMModelAssignment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One row per (tenant_id, model_kind).

    `model_name` is the concrete model string LiteLLM proxies (e.g.
    ``"gpt-4o-mini"``). The `tier` column captures the Forge-side
    abstraction. `max_input_tokens` / `max_output_tokens` are advisory
    limits surfaced to the UI; LiteLLM enforces the real caps.
    """

    __tablename__ = "litellm_model_assignments"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    tier: Mapped[str] = mapped_column(String(64), nullable=False)
    model_name: Mapped[str] = mapped_column(String(256), nullable=False)
    max_input_tokens: Mapped[int | None] = mapped_column(default=None, nullable=True)
    max_output_tokens: Mapped[int | None] = mapped_column(default=None, nullable=True)
    enabled: Mapped[bool] = mapped_column(default=True, nullable=False)
    metadata_: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "tier",
            name="uq_litellm_model_assignments_tenant_tier",
        ),
        Index(
            "ix_litellm_model_assignments_tenant_project",
            "tenant_id",
            "project_id",
        ),
    )


__all__ = ["LiteLLMModelAssignment"]

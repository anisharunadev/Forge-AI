"""step-78 F11 — Prompt + PromptVersion models.

A ``Prompt`` is the logical template (the "library entry"). Each
``PromptVersion`` is an immutable snapshot of the template at a point
in time. Updating a prompt creates a new ``PromptVersion``; the old
one is retained and remains renderable for anyone pinned to it.

The split keeps the spec contract (versions are immutable once active;
up to 100 versions per prompt; older auto-archived) enforceable in a
single join query.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    Base,
    GUID,
    JSONB,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Prompt(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A versioned prompt library entry.

    ``current_version`` tracks the latest *active* version number (1-based
    integer). ``status`` is denormalised from the current version so
    list views don't have to JOIN.
    """

    __tablename__ = "prompts"

    tenant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="custom")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
    created_by: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_prompts_tenant_name"),
        Index("ix_prompts_tenant_status", "tenant_id", "status"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Prompt id={self.id} name={self.name!r} v{self.current_version}>"


class PromptVersion(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One immutable snapshot of a Prompt template.

    Versions are append-only. An update is a new row with
    ``version_number = old.version_number + 1``. The ``status`` column
    is ``active`` for the current version, ``archived`` for retired
    ones, and ``draft`` for an in-progress save that hasn't been
    activated yet (ponytail: not exposed in v1, kept for future).
    """

    __tablename__ = "prompt_versions"

    tenant_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    template: Mapped[str] = mapped_column(Text, nullable=False)
    model_defaults: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    variables: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    created_by: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "prompt_id", "version_number", name="uq_prompt_versions_prompt_version"
        ),
        Index(
            "ix_prompt_versions_prompt_status",
            "prompt_id",
            "status",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PromptVersion prompt={self.prompt_id} v{self.version_number} status={self.status}>"


__all__ = ["Prompt", "PromptVersion"]
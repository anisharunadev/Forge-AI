"""Phase 3 persona memory ORM model.

Append-only log of every persona memory edit. The nightly
``memory_consolidate`` job rolls rows from the past 24h into the
stable per-tenant file under
``tenants/<slug>/workspace/memory/personas/<persona>/<key>.md``.

Persona memory is **tenant-scoped only** (no project_id) — it's
Organization Knowledge shared across all projects in a tenant for
users with the same persona (Rule 5). The closed set of supported
``persona`` and ``key`` values is enforced at the application layer;
new values land by editing ``PERSONA_KEYS``.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin

# Closed-set of persona identifiers (mirrors the persona primer
# Markdown files under ``steering/personas/``).
PERSONA_NAMES: tuple[str, ...] = (
    "developer",
    "product_manager",
    "architect",
    "qa",
    "devops",
    "security",
)


# Closed-set of memory key identifiers per persona.
PERSONA_KEYS: tuple[str, ...] = (
    "coding",
    "architecture",
    "security",
    "ideation",
    "qa",
    "devops",
)


class PersonaMemoryHistory(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One row per persona-memory edit. Append-only.

    The ``consolidated`` flag flips to ``True`` when the nightly
    ``memory_consolidate`` job rolls this row into the stable file.
    The row stays in the log; it just won't be merged again.
    """

    __tablename__ = "persona_memory_history"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    persona: Mapped[str] = mapped_column(String(64), nullable=False)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    entry_md: Mapped[str] = mapped_column(Text, nullable=False)
    written_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    written_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consolidated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index(
            "ix_persona_memory_history_tenant_persona_key",
            "tenant_id",
            "persona",
            "key",
        ),
        Index(
            "ix_persona_memory_history_tenant_written_at",
            "tenant_id",
            "written_at",
        ),
    )


__all__ = [
    "PersonaMemoryHistory",
    "PERSONA_NAMES",
    "PERSONA_KEYS",
]

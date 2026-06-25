"""Project model — the per-tenant project container.

Required by FK constraints in standards, templates, and steering_rules.
Multi-tenant by design: every project belongs to exactly one tenant.

Note: created during Plan 0 (alembic bootstrap) to satisfy FK targets
that already existed in the partial migration set. The full project
lifecycle service (CRUD endpoints, bootstrap, RBAC) is added in
Phase 2 (Pilot Cutover Hardening) — this is the schema anchor only.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    Base,
    JSONB,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Project(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A Forge project inside a tenant.

    Carries tenant_id (Rule 2 — never optional) and project_id is the
    row's primary key, referenced by every TenantScopedMixin table.
    """

    __tablename__ = "projects"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Project id={self.id} slug={self.slug!r}>"


__all__ = ["Project"]
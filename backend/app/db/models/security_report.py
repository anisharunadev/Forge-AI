"""M5 Architecture Center (T-A3) — SecurityReport model.

Captures deployment-relevant security findings linked to an ADR:
auth, data, network, dependency, configuration, cryptography, and
logging categories. Severity drives the post-card on the Security
Report UI tab; status captures the lifecycle (open → mitigating →
closed). ``source_adr_id`` is a nullable FK to ``architecture_adrs`` so
findings can be cross-referenced; an open finding is allowed to
precede the ADR that resolves it (the FK is nullable on purpose).

M5-G3 — closes the "no SecurityReport model" gap (spec \u00a72.2).
The model's source-of-truth rows land in the ``architecture_security_reports``
table (created by the migration at alembic/versions/step_90_m5_security_report.py).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    GUID,
    Base,
    TenantScopedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)

# Closed sets — pydantic Literal + SQLAlchemy String(16) with a CHECK
# constraint via raw enum normalization in the service layer. Keeping
# them as constants instead of PG enums keeps the test SQLite path
# happy and is portable across migrations.
SEVERITY_LEVELS = ("low", "medium", "high", "critical")
CATEGORY_VALUES = (
    "auth",
    "data",
    "network",
    "dependency",
    "configuration",
    "cryptography",
    "logging",
)
STATUS_VALUES = ("open", "mitigating", "accepted", "closed")


class SecurityReport(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """A deployment-relevant security finding, anchored to an ADR when known."""

    __tablename__ = "architecture_security_reports"

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    affected_service: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    recommendation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    source_adr_id: Mapped[UUID | None] = mapped_column(
        GUID(),
        ForeignKey("architecture_adrs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    discovered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    mitigated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    generated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index(
            "ix_architecture_security_reports_tenant_project_status",
            "tenant_id",
            "project_id",
            "status",
        ),
        Index(
            "ix_architecture_security_reports_severity_category",
            "tenant_id",
            "project_id",
            "severity",
            "category",
        ),
    )


__all__ = [
    "CATEGORY_VALUES",
    "SEVERITY_LEVELS",
    "SecurityReport",
    "STATUS_VALUES",
]

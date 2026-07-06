"""Seed bookkeeping ORM (F-821 — Seed Migration Framework).

Two tables back the seed runner:

- ``seed_runs``: one row per apply / reset / rollback / status / diff
  invocation. Carries the result, the manifest version, the checksum
  before/after, row counts, and a structured error payload. Used for
  audit and drift detection.

- ``seed_migrations``: one row per ``version`` of a seed that has been
  successfully applied. Analogous to ``alembic_version`` but for data.

Both tables are deliberately NOT ``TenantScopedMixin`` — they are
operational metadata that Stewards need to read across tenants. The
runner always writes a tenant_id where available (after a successful
apply) but the row itself is allowed to outlive a tenant for forensic
purposes.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    ARRAY,
    GUID,
    JSONB,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class SeedOperation(str, Enum):
    """Lifecycle operations the runner can perform."""

    APPLY = "apply"
    RESET = "reset"
    ROLLBACK = "rollback"
    STATUS = "status"
    DIFF = "diff"


class SeedRunStatus(str, Enum):
    """Outcome state for a seed run."""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"
    DRIFT_DETECTED = "drift_detected"


class SeedTenantType(str, Enum):
    """The spec's three tenant types (manifest.tenant_type)."""

    DEMO = "demo"
    REFERENCE = "reference"
    CUSTOMER_SEED = "customer_seed"


class SeedRun(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One seed runner invocation (apply, reset, rollback, status, diff)."""

    __tablename__ = "seed_runs"

    seed_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    manifest_version: Mapped[int] = mapped_column(Integer, nullable=False)
    operation: Mapped[SeedOperation] = mapped_column(
        SAEnum(SeedOperation, name="seed_operation"),
        nullable=False,
    )
    status: Mapped[SeedRunStatus] = mapped_column(
        SAEnum(SeedRunStatus, name="seed_run_status"),
        nullable=False,
        default=SeedRunStatus.RUNNING,
    )
    env: Mapped[str] = mapped_column(String(20), nullable=False)
    triggered_by: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    tenant_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True
    )
    project_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    applied_versions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    row_counts: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    dropped_rows: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    checksum_before: Mapped[str | None] = mapped_column(String(64), nullable=True)
    checksum_after: Mapped[str | None] = mapped_column(String(64), nullable=True)
    drift_summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (
        Index("ix_seed_runs_seed_name_started", "seed_name", "started_at"),
        Index("ix_seed_runs_status", "status"),
        Index("ix_seed_runs_actor", "actor_id"),
        Index("ix_seed_runs_env_status", "env", "status"),
    )


class SeedMigration(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One successfully applied seed version.

    Distinct from :class:`SeedRun` — this is the durable "what is
    currently applied" record used by drift detection and the
    ``status`` query. A ``SeedRun`` is an event log; a
    ``SeedMigration`` is the resulting state.
    """

    __tablename__ = "seed_migrations"

    version: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    seed_name: Mapped[str] = mapped_column(String(100), nullable=False)
    manifest_version: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    applied_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    row_counts: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_seed_migrations_seed_name_applied", "seed_name", "applied_at"),)


__all__ = [
    "SeedMigration",
    "SeedOperation",
    "SeedRun",
    "SeedRunStatus",
    "SeedTenantType",
]

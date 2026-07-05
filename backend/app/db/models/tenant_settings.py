"""Per-tenant observability settings (Phase 5).

Single row per tenant. Cached in Redis (TTL 30s) by
``app.core.tenant_sampler.TenantSettingsCache`` so the OTel sampler
can make a per-tenant sampling decision on every span without hitting
the DB.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TenantSettings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tenant_settings"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    sampling_rate: Mapped[float] = mapped_column(
        Float, default=1.0, nullable=False, server_default="1.0"
    )
    log_quota_per_hour: Mapped[int] = mapped_column(
        Integer, default=100_000, nullable=False, server_default="100000"
    )
    debug_force_sample: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

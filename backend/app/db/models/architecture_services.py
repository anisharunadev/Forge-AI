"""Architecture-domain services, API catalog, database map (F-301/F-302).

Three tables that complete the architecture accelerator alongside
``architecture_adrs``, ``architecture_api_contracts``, and
``architecture_risk_registers``:

- ``Service``: a logical service (e.g. svc-billing) with ownership.
- ``ApiCatalogEntry``: a single API surface exposed by a service.
- ``DatabaseMapEntry``: a single database instance managed by a
  service or platform team.

The acme-corp demo seeds 12 services, 24 APIs, 8 databases.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    ARRAY,
    GUID,
    JSONB,
    Base,
    TenantScopedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class ServiceLifecycle(StrEnum):
    PLANNED = "planned"
    DEVELOPMENT = "development"
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    SUNSET = "sunset"


class ApiSurface(StrEnum):
    REST = "rest"
    GRAPHQL = "graphql"
    GRPC = "grpc"
    EVENT = "event"
    INTERNAL = "internal"


class DatabaseEngine(StrEnum):
    POSTGRES = "postgres"
    REDIS = "redis"
    MONGODB = "mongodb"
    DYNAMODB = "dynamodb"
    SNOWFLAKE = "snowflake"
    BIGQUERY = "bigquery"


class Service(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """A logical service owned by a team."""

    __tablename__ = "services"

    service_key: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_team: Mapped[str] = mapped_column(String(120), nullable=False)
    repository_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("repos.id", ondelete="SET NULL"), nullable=True
    )
    lifecycle: Mapped[ServiceLifecycle] = mapped_column(
        SAEnum(ServiceLifecycle, name="service_lifecycle"),
        nullable=False,
        default=ServiceLifecycle.ACTIVE,
    )
    tier: Mapped[str] = mapped_column(String(16), nullable=False, default="tier-3")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("uq_services_tenant_key", "tenant_id", "service_key", unique=True),
        Index("ix_services_tenant_owner", "tenant_id", "owner_team"),
        Index("ix_services_tenant_lifecycle", "tenant_id", "lifecycle"),
    )


class ApiCatalogEntry(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """A single API surface exposed by a service."""

    __tablename__ = "api_catalog"

    api_key: Mapped[str] = mapped_column(String(200), nullable=False)
    service_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("services.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    surface: Mapped[ApiSurface] = mapped_column(
        SAEnum(ApiSurface, name="api_surface"), nullable=False
    )
    path: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    method: Mapped[str] = mapped_column(String(10), nullable=False, default="GET")
    version: Mapped[str] = mapped_column(String(32), nullable=False, default="v1")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    contract_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("architecture_api_contracts.id", ondelete="SET NULL"), nullable=True
    )
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("uq_api_catalog_tenant_key", "tenant_id", "api_key", unique=True),
        Index("ix_api_catalog_tenant_service", "tenant_id", "service_id"),
    )


class DatabaseMapEntry(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """A database instance managed by a service or platform team."""

    __tablename__ = "database_map"

    db_key: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    engine: Mapped[DatabaseEngine] = mapped_column(
        SAEnum(DatabaseEngine, name="database_engine"), nullable=False
    )
    version: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    owning_service_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("services.id", ondelete="SET NULL"), nullable=True
    )
    region: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    instance_class: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    storage_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pii: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("uq_database_map_tenant_key", "tenant_id", "db_key", unique=True),
        Index("ix_database_map_tenant_engine", "tenant_id", "engine"),
    )


__all__ = [
    "ApiCatalogEntry",
    "ApiSurface",
    "DatabaseEngine",
    "DatabaseMapEntry",
    "Service",
    "ServiceLifecycle",
]

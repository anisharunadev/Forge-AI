"""step-80 — Phase 4 DB models (single file for compactness).

13 tenant-scoped tables for Phase 4 (cache, sessions, identity, credentials,
finops). Each carries ``tenant_id + project_id`` + composite index. RLS is
applied in the alembic migration (not via SQLAlchemy event hooks, to match
the project's existing pattern of declaring RLS in DDL).

ponytail: one file, 13 tables. Split by domain when any table grows past
~80 lines or when a domain's tests need a focused fixture.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    GUID,
    JSONB,
    Base,
    TenantScopedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)

# ── F19 Cache ─────────────────────────────────────────────────────────


class Phase4CacheKey(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "phase4_cache_keys"
    __table_args__ = (
        Index("ix_phase4_cache_keys_tenant_project", "tenant_id", "project_id"),
        Index("ix_phase4_cache_keys_expires_at", "expires_at"),
        CheckConstraint(
            "cache_type IN ('exact','semantic','prefix','tool_result')",
            name="cache_type",
        ),
    )

    key_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    cache_type: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_hit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ttl_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=3600)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# ── F17 Sessions / A2A / Realtime ─────────────────────────────────────


class Phase4Session(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    __tablename__ = "phase4_sessions"
    __table_args__ = (
        Index("ix_phase4_sessions_tenant_project", "tenant_id", "project_id"),
        Index("ix_phase4_sessions_status", "status"),
        Index("ix_phase4_sessions_expires_at", "expires_at"),
        CheckConstraint(
            "session_type IN ('realtime','a2a','background','eval','interaction','assistant','thread')",
            name="session_type",
        ),
        CheckConstraint(
            "status IN ('active','disconnected','cancelled','expired')",
            name="status",
        ),
    )

    session_type: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_user_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    max_duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=14400)
    session_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )


class Phase4SessionEvent(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    __tablename__ = "phase4_session_events"
    __table_args__ = (
        Index("ix_phase4_session_events_session", "session_id"),
        Index("ix_phase4_session_events_tenant_project", "tenant_id", "project_id"),
    )

    session_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("phase4_sessions.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Phase4RealtimeClientSecret(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    __tablename__ = "phase4_realtime_client_secrets"
    __table_args__ = (
        Index("ix_phase4_realtime_client_secrets_tenant_project", "tenant_id", "project_id"),
        Index("ix_phase4_realtime_client_secrets_session", "session_id"),
        Index("ix_phase4_realtime_client_secrets_expires", "expires_at"),
    )

    session_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    secret_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Phase4A2ADelegation(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "phase4_a2a_delegations"
    __table_args__ = (Index("ix_phase4_a2a_delegations_tenant_project", "tenant_id", "project_id"),)

    from_agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    to_agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    jwt_jti: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


# ── F18 Identity ──────────────────────────────────────────────────────


class Phase4SsoConfig(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "phase4_sso_configs"
    __table_args__ = (UniqueConstraint("tenant_id", name="tenant_id"),)

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, unique=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    issuer_url: Mapped[str] = mapped_column(Text, nullable=False)
    client_id: Mapped[str] = mapped_column(Text, nullable=False)
    client_secret_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    claim_mapping: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    scopes: Mapped[list[str] | None] = mapped_column(PG_ARRAY(Text), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Phase4ScimToken(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "phase4_scim_tokens"
    __table_args__ = (
        Index("ix_phase4_scim_tokens_tenant", "tenant_id"),
        Index("ix_phase4_scim_tokens_expires", "expires_at"),
    )

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Phase4OAuthClient(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "phase4_oauth_clients"
    __table_args__ = (UniqueConstraint("client_id", name="client_id"),)

    client_id: Mapped[str] = mapped_column(String(128), nullable=False)
    client_secret_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(PG_ARRAY(Text), nullable=False, default=list)
    scopes: Mapped[list[str]] = mapped_column(PG_ARRAY(Text), nullable=False, default=list)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Phase4JwtSigningKey(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "phase4_jwt_signing_keys"
    __table_args__ = (
        Index("ix_phase4_jwt_signing_keys_status", "status"),
        CheckConstraint("status IN ('active','retired')", name="status"),
    )

    kid: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    algorithm: Mapped[str] = mapped_column(String(16), nullable=False, default="RS256")
    public_jwk: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    private_pem_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ── F20 Credentials / Vault / FinOps ──────────────────────────────────
    _audit_scope = "global"


class Phase4Credential(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "phase4_credentials"
    __table_args__ = (
        Index("ix_phase4_credentials_tenant_project", "tenant_id", "project_id"),
        UniqueConstraint("tenant_id", "credential_name", name="tenant_id"),
    )

    credential_name: Mapped[str] = mapped_column(String(128), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    vault_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_vault_backed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Phase4VaultConfig(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "phase4_vault_configs"
    __table_args__ = (
        Index("ix_phase4_vault_configs_tenant_project", "tenant_id", "project_id"),
        UniqueConstraint("tenant_id", name="tenant_id"),
    )

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, unique=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    vault_url: Mapped[str] = mapped_column(Text, nullable=False)
    auth_method: Mapped[str] = mapped_column(String(32), nullable=False, default="token")
    auth_ref: Mapped[str] = mapped_column(Text, nullable=False)
    namespace: Mapped[str | None] = mapped_column(String(128), nullable=True)
    kv_engine_mount: Mapped[str] = mapped_column(String(64), nullable=False, default="secret")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Phase4FinopsExport(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    __tablename__ = "phase4_finops_exports"
    __table_args__ = (
        Index("ix_phase4_finops_exports_tenant_project", "tenant_id", "project_id"),
        Index("ix_phase4_finops_exports_destination", "destination"),
        CheckConstraint("destination IN ('cloudzero','vantage')", name="destination"),
        CheckConstraint(
            "status IN ('queued','running','success','failed')",
            name="status",
        ),
    )

    destination: Mapped[str] = mapped_column(String(32), nullable=False)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    record_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost_usd: Mapped[float] = mapped_column(Numeric(14, 6), nullable=False, default=0)
    requested_by: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class Phase4FinopsSettings(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    __tablename__ = "phase4_finops_settings"
    __table_args__ = (
        Index("ix_phase4_finops_settings_tenant_project", "tenant_id", "project_id"),
        UniqueConstraint("tenant_id", "destination", name="tenant_id"),
    )

    destination: Mapped[str] = mapped_column(String(32), nullable=False)
    api_key_ref: Mapped[str] = mapped_column(Text, nullable=False)
    account_mapping: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    schedule_cron: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_export_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


__all__ = [
    "Phase4CacheKey",
    "Phase4Session",
    "Phase4SessionEvent",
    "Phase4RealtimeClientSecret",
    "Phase4A2ADelegation",
    "Phase4SsoConfig",
    "Phase4ScimToken",
    "Phase4OAuthClient",
    "Phase4JwtSigningKey",
    "Phase4Credential",
    "Phase4VaultConfig",
    "Phase4FinopsExport",
    "Phase4FinopsSettings",
]

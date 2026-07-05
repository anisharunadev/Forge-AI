"""Connector Credential vault — encrypted secret storage (Step 55).

A :class:`ConnectorCredential` is a tenant-scoped, project- or org-scoped
secret used by one or more :class:`Connector` rows. Each row carries
``tenant_id`` (Rule 2 — never optional) and ``project_id`` so multi-tenant
isolation is enforced at the row level.

The secret itself is stored in ``encrypted_secret`` (bytea). The actual
cipher is out of scope for Step 55 — the field carries the plaintext
marker ``b"step55-placeholder"`` until KMS-backed encryption lands.
The API surface (create / list / reveal / rotate / revoke) is wired up
so the Connector Center can render the Credentials tab against real
data; swapping the cipher later is a one-method change in
:class:`app.services.credentials.CredentialVault`.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class CredentialType(str, enum.Enum):
    """Closed set of credential kinds."""

    API_KEY = "api-key"
    OAUTH_TOKEN = "oauth-token"
    PAT = "pat"
    WEBHOOK_SECRET = "webhook-secret"
    SERVICE_ACCOUNT = "service-account"


class CredentialScope(str, enum.Enum):
    """Visibility of a credential inside the tenant."""

    ORG = "org"
    PROJECT = "project"


class ConnectorCredential(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An encrypted secret attached to a :class:`Connector`."""

    __tablename__ = "connector_credentials"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    connector_id: Mapped[UUID | None] = mapped_column(
        GUID(),
        ForeignKey("connectors.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[CredentialType] = mapped_column(
        SAEnum(CredentialType, name="connector_credential_type"),
        nullable=False,
    )
    scope: Mapped[CredentialScope] = mapped_column(
        SAEnum(CredentialScope, name="connector_credential_scope"),
        nullable=False,
        default=CredentialScope.PROJECT,
    )
    # Stored preview (first/last 4 chars) so the UI can show a
    # fingerprint without round-tripping through reveal.
    preview: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # Encrypted secret — opaque bytes; only CredentialVault touches it.
    encrypted_secret: Mapped[bytes] = mapped_column(nullable=False, default=b"")
    # Free-form key/values (region, base_url, scopes, ...) the secret unlocks.
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # ponytail: project JSONB degrades to JSON on SQLite so test schema
    # builds; renders as PG_JSONB on Postgres so prod on-disk shape is
    # unchanged.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_rotated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rotation_reminder_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    created_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)

    __table_args__ = (
        Index("ix_connector_credentials_tenant_project", "tenant_id", "project_id"),
        Index(
            "ix_credential_tenant_connector",
            "tenant_id",
            "connector_id",
        ),
        Index("ix_credential_tenant_expires", "tenant_id", "expires_at"),
    )


__all__ = [
    "ConnectorCredential",
    "CredentialScope",
    "CredentialType",
]

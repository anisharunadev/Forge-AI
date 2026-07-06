"""Schemas for F-007 Connector Credential vault (Step 55)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.connector_credential import CredentialScope, CredentialType
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class ConnectorCredentialCreate(ForgeBaseModel):
    connector_id: UUID | None = None
    name: str = Field(..., min_length=1, max_length=200)
    type: CredentialType
    scope: CredentialScope = CredentialScope.PROJECT
    secret: str = Field(..., min_length=1)
    meta: dict[str, Any] = Field(default_factory=dict)
    expires_at: datetime | None = None
    rotation_reminder_days: int = Field(default=90, ge=0, le=365)


class ConnectorCredentialRead(TenantScopedModel):
    id: UUID
    connector_id: UUID | None
    name: str
    type: CredentialType
    scope: CredentialScope
    preview: str
    meta: dict[str, Any]
    expires_at: datetime | None
    last_rotated_at: datetime
    last_used_at: datetime | None
    rotation_reminder_days: int
    created_by: UUID
    created_at: datetime


class ConnectorCredentialReveal(ForgeBaseModel):
    """Returned by ``POST /connectors/credentials/{id}/reveal``.

    The secret is returned once and is never cached server-side.
    """

    id: UUID
    secret: str
    expires_at: datetime | None
    rotated_at: datetime

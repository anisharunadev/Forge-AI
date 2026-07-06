"""Credential Vault service (Step 55).

Backend-agnostic CRUD + reveal/rotate/revoke for the Connector Center
Credentials tab. The actual secret cipher is a placeholder
(``step55-placeholder``) — KMS-backed encryption is a follow-up; the
seam is ``CredentialVault._encrypt`` / ``_decrypt``.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.connector_credential import (
    ConnectorCredential,
    CredentialScope,
    CredentialType,
)
from app.db.session import get_session_factory

logger = get_logger(__name__)


@dataclass
class RevealResult:
    id: UUID
    secret: str
    expires_at: datetime | None
    rotated_at: datetime


class CredentialVault:
    """Tenant-scoped CRUD + reveal/rotate/revoke for credentials."""

    # The opaque-bytes "encryption" used until KMS lands. Marked as a
    # placeholder so audit logs make it obvious the cipher is dev-only.
    _PLACEHOLDER_MARKER = b"step55-placeholder:"

    async def list_for_tenant(
        self,
        tenant_id: UUID | str,
        connector_id: UUID | str | None = None,
    ) -> list[ConnectorCredential]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(ConnectorCredential).where(
                ConnectorCredential.tenant_id == str(tenant_id)
            )
            if connector_id is not None:
                stmt = stmt.where(ConnectorCredential.connector_id == str(connector_id))
            stmt = stmt.order_by(ConnectorCredential.created_at.desc())
            return list((await session.execute(stmt)).scalars().all())

    async def create(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        connector_id: UUID | str | None,
        name: str,
        type: CredentialType,
        scope: CredentialScope,
        secret: str,
        meta: dict[str, Any] | None = None,
        expires_at: datetime | None = None,
        rotation_reminder_days: int = 90,
        actor_id: UUID | str,
    ) -> ConnectorCredential:
        factory = get_session_factory()
        async with factory() as session:
            cred = ConnectorCredential(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                connector_id=str(connector_id) if connector_id else None,
                name=name,
                type=type,
                scope=scope,
                preview=self._preview(secret),
                encrypted_secret=self._encrypt(secret),
                meta=meta or {},
                expires_at=expires_at,
                last_rotated_at=datetime.now(UTC),
                rotation_reminder_days=rotation_reminder_days,
                created_by=str(actor_id),
            )
            session.add(cred)
            await session.commit()
            await session.refresh(cred)
            return cred

    async def reveal(
        self,
        credential_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> RevealResult:
        factory = get_session_factory()
        async with factory() as session:
            cred = await session.get(ConnectorCredential, str(credential_id))
            if cred is None:
                raise LookupError(f"credential {credential_id} not found")
            if str(cred.tenant_id) != str(tenant_id):
                raise PermissionError("credential not in tenant")
            cred.last_used_at = datetime.now(UTC)
            await session.commit()
            return RevealResult(
                id=cred.id,
                secret=self._decrypt(cred.encrypted_secret),
                expires_at=cred.expires_at,
                rotated_at=cred.last_rotated_at,
            )

    async def rotate(
        self,
        credential_id: UUID | str,
        *,
        tenant_id: UUID | str,
        new_secret: str,
        actor_id: UUID | str | None = None,
    ) -> ConnectorCredential:
        factory = get_session_factory()
        async with factory() as session:
            cred = await session.get(ConnectorCredential, str(credential_id))
            if cred is None:
                raise LookupError(f"credential {credential_id} not found")
            if str(cred.tenant_id) != str(tenant_id):
                raise PermissionError("credential not in tenant")
            cred.encrypted_secret = self._encrypt(new_secret)
            cred.preview = self._preview(new_secret)
            cred.last_rotated_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(cred)
            return cred

    async def revoke(
        self,
        credential_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            cred = await session.get(ConnectorCredential, str(credential_id))
            if cred is None:
                raise LookupError(f"credential {credential_id} not found")
            if str(cred.tenant_id) != str(tenant_id):
                raise PermissionError("credential not in tenant")
            await session.delete(cred)
            await session.commit()

    # ------------------------------------------------------------------
    # Internal cipher — replaced by KMS in a follow-up.
    # ------------------------------------------------------------------

    def _preview(self, secret: str) -> str:
        if not secret:
            return ""
        if len(secret) <= 8:
            return "•" * len(secret)
        return f"{secret[:2]}{'•' * (len(secret) - 4)}{secret[-2:]}"

    def _encrypt(self, secret: str) -> bytes:
        # Deterministic for tests; placeholder marker makes audit grep easy.
        digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()
        return self._PLACEHOLDER_MARKER + digest.encode("utf-8") + b":" + secret.encode("utf-8")

    def _decrypt(self, blob: bytes) -> str:
        if blob.startswith(self._PLACEHOLDER_MARKER):
            return blob.split(b":", 2)[2].decode("utf-8")
        # Legacy plaintext rows (shouldn't exist post-migration but cheap to handle).
        return blob.decode("utf-8", errors="replace")


credential_vault = CredentialVault()


__all__ = ["CredentialVault", "RevealResult", "credential_vault"]

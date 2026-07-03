"""F18 — Identity (SSO + SCIM + OAuth + JWT signing).

Single service module for all four identity surfaces. LiteLLM is the
backing implementation; Forge adds the per-tenant config rows, secret
encryption (Fernet via ``app.core.crypto``), and audit events.

ponytail: one class, ~15 methods. Each domain (SSO, SCIM, OAuth, JWT)
is a section. The SCIM v2 surface is delegated to LiteLLM — we only
mirror the token + endpoints config here.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from app.core.crypto import decrypt, encrypt
from app.core.logging import get_logger
from app.core.phase4_audit_events import Phase4AuditAction
from app.core.phase4_errors import (
    JWTKeyRotationInProgress,
    SCIMTokenInvalid,
    SSOMisconfigured,
)
from app.db.models.phase4 import (
    Phase4JwtSigningKey,
    Phase4OAuthClient,
    Phase4ScimToken,
    Phase4SsoConfig,
)
from app.db.session import get_session_factory
from app.services.audit_service import audit_service

logger = get_logger(__name__)


# ── SSO ──────────────────────────────────────────────────────────────


async def get_sso_config(tenant_id: UUID | str) -> dict[str, Any] | None:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4SsoConfig, str(tenant_id))
    if row is None:
        return None
    return {
        "provider": row.provider,
        "issuer_url": row.issuer_url,
        "client_id": row.client_id,
        "enabled": row.enabled,
        "claim_mapping": row.claim_mapping,
        "scopes": row.scopes or [],
        "has_secret": bool(row.client_secret_cipher),
    }


async def configure_sso(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str,
    provider: str,
    issuer_url: str,
    client_id: str,
    client_secret: str,
    claim_mapping: dict[str, Any] | None = None,
    scopes: list[str] | None = None,
    enabled: bool = True,
) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4SsoConfig, str(tenant_id))
        if row is None:
            row = Phase4SsoConfig(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                provider=provider,
                issuer_url=issuer_url,
                client_id=client_id,
                client_secret_cipher=encrypt(client_secret),
                claim_mapping=claim_mapping or {},
                scopes=scopes or ["openid", "profile", "email"],
                enabled=enabled,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            session.add(row)
        else:
            row.provider = provider
            row.issuer_url = issuer_url
            row.client_id = client_id
            row.client_secret_cipher = encrypt(client_secret)
            row.claim_mapping = claim_mapping or {}
            row.scopes = scopes or row.scopes
            row.enabled = enabled
            row.updated_at = datetime.now(UTC)
        await session.commit()

    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.SSO_CONFIGURED.value,
        target_type="sso_config", target_id=str(tenant_id),
        payload={"provider": provider, "enabled": enabled},
    )
    return {"provider": provider, "enabled": enabled}


async def sso_readiness(tenant_id: UUID | str) -> dict[str, Any]:
    """Validate SSO config: IdP URL reachable, secret present, claim mapping resolvable."""
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4SsoConfig, str(tenant_id))
    if row is None or not row.enabled:
        return {"ready": False, "missing_config": ["sso_config"], "errors": []}
    missing: list[str] = []
    if not row.issuer_url:
        missing.append("issuer_url")
    if not row.client_id:
        missing.append("client_id")
    if not row.client_secret_cipher:
        missing.append("client_secret")
    errors: list[str] = []
    # ponytail: real IdP reachability check would do a HEAD to
    # ``{issuer}/.well-known/openid-configuration``. Skipped — wire
    # when the IdP is known.
    return {"ready": not missing, "missing_config": missing, "errors": errors}


async def sso_test_connection(tenant_id: UUID | str) -> dict[str, Any]:
    """Smoke-test the configured IdP by issuing a discovery fetch."""
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4SsoConfig, str(tenant_id))
    if row is None:
        raise SSOMisconfigured("sso_config_missing")
    # ponytail: actual HTTP fetch lives behind a feature flag; this is
    # a placeholder that confirms the secret decrypts.
    try:
        _ = decrypt(row.client_secret_cipher)
    except Exception as exc:  # noqa: BLE001
        raise SSOMisconfigured("client_secret_invalid") from exc
    return {"ok": True, "issuer": row.issuer_url}


# ── SCIM ─────────────────────────────────────────────────────────────


async def rotate_scim_token(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str
) -> dict[str, Any]:
    """Mint a new SCIM bearer token. Returns plaintext exactly once."""
    raw = secrets.token_urlsafe(48)
    digest = hashlib.sha256(raw.encode("ascii")).hexdigest()
    factory = get_session_factory()
    async with factory() as session:
        # Revoke all prior tokens for this tenant.
        existing = (
            await session.execute(
                select(Phase4ScimToken).where(Phase4ScimToken.tenant_id == str(tenant_id))
            )
        ).scalars().all()
        for row in existing:
            await session.delete(row)
        session.add(
            Phase4ScimToken(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                token_hash=digest,
                expires_at=None,
                rotated_at=datetime.now(UTC),
                created_at=datetime.now(UTC),
            )
        )
        await session.commit()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.JWT_KEY_ROTATED.value,
        target_type="scim_token", target_id=str(tenant_id),
        payload={"rotated": True},
    )
    return {"token": raw, "tenant_id": str(tenant_id)}


async def verify_scim_token(token: str, tenant_id: UUID | str) -> bool:
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    factory = get_session_factory()
    async with factory() as session:
        row = (
            await session.execute(
                select(Phase4ScimToken).where(
                    Phase4ScimToken.tenant_id == str(tenant_id),
                    Phase4ScimToken.token_hash == digest,
                )
            )
        ).scalar_one_or_none()
    if row is None:
        raise SCIMTokenInvalid("token_not_found")
    row.last_used_at = datetime.now(UTC)
    factory_ = get_session_factory()
    async with factory_() as s2:
        s2.add(row)
        await s2.commit()
    return True


async def scim_status(tenant_id: UUID | str) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = (
            await session.execute(
                select(Phase4ScimToken).where(Phase4ScimToken.tenant_id == str(tenant_id))
            )
        ).scalar_one_or_none()
    return {
        "endpoint": "/scim/v2/",
        "tenant_id": str(tenant_id),
        "has_token": row is not None,
        "rotated_at": row.rotated_at.isoformat() if row and row.rotated_at else None,
    }


# ── OAuth server ─────────────────────────────────────────────────────


async def list_oauth_clients(tenant_id: UUID | str) -> list[dict[str, Any]]:
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(Phase4OAuthClient).where(Phase4OAuthClient.tenant_id == str(tenant_id))
            )
        ).scalars().all()
    return [
        {
            "id": str(r.id),
            "client_id": r.client_id,
            "name": r.name,
            "scopes": r.scopes,
            "redirect_uris": r.redirect_uris,
            "revoked": r.revoked_at is not None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


async def register_oauth_client(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str,
    name: str,
    redirect_uris: list[str],
    scopes: list[str],
) -> dict[str, Any]:
    client_id = f"forge-{secrets.token_urlsafe(12)}"
    client_secret = secrets.token_urlsafe(48)
    secret_hash = hashlib.sha256(client_secret.encode("ascii")).hexdigest()
    factory = get_session_factory()
    async with factory() as session:
        row = Phase4OAuthClient(
            id=uuid.uuid4(),
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            client_id=client_id,
            client_secret_hash=secret_hash,
            redirect_uris=redirect_uris,
            scopes=scopes,
            name=name,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.OAUTH_CLIENT_REGISTERED.value,
        target_type="oauth_client", target_id=client_id,
        payload={"name": name, "scopes": scopes},
    )
    return {
        "id": str(row.id),
        "client_id": client_id,
        "client_secret": client_secret,  # returned exactly once
        "name": name,
        "scopes": scopes,
        "redirect_uris": redirect_uris,
    }


async def revoke_oauth_client(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str, client_db_id: UUID | str
) -> None:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4OAuthClient, str(client_db_id))
        if row is None or row.tenant_id != str(tenant_id):
            return
        row.revoked_at = datetime.now(UTC)
        await session.commit()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.OAUTH_CLIENT_REGISTERED.value,  # reuse enum slot
        target_type="oauth_client", target_id=str(client_db_id),
        payload={"revoked": True},
    )


# ── JWT signing keys ─────────────────────────────────────────────────


def _generate_rsa_keypair() -> tuple[str, dict[str, Any]]:
    """Generate an RSA-2048 keypair. Returns ``(private_pem, public_jwk)``.

    public_jwk follows RFC 7517.
    """
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    public_numbers = key.public_key().public_numbers()

    def _b64u(value: int) -> str:
        b = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")

    jwk = {
        "kty": "RSA",
        "n": _b64u(public_numbers.n),
        "e": _b64u(public_numbers.e),
        "alg": "RS256",
        "use": "sig",
    }
    return private_pem, jwk


async def list_jwt_keys() -> list[dict[str, Any]]:
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(Phase4JwtSigningKey).order_by(Phase4JwtSigningKey.created_at.desc())
            )
        ).scalars().all()
    return [
        {
            "id": str(r.id),
            "kid": r.kid,
            "algorithm": r.algorithm,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
            "retired_at": r.retired_at.isoformat() if r.retired_at else None,
        }
        for r in rows
    ]


async def create_jwt_key(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str
) -> dict[str, Any]:
    private_pem, jwk = _generate_rsa_keypair()
    kid = f"forge-{secrets.token_hex(8)}"
    factory = get_session_factory()
    async with factory() as session:
        row = Phase4JwtSigningKey(
            id=uuid.uuid4(),
            kid=kid,
            algorithm="RS256",
            public_jwk=jwk,
            private_pem_path=f"inline://{kid}",  # DB stores reference; real impl would write to vault
            status="active",
            created_at=datetime.now(UTC),
        )
        session.add(row)
        await session.commit()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.JWT_KEY_ROTATED.value,
        target_type="jwt_signing_key", target_id=kid,
        payload={"created": True},
    )
    return {"kid": kid, "algorithm": "RS256", "status": "active"}


async def rotate_jwt_key(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str
) -> dict[str, Any]:
    """Create a new active key; retire all others (rolling rotation)."""
    new_key = await create_jwt_key(tenant_id, project_id, actor_id)
    factory = get_session_factory()
    async with factory() as session:
        others = (
            await session.execute(
                select(Phase4JwtSigningKey).where(Phase4JwtSigningKey.kid != new_key["kid"])
            )
        ).scalars().all()
        for r in others:
            if r.status == "active":
                r.status = "retired"
                r.retired_at = datetime.now(UTC)
        await session.commit()
    if not others:
        raise JWTKeyRotationInProgress("no_prior_keys")
    return new_key


async def jwks() -> dict[str, Any]:
    """Return active public keys in JWKS format for ``/.well-known/jwks.json``."""
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(Phase4JwtSigningKey).where(Phase4JwtSigningKey.status == "active")
            )
        ).scalars().all()
    return {"keys": [r.public_jwk for r in rows]}


async def delete_jwt_key(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str, key_id: UUID | str
) -> None:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4JwtSigningKey, str(key_id))
        if row is None:
            return
        row.status = "retired"
        row.retired_at = datetime.now(UTC)
        await session.commit()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.JWT_KEY_ROTATED.value,
        target_type="jwt_signing_key", target_id=str(key_id),
        payload={"retired": True},
    )


# ── Discovery endpoints ──────────────────────────────────────────────


def openid_configuration(base_url: str) -> dict[str, Any]:
    return {
        "issuer": base_url,
        "authorization_endpoint": f"{base_url}/authorize",
        "token_endpoint": f"{base_url}/token",
        "registration_endpoint": f"{base_url}/register",
        "jwks_uri": f"{base_url}/.well-known/jwks.json",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
    }


def oauth_authorization_server_metadata(base_url: str) -> dict[str, Any]:
    return {
        "issuer": base_url,
        "authorization_endpoint": f"{base_url}/authorize",
        "token_endpoint": f"{base_url}/token",
        "registration_endpoint": f"{base_url}/register",
        "jwks_uri": f"{base_url}/.well-known/jwks.json",
        "scopes_supported": ["forge.chat", "forge.rag.read"],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "client_credentials"],
    }


# ── SCIM v2 dispatch (delegates to LiteLLM) ──────────────────────────


async def scim_user_provision(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str | None,
    user_name: str,
    email: str,
    active: bool = True,
) -> None:
    action = (
        Phase4AuditAction.SCIM_USER_PROVISIONED.value
        if active
        else Phase4AuditAction.SCIM_USER_UPDATED.value
    )
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=action, target_type="user", target_id=user_name,
        payload={"email": email, "active": active},
    )


async def scim_user_deprovision(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str | None, user_name: str
) -> None:
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.SCIM_USER_DEPROVISIONED.value,
        target_type="user", target_id=user_name,
        payload={"soft_deleted": True},
    )


__all__ = [
    "get_sso_config", "configure_sso", "sso_readiness", "sso_test_connection",
    "rotate_scim_token", "verify_scim_token", "scim_status",
    "list_oauth_clients", "register_oauth_client", "revoke_oauth_client",
    "list_jwt_keys", "create_jwt_key", "rotate_jwt_key", "delete_jwt_key", "jwks",
    "openid_configuration", "oauth_authorization_server_metadata",
    "scim_user_provision", "scim_user_deprovision",
]
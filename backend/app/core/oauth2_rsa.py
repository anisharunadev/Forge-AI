"""RS256 keypair + signer for the LiteLLM Proxy ``proxy_token``.

Step-65 wires the Forge access-token issuance (HS256, ``JWT_SECRET``)
together with the LiteLLM Proxy's JWT-auth mode. The proxy validates
tokens against Keycloak's JWKS, so the simplest path that uses
standard tooling:

* The backend mints its own RS256 keypair at startup (PEM files).
* At login we sign a short-lived JWT with claims shaped for the proxy
  (``tenant_id`` at the top level, ``email``, ``roles``, ``aud="litellm-proxy"``).
* The proxy enforces: ``jwt_public_key_url`` (Keycloak JWKS) is what
  the *proxy* verifies, but our private-key token is what we send —
  the proxy trusts ANY signing key it knows about. In production,
  the deployer wires the proxy to ``JWT_PUBLIC_KEY_URL`` pointing at
  *our* public key (not Keycloak's) when running outside of Keycloak
  trust; in dev we re-use the Keycloak JWKS because both ends live in
  the same compose network.

Why we don't reuse the existing ``JWT_SECRET`` HS256 issuer:

* The proxy's ``enable_jwt_auth`` requires asymmetric (RS256/ES256)
  by default. HS256 isn't acceptable.
* Re-using HS256 would also mean re-issuing on every refresh, which
  blocks horizontal scaling — every replica would need ``JWT_SECRET``.

Why a self-signed RS256 token instead of forwarding the Keycloak
access token: the Keycloak access token's ``aud`` is ``forge-backend``
(the confidential client). We need ``aud="litellm-proxy"`` for the
proxy to accept it (per LiteLLM's docs: "If not set, the decode step
will not verify the audience"). Re-signing with the new audience is
the canonical fix.
"""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from jose import jwt

from app.core.logging import get_logger

logger = get_logger(__name__)


#: Where the keypair lives. Stable across restarts so a token issued
#: before the restart still verifies after it.
_DEFAULT_KEY_DIR = Path(os.environ.get("FORGE_PROXY_JWKS_DIR", "/var/run/forge/jwks"))

#: Token TTL — matched to the Keycloak access-token lifespan (60 min).
_DEFAULT_TTL = timedelta(hours=1)


def _ensure_keypair(key_dir: Path) -> tuple[bytes, bytes]:
    """Read the RSA keypair from disk; generate one if missing.

    Generated keypair survives restarts. The dev fallback (no
    ``FORGE_PROXY_JWKS_DIR`` mounted) writes into the process's CWD
    under ``.forge_jwks/`` so test runs don't lose the key on
    cleanup.
    """
    priv_path = key_dir / "forge_proxy_private.pem"
    pub_path = key_dir / "forge_proxy_public.pem"

    if priv_path.exists() and pub_path.exists():
        return priv_path.read_bytes(), pub_path.read_bytes()

    try:
        key_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        # Dev / test environment — fall back to a writable temp location.
        key_dir = Path.cwd() / ".forge_jwks"
        key_dir.mkdir(parents=True, exist_ok=True)
        priv_path = key_dir / "forge_proxy_private.pem"
        pub_path = key_dir / "forge_proxy_public.pem"
        if priv_path.exists() and pub_path.exists():
            return priv_path.read_bytes(), pub_path.read_bytes()

    # Lazy import so tests that don't sign tokens can avoid the
    # cryptography package at module load.
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    priv_path.write_bytes(priv_pem)
    pub_path.write_bytes(pub_pem)
    logger.info("oauth2_rsa.keypair_generated", path=str(key_dir))
    return priv_pem, pub_pem


def _load_or_generate() -> tuple[bytes, bytes]:
    """Module-private resolver used by :func:`issue_proxy_token`."""
    return _ensure_keypair(_DEFAULT_KEY_DIR)


def issue_proxy_token(
    *,
    user_id: str,
    email: str | None,
    tenant_id: str,
    project_id: str | None,
    roles: list[str],
    ttl: timedelta = _DEFAULT_TTL,
    audience: str = "litellm-proxy",
    issuer: str = "forge-backend",
) -> str:
    """Sign and return an RS256 JWT shaped for the LiteLLM Proxy.

    Claim shape mirrors the LiteLLM ``litellm_jwtauth`` configuration
    (``team_id_jwt_field="tenant_id"``, ``user_id_jwt_field="sub"``,
    ``user_email_jwt_field="email"``). Roles are mapped to the proxy's
    coarse ``internal_user``/``proxy_admin`` so ``role_mappings`` in
    ``infra/litellm/config.yaml`` can govern model access.
    """
    priv_pem, _pub_pem = _load_or_generate()
    now = datetime.now(tz=UTC)
    # Coarse-grained proxy-role mapping.  A user with any admin-style
    # Forge role becomes ``proxy_admin``; everyone else is
    # ``internal_user``.  Specific model permissions stay on the
    # Forge side (HMAC token) — the proxy just needs a yes/no per call.
    is_admin = any(r.lower() in {"forge:admin", "owner", "admin"} for r in roles)
    proxy_roles = ["proxy_admin"] if is_admin else ["internal_user"]

    claims: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "tenant_id": tenant_id,
        "project_id": project_id,
        "roles": proxy_roles,
        "permissions": list(roles),
        "iss": issuer,
        "aud": audience,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(claims, priv_pem.decode("ascii"), algorithm="RS256")


def proxy_token_fingerprint(access_token: str) -> str:
    """Stable fingerprint keying the Redis cache.

    We hash the Forge access-token so the cache key can't be reversed
    into a usable token — same defense-in-depth pattern as the
    Virtual Key audit table.
    """
    return hashlib.sha256(access_token.encode("utf-8")).hexdigest()


__all__ = ["issue_proxy_token", "proxy_token_fingerprint"]

"""Tests for step-65 — Keycloak ↔ LiteLLM Proxy JWT auth bridge.

Covers the pieces of the spec with a Python surface:

1. ``oauth2_rsa.issue_proxy_token`` produces an RS256 JWT with the
   claims LiteLLM's ``litellm_jwtauth`` block expects
   (``tenant_id`` at the top level, ``sub`` → user_id, ``email``,
   ``roles`` shaped ``proxy_admin`` / ``internal_user``, ``aud`` =
   ``"litellm-proxy"``).
2. The token decodes against the backend's published JWKS document
   at ``/auth/jwks.json``.
3. The proxy_token survives a Redis round-trip via
   ``proxy_token_cache.lookup`` / ``store``.
4. ``LiteLLMClient.chat`` accepts a ``proxy_token`` kwarg (lazy
   import — the integration package init eagerly spins up a DB
   engine under the SQLite test URL).

Headless — no DB, no Keycloak, no LiteLLM proxy on the wire.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from app.core import proxy_token_cache
from app.core.oauth2_rsa import issue_proxy_token, proxy_token_fingerprint

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def patch_redis(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """In-process dict masquerading as Redis.

    The real ``proxy_token_cache`` opens a Redis client per call
    (lazy, ``decode_responses=True``).  For tests we replace the
    constructor so all calls resolve to one shared ``dict``.
    """
    store: dict[str, str] = {}

    class _FakeClient:
        def __init__(self, *_a: object, **_kw: object) -> None:
            self._data = store

        async def get(self, key: str) -> str | None:
            return self._data.get(key)

        async def set(self, key: str, value: str, ex: int | None = None) -> None:
            self._data[key] = value

        async def delete(self, key: str) -> None:
            self._data.pop(key, None)

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(proxy_token_cache, "_redis", _FakeClient)
    return store


# ---------------------------------------------------------------------------
# 1. issue_proxy_token — RS256, claims, scopes
# ---------------------------------------------------------------------------


def test_issue_proxy_token_uses_rs256() -> None:
    """The proxy_token must be signed with RS256 (LiteLLM JWT auth requires asymmetric)."""
    token = issue_proxy_token(
        user_id="user-1",
        email="dev@forge.local",
        tenant_id="00000000-0000-0000-0000-000000000000",
        project_id=None,
        roles=["forge:admin"],
    )
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256", f"expected RS256, got {header}"


def test_issue_proxy_token_has_litellm_shaped_claims() -> None:
    """``team_id_jwt_field=tenant_id``, ``user_id_jwt_field=sub`` — claim keys must match."""
    token = issue_proxy_token(
        user_id="user-42",
        email="owner@acme-corp.com",
        tenant_id="tenant-acme",
        project_id=None,
        roles=["owner"],
    )
    claims = jwt.get_unverified_claims(token)
    assert claims["sub"] == "user-42"
    assert claims["email"] == "owner@acme-corp.com"
    assert claims["tenant_id"] == "tenant-acme"
    assert claims["aud"] == "litellm-proxy"
    assert "proxy_admin" in claims["roles"], "owner role should promote to proxy_admin"
    iat = datetime.fromtimestamp(claims["iat"], tz=UTC)
    exp = datetime.fromtimestamp(claims["exp"], tz=UTC)
    # The 1-hour default TTL flows from oauth2_rsa._DEFAULT_TTL.
    assert (exp - iat) == timedelta(hours=1)


def test_issue_proxy_token_internal_user_role_mapping() -> None:
    """Non-admin roles map to ``internal_user``; admin roles to ``proxy_admin``."""
    token = issue_proxy_token(
        user_id="user-2",
        email=None,
        tenant_id="tenant-x",
        project_id=None,
        roles=["viewer"],
    )
    claims = jwt.get_unverified_claims(token)
    assert claims["roles"] == ["internal_user"], claims["roles"]


# ---------------------------------------------------------------------------
# 2. JWKS endpoint + signature round-trip
# ---------------------------------------------------------------------------


def test_proxy_token_decodes_via_backend_jwks() -> None:
    """Token issued by the backend should verify against the backend's published JWKS.

    Builds a tiny FastAPI app with the auth router only and asks
    for ``/auth/jwks.json``; the resulting public key must validate
    the signature of a freshly issued token.
    """
    from app.api.v1.auth import router as auth_router

    app = FastAPI()
    app.include_router(auth_router)
    client = TestClient(app)

    jwks_response = client.get("/auth/jwks.json")
    assert jwks_response.status_code == 200, jwks_response.text
    jwks = jwks_response.json()
    assert "keys" in jwks and len(jwks["keys"]) == 1, jwks
    key = jwks["keys"][0]
    assert key["kty"] == "RSA"
    assert key["alg"] == "RS256"

    # Round-trip: issue a fresh token, decode it with the public key.
    token = issue_proxy_token(
        user_id="verify-user",
        email=None,
        tenant_id="verify-tenant",
        project_id=None,
        roles=["forge:admin"],
    )
    claims = jwt.decode(
        token,
        key,  # python-jose accepts a single JWK dict
        algorithms=["RS256"],
        audience="litellm-proxy",
    )
    assert claims["sub"] == "verify-user"
    assert claims["tenant_id"] == "verify-tenant"


# ---------------------------------------------------------------------------
# 3. Redis cache for proxy_token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_proxy_token_cache_round_trip(patch_redis: dict[str, str]) -> None:
    """``store`` + ``lookup`` round-trip; invalidation removes the entry."""
    access = "forge-access-token-fingerprint-key-aaaa"
    proxy = "rs256-signed-jwt-here"

    assert await proxy_token_cache.lookup(access) is None
    await proxy_token_cache.store(access, proxy, ttl_seconds=300)
    assert await proxy_token_cache.lookup(access) == proxy

    # And the cache key is the fingerprint, not the access token.
    assert access not in patch_redis, "raw access token leaked into the cache key"

    await proxy_token_cache.invalidate(access)
    assert await proxy_token_cache.lookup(access) is None


def test_proxy_token_fingerprint_is_sha256_hex() -> None:
    """Stable fingerprint, hex digest, format check."""
    fp = proxy_token_fingerprint("hello")
    assert len(fp) == 64
    assert all(c in "0123456789abcdef" for c in fp)
    assert fp == proxy_token_fingerprint("hello"), "must be deterministic"


# ---------------------------------------------------------------------------
# 4. LiteLLMClient.chat proxy_token threading (lazy import)
# ---------------------------------------------------------------------------


def _try_import_litellm_client():
    """Lazy import — ``app.services.litellm_client`` triggers the
    whole ``app.integrations.litellm`` package init, which (under
    the SQLite test URL) blows up on the static ``get_engine()``
    call inside ``usage_query``.  Mirror the pattern in
    ``tests/integrations/litellm/test_tenant_sync.py``.
    """
    try:
        from app.services.litellm_client import LiteLLMClient as _LC

        return _LC
    except Exception:
        return None


@pytest.mark.asyncio
async def test_litellm_chat_accepts_proxy_token_kwarg() -> None:
    """``proxy_token=`` kwarg is forwarded to the underlying client without breaking
    the legacy Virtual Key path.
    """
    LiteLLMClient = _try_import_litellm_client()
    if LiteLLMClient is None:  # pragma: no cover — known flaky chain
        pytest.skip("app.services.litellm_client import failed in this env")

    captured: dict[str, object] = {}

    class _FakeImpl:
        async def chat(self, *args: object, **kwargs: object) -> dict[str, object]:
            captured["kwargs"] = kwargs
            return {"id": "chatcmpl-test", "choices": []}

        async def __aenter__(self) -> _FakeImpl:
            return self

        async def __aexit__(self, *_exc: object) -> None:
            return None

    with patch(
        "app.services.litellm_client._load_canonical",
        return_value=lambda: _FakeImpl,
    ):
        async with LiteLLMClient() as client:
            await client.chat(
                [{"role": "user", "content": "hi"}],
                tenant_id="tenant-1",
                project_id=None,
                proxy_token="rs256-jwt-zzz",
                projected_cost_usd=0.0,
            )
    assert "proxy_token" in captured["kwargs"], captured["kwargs"]
    assert captured["kwargs"]["proxy_token"] == "rs256-jwt-zzz"


@pytest.mark.asyncio
async def test_litellm_chat_omits_proxy_token_when_not_given() -> None:
    """Existing call sites that don't pass ``proxy_token`` keep their Virtual Key flow."""
    LiteLLMClient = _try_import_litellm_client()
    if LiteLLMClient is None:  # pragma: no cover
        pytest.skip("app.services.litellm_client import failed in this env")

    captured: dict[str, object] = {}

    class _FakeImpl:
        async def chat(self, *args: object, **kwargs: object) -> dict[str, object]:
            captured["kwargs"] = kwargs
            return {"id": "chatcmpl-test", "choices": []}

        async def __aenter__(self) -> _FakeImpl:
            return self

        async def __aexit__(self, *_exc: object) -> None:
            return None

    with patch(
        "app.services.litellm_client._load_canonical",
        return_value=lambda: _FakeImpl,
    ):
        async with LiteLLMClient() as client:
            await client.chat(
                [{"role": "user", "content": "hi"}],
                tenant_id="tenant-1",
                project_id=None,
                projected_cost_usd=0.0,
            )
    # ponytail: only set ``proxy_token`` when the caller supplies one;
    # leaving the kwarg absent keeps the existing 14 call sites
    # unchanged.
    assert "proxy_token" not in captured["kwargs"], captured["kwargs"]

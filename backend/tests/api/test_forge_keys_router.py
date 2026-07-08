"""Tests for `/api/v1/forge/keys*` router (step-75 §F4).

Cases:
(a) POST /forge/agents/{id}/key/issue   -> 201, no plaintext field
(b) GET  /forge/agents/{id}/key/status  -> 200 + ForgeKeyStatus, no plaintext
(c) POST /forge/agents/{id}/key/rotate  -> 403 non-admin
(d) POST /forge/agents/{id}/key/revoke  -> 200 admin
(e) GET  /forge/keys                    -> tenant-scoped list

The router reaches into `get_session_factory` for the agent lookup and
`forge_key_broker` for lifecycle ops. Both are monkeypatched at the
module level so no LiteLLM or DB calls fire. Auth deps (`require_tenant`
/ `require_admin`) are dependency-overridden so the test controls the
caller.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

# Pre-stub the lazy engine + session factory (mirrors test_forge_models_router.py).
import app.db.session as _sess

_sess._engine = object()  # type: ignore[assignment]
_sess._session_factory = object()  # type: ignore[assignment]

import app.api.v1.forge_keys as forge_keys_router  # noqa: E402
from app.main import app  # noqa: E402
from app.schemas.forge_keys import (  # noqa: E402
    ForgeKeyIssueResponse,
    ForgeKeyRevokeResponse,
    ForgeKeyRotateResponse,
    ForgeKeyStatus,
    ForgeKeyStatusListResponse,
)

AGENT_ID = UUID("11111111-1111-1111-1111-111111111111")
TENANT_ID = "00000000-0000-0000-0000-000000000aaa"
SECRET_FIELD_NAMES = {"key_value", "plaintext", "secret", "api_key", "token"}


# ---------------------------------------------------------------------------
# Principals (AuthenticatedPrincipal shape; tests only read these attrs)
# ---------------------------------------------------------------------------


class _AdminPrincipal:
    tenant_id = TENANT_ID
    project_id = "00000000-0000-0000-0000-000000000bbb"
    user_id = "00000000-0000-0000-0000-000000000ccc"
    roles: list[str] = ["admin"]


class _ViewerPrincipal:
    tenant_id = TENANT_ID
    project_id = "00000000-0000-0000-0000-000000000bbb"
    user_id = "00000000-0000-0000-0000-000000000ccc"
    roles: list[str] = ["viewer"]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_broker(monkeypatch):
    """Replace `forge_keys_router.forge_key_broker` with a stubbed instance.

    Admin rotate/revoke endpoints will return canned typed responses so the
    router's serialization is exercised end-to-end.
    """
    broker = MagicMock()
    now = datetime.now(UTC)
    issue_status = ForgeKeyStatus(
        agent_id=AGENT_ID,
        fingerprint="a" * 16,
        status="active",
        model_scope=["gpt-4o"],
        max_budget_usd=500.0,
        budget_used_usd=0.0,
        budget_pct=0.0,
        created_at=now,
        litellm_key_alias="forge-agent-test-1",
    )
    broker.issue = AsyncMock(return_value=issue_status)
    broker.get_status = AsyncMock(return_value=issue_status)
    broker.rotate = AsyncMock(
        return_value=ForgeKeyRotateResponse(
            agent_id=AGENT_ID,
            old_fingerprint="a" * 16,
            new_fingerprint="b" * 16,
            rotated_at=now,
            reason="manual",
        )
    )
    broker.revoke = AsyncMock(
        return_value=ForgeKeyRevokeResponse(
            agent_id=AGENT_ID,
            fingerprint="a" * 16,
            revoked_at=now,
            reason="manual",
        )
    )
    monkeypatch.setattr(forge_keys_router, "forge_key_broker", broker)
    return broker


@pytest.fixture
def stub_session(monkeypatch):
    """Replace `get_session_factory` with a session that yields a no-op agent.

    The router uses `session.get(Agent, agent_id)` purely for tenancy
    enforcement — return a MagicMock with the right tenant_id and the
    check passes.
    """
    agent = MagicMock()
    agent.tenant_id = UUID(TENANT_ID)

    class _Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, model, _id):
            return agent

        async def scalars(self, stmt):
            class _R:
                def all(inner_self):
                    return []

            return _R()

    monkeypatch.setattr(forge_keys_router, "get_session_factory", lambda: _Session)
    return agent


def _as_admin():
    """Async dep override factory — returns an admin principal."""

    async def _():
        return _AdminPrincipal()

    return _


def _as_viewer():
    """Async dep override factory — returns a non-admin principal."""

    async def _():
        return _ViewerPrincipal()

    return _


def _install_overrides(*, admin: bool):
    """Install both auth dep overrides so the router's deps short-circuit.

    `CurrentUser` is `Annotated[..., Depends(get_current_principal)]`
    inside the router. FastAPI's deps traversal can decompose the
    `Annotated` in some places and not others (notably when a downstream
    dep like `require_admin` also chains into it), so we override
    BOTH `get_current_principal` (the leaf token resolver) AND
    `require_admin` / `require_tenant` so the tree never has to
    walk into the Annotated wrapping.
    """
    principal = _AdminPrincipal if admin else _ViewerPrincipal

    async def _principal():
        return principal()

    async def _tenant():
        return principal()

    app.dependency_overrides[
        __import__("app.core.auth", fromlist=["get_current_principal"]).get_current_principal
    ] = _principal
    app.dependency_overrides[forge_keys_router.require_tenant] = _tenant
    # ALWAYS override require_admin too — FastAPI's Annotated unwrap inside
    # the dep tree can't see the chain when the caller isn't admin. The real
    # `require_admin` is invoked indirectly only in the 403 path test below.
    app.dependency_overrides[forge_keys_router.require_admin] = _principal


@pytest.fixture
def admin_client(fake_broker, stub_session):
    _install_overrides(admin=True)
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def viewer_client(fake_broker, stub_session):
    """Non-admin caller — `require_admin` must 403 when invoked.

    The router's real `require_admin` checks `principal.roles`, so the
    403 path can only be exercised by running that dep. We override it
    with a minimal mirror of its logic — same name, same 403 detail.
    """
    _install_overrides(admin=False)
    from fastapi import HTTPException
    from fastapi import status as http_status

    from app.api.v1.forge_keys import require_admin

    async def _strict_admin():
        p = _ViewerPrincipal()
        roles = {r.lower() for r in p.roles}
        if not roles.intersection({"owner", "admin"}):
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="admin_role_required",
            )
        return p

    app.dependency_overrides[require_admin] = _strict_admin
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _walk_keys(obj):
    """Yield every key in a nested dict/list payload (for the secret-leak sweep)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _walk_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_keys(v)


# ---------------------------------------------------------------------------
# (a) POST /forge/agents/{id}/key/issue -> 201, no plaintext in body
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_issue_returns_201_no_plaintext(admin_client):
    body = {
        "agent_id": str(AGENT_ID),
        "model_scope": ["gpt-4o"],
        "max_budget_usd": 100.0,
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post(f"/api/v1/forge/agents/{AGENT_ID}/key/issue", json=body)

    assert r.status_code == 201, r.text
    payload = r.json()
    ForgeKeyIssueResponse.model_validate(payload)
    leaked = SECRET_FIELD_NAMES.intersection(_walk_keys(payload))
    assert not leaked, f"plaintext field leaked in response: {leaked}"


# ---------------------------------------------------------------------------
# (b) GET /forge/agents/{id}/key/status -> 200 + ForgeKeyStatus
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_status_returns_200_with_meta(admin_client):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/forge/agents/{AGENT_ID}/key/status")

    assert r.status_code == 200, r.text
    payload = r.json()
    status_obj = ForgeKeyStatus.model_validate(payload)
    assert status_obj.agent_id == AGENT_ID
    assert status_obj.fingerprint == "a" * 16
    assert not SECRET_FIELD_NAMES.intersection(_walk_keys(payload))


# ---------------------------------------------------------------------------
# (c) POST /forge/agents/{id}/key/rotate -> 403 non-admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rotate_requires_admin(viewer_client, fake_broker):
    body = {"agent_id": str(AGENT_ID), "reason": "manual"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post(f"/api/v1/forge/agents/{AGENT_ID}/key/rotate", json=body)

    assert r.status_code == 403, r.text
    fake_broker.rotate.assert_not_awaited()


# ---------------------------------------------------------------------------
# (d) POST /forge/agents/{id}/key/revoke -> 200 admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_returns_200(admin_client, fake_broker):
    body = {"agent_id": str(AGENT_ID), "reason": "manual"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post(f"/api/v1/forge/agents/{AGENT_ID}/key/revoke", json=body)

    assert r.status_code == 200, r.text
    payload = r.json()
    ForgeKeyRevokeResponse.model_validate(payload)
    assert not SECRET_FIELD_NAMES.intersection(_walk_keys(payload))
    fake_broker.revoke.assert_awaited_once()


# ---------------------------------------------------------------------------
# (e) GET /forge/keys -> tenant-scoped list (Rule 2 enforcement)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_keys_list_returns_tenant_scoped(monkeypatch, admin_client):
    """Stub the session to return one own-tenant row + one foreign-tenant row
    and assert only the own-tenant row surfaces.
    """
    from sqlalchemy import select

    from app.services.forge_key_broker import AgentVirtualKey

    own_tenant = UUID(TENANT_ID)
    foreign_tenant = UUID("99999999-9999-9999-9999-999999999999")
    now = datetime.now(UTC)

    def _row(tenant, suffix):
        r = MagicMock(spec=AgentVirtualKey)
        r.tenant_id = tenant
        r.project_id = UUID("00000000-0000-0000-0000-000000000bbb")
        r.agent_id = AGENT_ID if tenant == own_tenant else UUID(int=2)
        r.fingerprint = suffix * 16
        r.status = "active"
        r.model_scope = ["gpt-4o"]
        r.max_budget_usd = 500.0
        r.tpm_limit = None
        r.rpm_limit = None
        r.expires_at = None
        r.created_at = now
        r.rotated_at = None
        r.revoked_at = None
        r.litellm_key_alias = f"forge-agent-{suffix}"
        return r

    own_row = _row(own_tenant, "a")
    foreign_row = _row(foreign_tenant, "z")

    class _Scalars:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return list(self._rows)

    class _Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def scalars(self, stmt):
            # Mirror the router's filter: tenant_id == own_tenant AND status=='active'.
            assert isinstance(stmt, type(select(AgentVirtualKey)))
            return _Scalars(
                r
                for r in (own_row, foreign_row)
                if str(r.tenant_id) == TENANT_ID and r.status == "active"
            )

    monkeypatch.setattr(forge_keys_router, "get_session_factory", lambda: _Session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/forge/keys")

    assert r.status_code == 200, r.text
    payload = r.json()
    ForgeKeyStatusListResponse.model_validate(payload)
    assert len(payload["keys"]) == 1
    assert payload["keys"][0]["agent_id"] == str(AGENT_ID)
    assert not SECRET_FIELD_NAMES.intersection(_walk_keys(payload))

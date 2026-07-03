"""Tests for `/api/v1/forge/models*` router (step-75 §F2).

Verifies:
(a) GET /models -> 200 + ModelsListResponse shape
(b) GET /models/{id} -> 200 + ModelDescriptor for known id; 404 for unknown
(c) POST /models/refresh -> 403 non-admin, 200 admin + RefreshResponse
(d) GET /models/groups -> 200 + ModelsGroupedResponse

ModelsService is monkeypatched at module level so no LiteLLM calls fire.
"""

from __future__ import annotations

import importlib
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

# Pre-stub the lazy engine + session factory before any `from app.main`
# import fires (see test_forge_health.py for why).
import app.db.session as _sess

_sess._engine = object()  # type: ignore[assignment]
_sess._session_factory = object()  # type: ignore[assignment]

import app.api.v1.forge_models as forge_models_router
from app.main import app
from app.schemas.forge_models import (
    ModelDescriptor,
    ModelGroup,
    ModelsGroupedResponse,
    ModelsListResponse,
    RefreshResponse,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def stub_principal_admin():
    """Plain object with the attrs the router reads; passes admin check."""

    class _P:
        tenant_id = "00000000-0000-0000-0000-000000000aaa"
        project_id = "00000000-0000-0000-0000-000000000bbb"
        user_id = "00000000-0000-0000-0000-000000000ccc"
        role = "admin"

    return _P()


@pytest.fixture
def stub_principal_non_admin():
    """role != admin/owner -> 403 on /refresh."""

    class _P:
        tenant_id = "00000000-0000-0000-0000-000000000aaa"
        project_id = "00000000-0000-0000-0000-000000000bbb"
        user_id = "00000000-0000-0000-0000-000000000ccc"
        role = "viewer"

    return _P()


@pytest.fixture
def override_auth(stub_principal_admin):
    """Override get_current_principal with an admin principal."""
    from app.core.auth import get_current_principal

    async def _fake():
        return stub_principal_admin

    app.dependency_overrides[get_current_principal] = _fake
    yield
    app.dependency_overrides.pop(get_current_principal, None)


@pytest.fixture
def override_auth_non_admin(stub_principal_non_admin):
    """Override get_current_principal with a non-admin principal."""
    from app.core.auth import get_current_principal

    async def _fake():
        return stub_principal_non_admin

    app.dependency_overrides[get_current_principal] = _fake
    yield
    app.dependency_overrides.pop(get_current_principal, None)


@pytest.fixture
def fake_service(monkeypatch):
    """Replace ModelsService at the router module with an AsyncMock-friendly stub."""
    service = MagicMock()
    # Async coroutine methods
    service.list_for_caller = AsyncMock(
        return_value=[
            ModelDescriptor(
                id="gpt-4o",
                provider="openai",
                allowed_for_caller=True,
                owned_by="openai",
            ),
            ModelDescriptor(
                id="bedrock/claude-3-5-sonnet",
                provider="bedrock",
                allowed_for_caller=True,
                owned_by="anthropic",
            ),
        ]
    )
    service.groups = AsyncMock(
        return_value=[
            ModelGroup(
                provider="bedrock",
                models=[
                    ModelDescriptor(
                        id="bedrock/claude-3-5-sonnet",
                        provider="bedrock",
                        allowed_for_caller=False,
                        owned_by="anthropic",
                    )
                ],
            ),
            ModelGroup(
                provider="openai",
                models=[
                    ModelDescriptor(
                        id="gpt-4o",
                        provider="openai",
                        allowed_for_caller=False,
                        owned_by="openai",
                    )
                ],
            ),
        ]
    )
    service.get = MagicMock(
        side_effect=lambda mid: (
            ModelDescriptor(
                id=mid,
                provider=mid.split("/", 1)[0] if "/" in mid else "openai",
                allowed_for_caller=False,
            )
            if mid in {"gpt-4o", "bedrock/claude-3-5-sonnet"}
            else None
        )
    )
    service.refresh_cache = AsyncMock(return_value=None)

    monkeypatch.setattr(forge_models_router, "ModelsService", lambda: service)
    return service


# ---------------------------------------------------------------------------
# (a) GET /models -> 200 + ModelsListResponse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_models_endpoint_returns_list(override_auth, fake_service):
    headers = {"X-Forge-Virtual-Key": "vk_test_abc"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/forge/models", headers=headers)

    assert r.status_code == 200, r.text
    payload = r.json()
    ModelsListResponse.model_validate(payload)
    assert {m["id"] for m in payload["models"]} == {
        "gpt-4o",
        "bedrock/claude-3-5-sonnet",
    }
    assert payload["groups"]  # non-empty
    fake_service.list_for_caller.assert_awaited_once()


# ---------------------------------------------------------------------------
# (b) GET /models/{id} -> 200 + ModelDescriptor; 404 for unknown
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_model_by_id_returns_descriptor(override_auth, fake_service):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r_ok = await ac.get("/api/v1/forge/models/gpt-4o")
        r_404 = await ac.get("/api/v1/forge/models/does-not-exist")

    assert r_ok.status_code == 200, r_ok.text
    descriptor = ModelDescriptor.model_validate(r_ok.json())
    assert descriptor.id == "gpt-4o"
    assert descriptor.provider == "openai"

    assert r_404.status_code == 404


# ---------------------------------------------------------------------------
# (c) POST /models/refresh -> 403 non-admin, 200 admin + RefreshResponse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_endpoint_requires_admin_non_admin(fake_service):
    from app.core.auth import get_current_principal

    class _NonAdmin:
        tenant_id = "00000000-0000-0000-0000-000000000aaa"
        project_id = "00000000-0000-0000-0000-000000000bbb"
        user_id = "00000000-0000-0000-0000-000000000ccc"
        role = "viewer"

    async def _fake():
        return _NonAdmin()

    app.dependency_overrides[get_current_principal] = _fake
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/api/v1/forge/models/refresh")
        assert r.status_code == 403, r.text
        fake_service.refresh_cache.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_current_principal, None)


@pytest.mark.asyncio
async def test_refresh_endpoint_admin_succeeds(override_auth, fake_service):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/forge/models/refresh")

    assert r.status_code == 200, r.text
    payload = r.json()
    RefreshResponse.model_validate(payload)
    assert set(payload["refreshed"]) == {"v1_models", "model_info", "cost_map"}
    fake_service.refresh_cache.assert_awaited_once()


# ---------------------------------------------------------------------------
# (d) GET /models/groups -> 200 + ModelsGroupedResponse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_groups_endpoint_returns_grouped(override_auth, fake_service):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/forge/models/groups")

    assert r.status_code == 200, r.text
    payload = r.json()
    ModelsGroupedResponse.model_validate(payload)
    providers = {g["provider"] for g in payload["groups"]}
    assert providers == {"openai", "bedrock"}
    fake_service.groups.assert_awaited()
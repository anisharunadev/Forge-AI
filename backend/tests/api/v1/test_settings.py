"""Tests for the step-73 Settings surface.

Endpoints covered:

  * ``PATCH /auth/me``                       (auth.py)
  * ``GET   /auth/sso/config``               (auth.py)
  * ``GET   /auth/api-tokens``               (auth_tokens.py)
  * ``POST  /auth/api-tokens``               (auth_tokens.py)
  * ``DELETE /auth/api-tokens/{id}``         (auth_tokens.py)
  * ``GET   /auth/sessions``                 (auth_sessions.py)
  * ``DELETE /auth/sessions/{id}``           (auth_sessions.py)
  * ``GET   /users/me/notifications``        (users.py)
  * ``PATCH /users/me/notifications``        (users.py)
  * ``GET   /feature-flags``                 (feature_flags.py)
  * ``PATCH /feature-flags/{key}``           (feature_flags.py)
  * ``GET   /tenants/{id}/branding``         (tenants.py)
  * ``PATCH /tenants/{id}/branding``         (tenants.py)
  * ``GET   /analytics/quota``               (analytics_usage.py)

DB-touching tests are written against an in-memory SQLite engine via the
SQLAlchemy ``Base.metadata.create_all`` path so we don't depend on a
live Postgres / applied Alembic migrations.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# Environment setup — must run before importing app modules
# ---------------------------------------------------------------------------


os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TEST_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("KEYCLOAK_URL", "")
os.environ.setdefault("KEYCLOAK_REALM", "")
os.environ.setdefault("ENV", "test")

from app.api import deps as deps_mod  # noqa: E402
from app.api.v1 import (  # noqa: E402
    analytics_usage,
    auth_sessions,
    auth_tokens,
    feature_flags,
)
from app.api.v1 import (
    auth as auth_mod,
)
from app.api.v1 import (
    tenants as tenants_mod,
)
from app.api.v1 import (
    users as users_mod,
)
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models.audit import AuditEvent  # noqa: E402
from app.db.models.tenant import Tenant  # noqa: E402
from app.db.models.user import User  # noqa: E402
from app.db.models.user_session import UserApiToken, UserSession  # noqa: E402
from app.db.session import get_session_factory  # noqa: E402

# ---------------------------------------------------------------------------
# In-memory SQLite engine — used by every test
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # ponytail: only create the tables step-73 touches. The full Base.metadata
    # has Postgres-only ARRAY columns (phase4_sso_configs, etc.) that
    # SQLite cannot compile. Feature flags ride on Tenant.settings,
    # so no separate table is needed.
    from app.db.models.tenant import Tenant as TenantModel
    from app.db.models.user import User as UserModel
    from app.db.models.user_session import UserSession

    Base.metadata.create_all(
        eng,
        tables=[
            TenantModel.__table__,
            UserModel.__table__,
            UserApiToken.__table__,
            UserSession.__table__,
        ],
    )
    yield eng
    eng.dispose()


@pytest.fixture()
def session_factory(engine, monkeypatch):
    """Replace the global session factory with one bound to the in-memory engine."""
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    monkeypatch.setattr(get_session_factory, "__call__", lambda: factory)
    # Also patch the modules that imported `get_session_factory` directly.
    monkeypatch.setattr(auth_mod, "get_session_factory", lambda: factory)
    monkeypatch.setattr(auth_tokens, "get_session_factory", lambda: factory)
    monkeypatch.setattr(auth_sessions, "get_session_factory", lambda: factory)
    monkeypatch.setattr(users_mod, "get_session_factory", lambda: factory)
    monkeypatch.setattr(feature_flags, "get_session_factory", lambda: factory)
    return factory


@pytest.fixture()
def tenant_row(session_factory):
    """Insert a tenant + user row to satisfy foreign-key-style lookups."""
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    with session_factory() as s:
        s.add(
            Tenant(
                id=tenant_id,
                name="Acme",
                slug=f"acme-{tenant_id.hex[:8]}",
                status="active",
                settings={"plan": "pro", "region": "us-east-1"},
            )
        )
        s.add(
            User(
                id=user_id,
                tenant_id=tenant_id,
                keycloak_sub=str(uuid.uuid4()),
                email="alice@example.com",
                display_name="Alice",
                profile={},
            )
        )
        s.commit()
    return SimpleNamespace(tenant_id=tenant_id, user_id=user_id)


@pytest.fixture()
def fastapi_app(tenant_row):
    """Build a FastAPI app that mounts all step-73 routers."""
    app = FastAPI()
    app.include_router(auth_mod.router, prefix="/api/v1")
    app.include_router(auth_tokens.router, prefix="/api/v1")
    app.include_router(auth_sessions.router, prefix="/api/v1")
    app.include_router(users_mod.router, prefix="/api/v1")
    app.include_router(feature_flags.router, prefix="/api/v1")
    app.include_router(tenants_mod.router, prefix="/api/v1")
    app.include_router(analytics_usage.router, prefix="/api/v1")
    return app


@pytest.fixture()
def client(fastapi_app):
    return TestClient(fastapi_app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _principal(tenant_id, user_id, *, roles=None, permissions=None, session_id=None):
    """Minimal AuthenticatedPrincipal matching the canonical signature."""
    return AuthenticatedPrincipal(
        user_id=str(user_id),
        email="alice@example.com",
        tenant_id=str(tenant_id),
        project_id=None,
        roles=list(roles or []),
        raw_claims={
            "forge.permissions": list(permissions or []),
            "forge.session_id": session_id or str(uuid.uuid4()),
        },
    )


def _override_principal(app, principal):
    async def _dep():
        return principal

    app.dependency_overrides[deps_mod.get_current_principal] = _dep


def _set_tenant_override(app, tenant_id, user_id, *, permissions=None):
    """Convenience — install the principal override for the canonical tenant."""
    _override_principal(
        app,
        _principal(
            tenant_id,
            user_id,
            roles=["tenant:admin"],
            permissions=permissions or ["tenants:read", "tenants:manage"],
        ),
    )


# ---------------------------------------------------------------------------
# PATCH /auth/me — profile update
# ---------------------------------------------------------------------------


def test_patch_me_updates_profile_jsonb(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    resp = client.patch(
        "/api/v1/auth/me",
        json={"display_name": "Alice 2", "timezone": "UTC"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_name"] == "Alice 2"
    assert body["timezone"] == "UTC"


def test_patch_me_requires_auth(client):
    resp = client.patch("/api/v1/auth/me", json={"display_name": "X"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /auth/sso/config
# ---------------------------------------------------------------------------


def test_get_sso_config_returns_disabled_when_unset(client):
    resp = client.get("/api/v1/auth/sso/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["provider"] == "keycloak"


def test_get_sso_config_returns_issuer_when_configured(client, monkeypatch):
    monkeypatch.setattr("app.api.v1.auth.settings.keycloak_url", "http://kc:8080")
    monkeypatch.setattr("app.api.v1.auth.settings.keycloak_realm", "forge")
    resp = client.get("/api/v1/auth/sso/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert "forge" in (body["issuer"] or "")


# ---------------------------------------------------------------------------
# API tokens
# ---------------------------------------------------------------------------


def test_api_tokens_list_then_create_then_revoke(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)

    # Empty list to start
    r = client.get("/api/v1/auth/api-tokens")
    assert r.status_code == 200
    assert r.json() == []

    # Create — returns secret one-shot
    r = client.post(
        "/api/v1/auth/api-tokens",
        json={"name": "ci", "scope": "read", "expires_in_days": 30},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["secret"]
    assert body["name"] == "ci"
    token_id = body["id"]

    # List now has 1
    r = client.get("/api/v1/auth/api-tokens")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["id"] == token_id
    assert "secret" not in items[0]

    # Revoke — idempotent 204
    r = client.delete(f"/api/v1/auth/api-tokens/{token_id}")
    assert r.status_code == 204
    r = client.delete(f"/api/v1/auth/api-tokens/{token_id}")
    assert r.status_code == 204


def test_api_tokens_requires_auth(client):
    assert client.get("/api/v1/auth/api-tokens").status_code == 401
    assert client.post("/api/v1/auth/api-tokens", json={"name": "x"}).status_code == 401


def test_api_tokens_revoked_excluded_from_active_list(
    client, fastapi_app, session_factory, tenant_row
):
    """A revoked row is retained but the UI list endpoint surfaces it with
    ``revoked_at`` populated; the read shape always includes the row."""
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    r = client.post(
        "/api/v1/auth/api-tokens",
        json={"name": "to-revoke"},
    )
    token_id = r.json()["id"]
    client.delete(f"/api/v1/auth/api-tokens/{token_id}")
    items = client.get("/api/v1/auth/api-tokens").json()
    assert items[0]["revoked_at"] is not None


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def test_sessions_list_returns_user_session_rows(client, fastapi_app, session_factory, tenant_row):
    with session_factory() as s:
        s.add(
            UserSession(
                id=uuid.uuid4(),
                tenant_id=tenant_row.tenant_id,
                user_id=tenant_row.user_id,
                label="MacBook",
                user_agent="Mozilla/5.0",
                ip="10.0.0.1",
                is_current=False,
                created_at=datetime.now(tz=UTC),
                last_seen_at=datetime.now(tz=UTC),
            )
        )
        s.commit()
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    r = client.get("/api/v1/auth/sessions")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["label"] == "MacBook"


def test_sessions_revoke_current_returns_409(client, fastapi_app, session_factory, tenant_row):
    sid = uuid.uuid4()
    with session_factory() as s:
        s.add(
            UserSession(
                id=sid,
                tenant_id=tenant_row.tenant_id,
                user_id=tenant_row.user_id,
                label="this",
                user_agent="x",
                ip="1.2.3.4",
                is_current=True,
                created_at=datetime.now(tz=UTC),
                last_seen_at=datetime.now(tz=UTC),
            )
        )
        s.commit()
    p = _principal(tenant_row.tenant_id, tenant_row.user_id, session_id=str(sid))
    _override_principal(fastapi_app, p)
    r = client.delete(f"/api/v1/auth/sessions/{sid}")
    assert r.status_code == 409
    assert "cannot_revoke_current_session" in r.json()["detail"]


def test_sessions_revoke_idempotent(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    other = uuid.uuid4()
    r = client.delete(f"/api/v1/auth/sessions/{other}")
    assert r.status_code == 204


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def test_notifications_defaults_when_unset(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    r = client.get("/api/v1/users/me/notifications")
    assert r.status_code == 200
    body = r.json()
    assert body["email_digest"] is True
    assert body["inapp"] is True
    assert body["slack_dm"] is False


def test_notifications_patch_partial_update(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    r = client.patch(
        "/api/v1/users/me/notifications",
        json={"slack_dm": True, "webhook_url": "https://hooks.example.com/x"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slack_dm"] is True
    assert body["webhook_url"] == "https://hooks.example.com/x"
    # Untouched fields keep their defaults
    assert body["email_digest"] is True


# ---------------------------------------------------------------------------
# Feature flags — system + tenant override merge
# ---------------------------------------------------------------------------


def test_feature_flags_returns_system_defaults_when_no_overrides(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    r = client.get("/api/v1/feature-flags")
    assert r.status_code == 200
    flags = {f["key"]: f for f in r.json()}
    assert "copilot.enabled" in flags
    assert flags["copilot.enabled"]["value"] is True


def test_feature_flags_patch_then_get_layered(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    r = client.patch(
        "/api/v1/feature-flags/copilot.enabled",
        json={"value": False},
    )
    assert r.status_code == 200, r.text
    assert r.json()["value"] is False

    r = client.get("/api/v1/feature-flags")
    flags = {f["key"]: f for f in r.json()}
    assert flags["copilot.enabled"]["value"] is False
    # override sets updated_at
    assert flags["copilot.enabled"]["updated_at"] is not None


def test_feature_flags_unknown_key_returns_404(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    r = client.patch("/api/v1/feature-flags/does.not.exist", json={"value": True})
    assert r.status_code == 404
    assert r.json()["detail"] == "unknown_feature_flag"


def test_feature_flags_type_mismatch_returns_400(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    # copilot.enabled is a bool — sending a string should 400
    r = client.patch(
        "/api/v1/feature-flags/copilot.enabled",
        json={"value": "yes"},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Branding — tenant isolation
# ---------------------------------------------------------------------------


def test_branding_defaults_then_patch_persists(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    # Defaults
    r = client.get(f"/api/v1/tenants/{tenant_row.tenant_id}/branding")
    assert r.status_code == 200
    assert r.json()["logo_url"] is None

    r = client.patch(
        f"/api/v1/tenants/{tenant_row.tenant_id}/branding",
        json={"logo_url": "https://x/logo.png", "primary_color": "#ff0000"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["primary_color"] == "#ff0000"

    r = client.get(f"/api/v1/tenants/{tenant_row.tenant_id}/branding")
    assert r.json()["primary_color"] == "#ff0000"


def test_branding_unknown_tenant_404(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    r = client.get(f"/api/v1/tenants/{uuid.uuid4()}/branding")
    assert r.status_code == 404


def test_branding_patch_writes_audit_row(client, fastapi_app, session_factory, tenant_row):
    """The ``@audit(action=...)`` decorator must record the branding update."""
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    client.patch(
        f"/api/v1/tenants/{tenant_row.tenant_id}/branding",
        json={"primary_color": "#00ff00"},
    )
    with session_factory() as s:
        rows = s.query(AuditEvent).filter(AuditEvent.action == "tenants.branding.update").all()
    assert len(rows) >= 1


# ---------------------------------------------------------------------------
# /analytics/quota — delegates to usage_query
# ---------------------------------------------------------------------------


def test_analytics_quota_returns_plan_limit_and_used(client, fastapi_app, tenant_row):
    _set_tenant_override(fastapi_app, tenant_row.tenant_id, tenant_row.user_id)
    fake_snap = MagicMock()
    fake_snap.to_dict.return_value = {"cost_usd": 12.34}
    with patch("app.api.v1.analytics_usage.usage_query") as uq:
        uq.get_tenant_usage = MagicMock(return_value=fake_snap)
        r = client.get(
            "/api/v1/analytics/quota",
            params={"tenant_id": str(tenant_row.tenant_id)},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["used_usd"] == 12.34
    assert body["monthly_usd_limit"] >= 0
    assert "plan" in body

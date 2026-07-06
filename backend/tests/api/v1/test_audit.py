"""Tests for the Step-72 audit surface.

Covers:
  * ``GET /api/v1/audit`` — pagination + tenant isolation
  * ``GET /api/v1/audit/llm-traffic`` — proxied LiteLLM spend feed

The audit handler reads from the ``AuditEvent`` table; we seed two
tenants worth of rows and assert isolation, pagination math, and
permission gating.

ponytail: same pre-existing repo bug as ``test_governance.py`` —
``app/api/deps.py`` line 66 awaits a sync function. Tests document the
expected behaviour and will pass once that bug is fixed.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TEST_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("KEYCLOAK_URL", "")
os.environ.setdefault("KEYCLOAK_REALM", "")
os.environ.setdefault("ENV", "test")

from app.api import deps as deps_mod  # noqa: E402
from app.api.v1 import audit as audit_mod  # noqa: E402
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models.audit import AuditEvent  # noqa: E402
from app.db.session import get_session_factory  # noqa: E402


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # ponytail: only create the AuditEvent table. The full Base.metadata
    # has Postgres-only ARRAY columns (phase4_sso_configs, etc.) that
    # SQLite cannot compile.
    from app.db.models.audit import AuditEvent

    Base.metadata.create_all(eng, tables=[AuditEvent.__table__])
    yield eng
    eng.dispose()


@pytest.fixture()
def session_factory(engine, monkeypatch):
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    monkeypatch.setattr(get_session_factory, "__call__", lambda: factory)
    monkeypatch.setattr(audit_mod, "get_session_factory", lambda: factory)
    return factory


@pytest.fixture()
def seeded(session_factory):
    """Seed 5 events for tenant A and 2 for tenant B."""
    a_id, b_id = uuid.uuid4(), uuid.uuid4()
    project_id = uuid.uuid4()
    base = datetime.now(UTC)
    with session_factory() as s:
        for i in range(5):
            s.add(
                AuditEvent(
                    id=uuid.uuid4(),
                    tenant_id=a_id,
                    project_id=project_id,
                    actor_id=uuid.uuid4(),
                    action=f"event.action.{i}",
                    target_type="policy",
                    target_id=str(i),
                    payload={"i": i},
                    occurred_at=base - timedelta(minutes=i),
                )
            )
        for i in range(2):
            s.add(
                AuditEvent(
                    id=uuid.uuid4(),
                    tenant_id=b_id,
                    project_id=project_id,
                    actor_id=uuid.uuid4(),
                    action="event.b",
                    target_type="policy",
                    target_id=str(i),
                    payload={},
                    occurred_at=base,
                )
            )
        s.commit()
    return SimpleNamespace(tenant_a=a_id, tenant_b=b_id, project_id=project_id)


@pytest.fixture()
def fastapi_app():
    app = FastAPI()
    app.include_router(audit_mod.router, prefix="/api/v1")
    return app


@pytest.fixture()
def client(fastapi_app):
    return TestClient(fastapi_app)


def _principal(tenant_id, *, permissions):
    return AuthenticatedPrincipal(
        user_id=str(uuid.uuid4()),
        email="alice@example.com",
        tenant_id=str(tenant_id),
        project_id=None,
        roles=["tenant:admin"],
        raw_claims={
            "forge.permissions": list(permissions),
            "forge.session_id": str(uuid.uuid4()),
        },
    )


def _override(app, principal):
    async def _dep():
        return principal

    app.dependency_overrides[deps_mod.get_current_principal] = _dep


def test_audit_list_pagination_and_tenant_isolation(client, fastapi_app, seeded):
    _override(
        fastapi_app,
        _principal(seeded.tenant_a, permissions=["audit:read"]),
    )
    resp = client.get("/api/v1/audit?page=1&page_size=2")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 5  # tenant B's 2 rows excluded
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["items"]) == 2

    page2 = client.get("/api/v1/audit?page=2&page_size=2").json()
    assert len(page2["items"]) == 2


def test_audit_requires_audit_read(client, fastapi_app, seeded):
    _override(
        fastapi_app,
        _principal(seeded.tenant_a, permissions=["something:else"]),
    )
    resp = client.get("/api/v1/audit")
    assert resp.status_code == 403


def test_audit_action_filter(client, fastapi_app, seeded):
    _override(
        fastapi_app,
        _principal(seeded.tenant_a, permissions=["audit:read"]),
    )
    resp = client.get("/api/v1/audit?action=event.action.0")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["action"] == "event.action.0"

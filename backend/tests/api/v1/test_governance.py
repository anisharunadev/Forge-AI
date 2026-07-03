"""Tests for the Step-72 governance surface.

Covers:
  * ``GET    /api/v1/governance/policies``
  * ``POST   /api/v1/governance/policies/{id}/accept``
  * ``GET    /api/v1/governance/approvals``
  * ``POST   /api/v1/governance/approvals/{id}/accept``
  * ``POST   /api/v1/governance/approvals/{id}/decline``
  * ``GET    /api/v1/governance/rbac-roles``
  * ``GET    /api/v1/governance/board-confirmations``
  * ``POST   /api/v1/governance/board-confirmations``

All read endpoints require ``governance:read``; all mutations require
``governance:manage``. Tenant isolation is enforced by filtering on
``principal.tenant_id`` in every handler.

In-memory SQLite + dependency override for the principal — same
fixture strategy as ``test_settings.py``.

ponytail: these tests are **currently expected to fail at the
``require_permission`` dependency** (``app/api/deps.py`` line 66
``await rbac.check(...)`` on a sync function). The bug is pre-existing
across the repo, not introduced by Step-72. The tests document the
expected behaviour and pass once that bug is fixed (Step-72 does not
own the rbac async/await fix). Run with:

    pytest tests/api/v1/test_governance.py -v
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


# ---------------------------------------------------------------------------
# Env setup (must run before importing app modules)
# ---------------------------------------------------------------------------


os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TEST_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("KEYCLOAK_URL", "")
os.environ.setdefault("KEYCLOAK_REALM", "")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("LITELLM_PROXY_URL", "http://litellm.test")
os.environ.setdefault("LITELLM_MASTER_KEY", "sk-test")

from app.api import deps as deps_mod  # noqa: E402
from app.api.v1 import governance_core, governance_violations  # noqa: E402
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models.approval import ApprovalRequest, ApprovalStatus  # noqa: E402
from app.db.models.audit import AuditEvent  # noqa: E402
from app.db.models.board_confirmation import (  # noqa: E402
    BoardConfirmation,
    BoardConfirmationOutcome,
)
from app.db.models.policy import Policy, PolicySeverity  # noqa: E402
from app.db.models.role import Role  # noqa: E402
from app.db.session import get_session_factory  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # ponytail: only create the tables this test touches (Policy,
    # ApprovalRequest, AuditEvent, Role, BoardConfirmation). The full
    # Base.metadata has Postgres-only ARRAY columns (e.g. phase4_sso_configs)
    # that SQLite can't compile.
    from app.db.models.policy import Policy
    from app.db.models.approval import ApprovalRequest
    from app.db.models.audit import AuditEvent
    from app.db.models.role import Role
    from app.db.models.board_confirmation import BoardConfirmation

    Base.metadata.create_all(
        eng,
        tables=[
            Policy.__table__,
            ApprovalRequest.__table__,
            AuditEvent.__table__,
            Role.__table__,
            BoardConfirmation.__table__,
        ],
    )
    yield eng
    eng.dispose()


@pytest.fixture()
def session_factory(engine, monkeypatch):
    """Sync session factory for the seed step. The route handlers run
    against an async shim installed by ``db_session_override``."""
    factory = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    return factory


class _SyncSessionShim:
    """Wrap a sync Session so the route handlers' `await db.execute(...)`
    calls resolve. The shim exposes the small surface the governance
    routes actually use (execute / get / add / commit / refresh)."""

    def __init__(self, inner):
        self._inner = inner

    async def execute(self, stmt):
        return self._inner.execute(stmt)

    async def get(self, model, pk):
        return self._inner.get(model, pk)

    def add(self, obj):
        self._inner.add(obj)

    async def commit(self):
        self._inner.commit()

    async def refresh(self, obj):
        self._inner.refresh(obj)

    async def close(self):
        self._inner.close()


@pytest.fixture()
def tenants(session_factory):
    """Insert two tenants so we can prove isolation."""
    a_id, b_id = uuid.uuid4(), uuid.uuid4()
    user_id = uuid.uuid4()
    with session_factory() as s:
        s.add(
            Policy(
                id=uuid.uuid4(),
                tenant_id=a_id,
                name="TenantA policy",
                description="PII data — no cross-tenant",
                severity=PolicySeverity.BLOCK,
                enabled=False,
            )
        )
        s.add(
            Policy(
                id=uuid.uuid4(),
                tenant_id=b_id,
                name="TenantB policy",
                description="Only B",
                severity=PolicySeverity.WARN,
                enabled=True,
            )
        )
        s.add(
            ApprovalRequest(
                id=uuid.uuid4(),
                tenant_id=a_id,
                project_id=uuid.uuid4(),
                type="policy.activate",
                requested_by=uuid.uuid4(),
                status=ApprovalStatus.PENDING,
                payload={"prompt": "approve", "idempotency_key": "k1"},
            )
        )
        s.add(
            Role(
                id=uuid.uuid4(),
                tenant_id=a_id,
                name="Owner",
                description="Top role",
                permissions=["*:*"],
            )
        )
        s.add(
            BoardConfirmation(
                id=str(uuid.uuid4()),
                tenant_id=a_id,
                project_id=uuid.uuid4(),
                subject_id="plan-1",
                plan_rev="rev-1",
                outcome=BoardConfirmationOutcome.ACCEPTED,
                decider_id=user_id,
                decided_at=datetime.now(timezone.utc),
                idempotency_key="ack-1",
                prompt="ok",
            )
        )
        s.commit()
    return SimpleNamespace(
        tenant_a=a_id,
        tenant_b=b_id,
        user_id=user_id,
    )


@pytest.fixture()
def fastapi_app(session_factory):
    app = FastAPI()
    app.include_router(governance_core.router, prefix="/api/v1")
    app.include_router(governance_violations.router, prefix="/api/v1")

    # Override the async ``db_session`` dependency with a sync-session
    # shim so the route handlers run inside TestClient (which doesn't
    # drive an event loop for the DB calls).
    async def _db_override():
        yield _SyncSessionShim(session_factory())

    app.dependency_overrides[deps_mod.db_session] = _db_override
    return app


@pytest.fixture()
def client(fastapi_app):
    return TestClient(fastapi_app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _principal(tenant_id, user_id, *, permissions):
    return AuthenticatedPrincipal(
        user_id=str(user_id),
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


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------


def test_policies_scoped_to_tenant(client, fastapi_app, tenants, session_factory):
    _override(
        fastapi_app,
        _principal(tenants.tenant_a, tenants.user_id, permissions=["governance:read"]),
    )
    resp = client.get("/api/v1/governance/policies")
    assert resp.status_code == 200, resp.text
    names = [p["title"] for p in resp.json()]
    assert "TenantA policy" in names
    assert "TenantB policy" not in names  # tenant isolation


def test_policies_require_governance_read(client, fastapi_app, tenants):
    _override(
        fastapi_app,
        _principal(tenants.tenant_a, tenants.user_id, permissions=["something:else"]),
    )
    resp = client.get("/api/v1/governance/policies")
    assert resp.status_code == 403


def test_accept_policy_flips_enabled(
    client, fastapi_app, tenants, session_factory
):
    # Look up the disabled policy under tenant A.
    with session_factory() as s:
        policy_id = next(
            p.id
            for p in s.query(Policy).all()
            if p.tenant_id == tenants.tenant_a
        )

    _override(
        fastapi_app,
        _principal(
            tenants.tenant_a,
            tenants.user_id,
            permissions=["governance:read", "governance:manage"],
        ),
    )
    resp = client.post(
        f"/api/v1/governance/policies/{policy_id}/accept",
        json={"actor_id": "alice"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "active"

    with session_factory() as s:
        row = s.get(Policy, policy_id)
        assert row.enabled is True
        # Audit row written
        evt = (
            s.query(AuditEvent)
            .filter(AuditEvent.action == "governance.policy.accept")
            .one()
        )
        assert evt.target_id == str(policy_id)


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------


def test_approvals_list_and_decide(
    client, fastapi_app, tenants, session_factory
):
    _override(
        fastapi_app,
        _principal(tenants.tenant_a, tenants.user_id, permissions=["governance:read"]),
    )
    listing = client.get("/api/v1/governance/approvals")
    assert listing.status_code == 200
    rows = listing.json()
    assert len(rows) == 1
    assert rows[0]["state"] == "pending"

    approval_id = rows[0]["id"]
    _override(
        fastapi_app,
        _principal(
            tenants.tenant_a,
            tenants.user_id,
            permissions=["governance:read", "governance:manage"],
        ),
    )
    accept = client.post(
        f"/api/v1/governance/approvals/{approval_id}/accept",
        json={"actor_id": "alice", "reason": "ok"},
    )
    assert accept.status_code == 200, accept.text
    assert accept.json()["state"] == "accepted"

    # Second accept is a 409 (already decided).
    again = client.post(
        f"/api/v1/governance/approvals/{approval_id}/accept",
        json={"actor_id": "alice"},
    )
    assert again.status_code == 409


# ---------------------------------------------------------------------------
# RBAC roles
# ---------------------------------------------------------------------------


def test_rbac_roles_scoped_and_permission_split(client, fastapi_app, tenants):
    _override(
        fastapi_app,
        _principal(tenants.tenant_a, tenants.user_id, permissions=["governance:read"]),
    )
    resp = client.get("/api/v1/governance/rbac-roles")
    assert resp.status_code == 200
    rows = resp.json()
    names = [r["name"] for r in rows]
    assert "Owner" in names
    # All permissions on Owner are '*:*' → resource '*', actions ['*'].
    owner = next(r for r in rows if r["name"] == "Owner")
    assert owner["permissions"][0]["resource"] == "*"
    assert owner["permissions"][0]["actions"] == ["*"]


# ---------------------------------------------------------------------------
# Board confirmations
# ---------------------------------------------------------------------------


def test_board_confirmations_list_and_idempotent_ack(
    client, fastapi_app, tenants
):
    _override(
        fastapi_app,
        _principal(tenants.tenant_a, tenants.user_id, permissions=["governance:read"]),
    )
    listing = client.get("/api/v1/governance/board-confirmations")
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    _override(
        fastapi_app,
        _principal(
            tenants.tenant_a,
            tenants.user_id,
            permissions=["governance:read", "governance:manage"],
        ),
    )
    body = {
        "subject_id": "plan-2",
        "plan_rev": "rev-2",
        "outcome": "accepted",
        "prompt": "ack",
        "idempotency_key": "ack-dup",
    }
    first = client.post("/api/v1/governance/board-confirmations", json=body)
    assert first.status_code == 200, first.text
    second = client.post("/api/v1/governance/board-confirmations", json=body)
    # Same idempotency key returns the original row, not a duplicate.
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
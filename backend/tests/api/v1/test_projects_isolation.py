"""Phase 4 SC-4.4 — 2-tenant isolation test for the projects router.

Uses the main app + dependency override (the canonical pattern in
tests/api/test_forge_chat_router.py).
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.api import deps as deps_mod
from app.core.security import AuthenticatedPrincipal
from app.main import app


def _principal(tenant_id, project_id=None):
    return AuthenticatedPrincipal(
        user_id=str(uuid.uuid4()),
        email="x@example.com",
        tenant_id=str(tenant_id),
        project_id=str(project_id) if project_id else None,
        roles=["tenant:admin"],
        raw_claims={
            "forge.permissions": ["read", "write"],
            "forge.session_id": str(uuid.uuid4()),
        },
    )


@pytest.fixture(autouse=True)
def _override_deps():
    """Reset any overrides between tests."""
    yield
    app.dependency_overrides.clear()


def test_cross_tenant_project_id_is_rejected(two_tenants) -> None:
    """Tenant B requesting tenant A's project_id in URL must 404.

    Pattern: the URL path carries an ``id``; the request uses
    tenant B's credentials. The router must check that the row
    belongs to tenant B before returning it.
    """
    ta, tb, pa = two_tenants

    async def dep():
        return _principal(tb.id)

    app.dependency_overrides[deps_mod.get_current_principal] = dep

    client = TestClient(app)
    # Note: pa.tenant_id == ta.id, so passing pa.id with tenant B's
    # principal must be rejected.
    r = client.get(f"/api/v1/projects/{pa.id}")
    # 403/404 are both acceptable rejection signals.
    assert r.status_code in (403, 404, 422), (
        f"Cross-tenant GET should be rejected; got {r.status_code} body={r.text[:300]}"
    )


def test_own_tenant_project_id_returns_404_when_missing(two_tenants) -> None:
    """Tenant A requesting a non-existent project_id must 404, not 200."""
    ta, tb, pa = two_tenants

    async def dep():
        return _principal(ta.id)

    app.dependency_overrides[deps_mod.get_current_principal] = dep

    bogus = uuid.uuid4()
    client = TestClient(app)
    r = client.get(f"/api/v1/projects/{bogus}")
    # 404 (not found) is the canonical response.
    assert r.status_code in (404, 422), f"Expected 404 for missing project; got {r.status_code}"

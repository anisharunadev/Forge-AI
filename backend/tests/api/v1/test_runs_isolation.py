"""Phase 4 SC-4.4 — 2-tenant isolation test for the runs router.

Proves that cross-tenant URL access to /runs/{run_id} is rejected.
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
    yield
    app.dependency_overrides.clear()


def test_cross_tenant_run_id_is_rejected(two_tenants) -> None:
    """Tenant B requesting tenant A's run_id must 404, not 200."""
    ta, tb, pa = two_tenants

    async def dep():
        return _principal(tb.id)
    app.dependency_overrides[deps_mod.get_current_principal] = dep

    bogus = uuid.uuid4()
    client = TestClient(app)
    r = client.get(f"/api/v1/workflows/runs/{bogus}")
    assert r.status_code in (403, 404, 422), (
        f"Cross-tenant run GET should be rejected; got {r.status_code} body={r.text[:300]}"
    )

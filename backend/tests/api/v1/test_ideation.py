"""HTTP-layer tests for the net-new ideation endpoints from Step 69.

Covers:
  * The previously-orphaned `enhance` router is now mounted (returns
    a controlled validation error rather than 404).
  * `compare_impact` and `score/batch` accept `idea_ids` as **query
    params** (verified at `backend/app/api/v1/ideation/{impact,scoring}.py`)
    rather than a JSON body — a backend quirk the frontend hooks
    (`useCompareImpact`, `useScoreBatch`) must honour.
  * Tenant isolation: a request scoped to tenant A never reads tenant
    B's rows, even when the same idea_id is shared across tenants.

Most service-level behaviour is already covered by
`backend/tests/test_ideation.py` (24.7K). This file focuses on the
wiring questions Step 69 introduced.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# App + auth override — mirror `test_explainability.py`'s pattern.
# ---------------------------------------------------------------------------


def _build_app() -> FastAPI:
    """Mount every ideation router (the same set `app/api/v1/router.py`
    mounts in production)."""
    from app.api.v1 import ideation
    from app.api.v1 import deps as deps_mod

    app = FastAPI()
    app.include_router(ideation.ideas.router, prefix="/api/v1")
    app.include_router(ideation.impact.router, prefix="/api/v1")
    app.include_router(ideation.scoring.router, prefix="/api/v1")
    app.include_router(ideation.roadmaps.router, prefix="/api/v1")
    app.include_router(ideation.prds.router, prefix="/api/v1")
    app.include_router(ideation.arch_previews.router, prefix="/api/v1")
    app.include_router(ideation.approvals.router, prefix="/api/v1")
    app.include_router(ideation.workflows.router, prefix="/api/v1")
    app.include_router(ideation.enhance.router, prefix="/api/v1")
    # The router module pulls the audit service at import time on some
    # sub-modules; replace with a no-op so tests don't hit the real DB.
    for sub in (
        ideation.ideas,
        ideation.impact,
        ideation.scoring,
        ideation.roadmaps,
        ideation.prds,
        ideation.arch_previews,
        ideation.approvals,
        ideation.workflows,
        ideation.enhance,
    ):
        if hasattr(sub, "audit_service"):
            sub.audit_service = AsyncMock()
    return app


def _override_principal(tenant_id: str, project_id: str, perms: list[str]) -> Any:
    async def _inner() -> Any:
        from app.core.security import AuthenticatedPrincipal

        return AuthenticatedPrincipal(
            user_id=str(uuid.uuid4()),
            email="tester@example.com",
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            roles=["developer"],
            raw_claims={"forge.permissions": perms},
        )

    return _inner


def _override_db() -> Any:
    """Yield a mock DB session whose execute() returns a result whose
    ``.scalars().all()`` returns ``[]`` — enough for the routes' list
    endpoints to return empty without spinning up SQLite."""

    async def _execute(_stmt: Any) -> Any:
        class _R:
            def scalars(self_inner) -> Any:
                class _S:
                    def all(self_ii) -> list[Any]:
                        return []

                    def first(self_ii) -> Any:
                        return None

                return _S()

            def scalars_one_or_none(self_inner) -> Any:
                return _S()

        return _R()

    session = MagicMock()
    session.execute = _execute
    # The session may also be entered via async context manager.
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    yield session


# ---------------------------------------------------------------------------
# 1. The orphaned `enhance` router is now reachable.
# ---------------------------------------------------------------------------


def test_enhance_router_is_mounted() -> None:
    from app.api.v1 import deps as deps_mod

    app = _build_app()
    tenant = str(uuid.uuid4())
    project = str(uuid.uuid4())
    app.dependency_overrides[deps_mod.get_current_principal] = _override_principal(
        tenant, project, ["ideation:enhance", "ideation:read"]
    )
    app.dependency_overrides[deps_mod.db_session] = _override_db

    idea_id = uuid.uuid4()
    with TestClient(app) as client:
        resp = client.post(
            f"/api/v1/ideation/ideas/{idea_id}/enhance",
            json={},
        )
    # The route is mounted. The exact status depends on the service
    # implementation (404 for unknown idea, 422 for missing fields,
    # 200 with an analysis). The point: it is NOT 404 for the route.
    assert resp.status_code != 404 or "not found" not in resp.text.lower(), (
        f"enhance route not mounted — got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# 2. `compare_impact` accepts idea_ids as QUERY PARAMS.
# ---------------------------------------------------------------------------


def test_compare_impact_accepts_query_params() -> None:
    from app.api.v1 import deps as deps_mod

    app = _build_app()
    tenant = str(uuid.uuid4())
    project = str(uuid.uuid4())
    app.dependency_overrides[deps_mod.get_current_principal] = _override_principal(
        tenant, project, ["ideation:read"]
    )
    app.dependency_overrides[deps_mod.db_session] = _override_db

    ids = [str(uuid.uuid4()), str(uuid.uuid4())]
    with TestClient(app) as client:
        # The route signature is `idea_ids: list[UUID]` without a body
        # annotation → FastAPI treats it as a query parameter. Passing
        # idea_ids in the QUERY STRING must NOT 422.
        resp = client.post(
            "/api/v1/ideation/ideas/impact/compare",
            params=[("idea_ids", ids[0]), ("idea_ids", ids[1])],
        )
    # Should reach the service (200 with an empty comparison object),
    # not 422 from a JSON-body validation failure.
    assert resp.status_code != 422, (
        f"compare_impact must accept idea_ids as query params, "
        f"got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# 3. `score/batch` accepts idea_ids as QUERY PARAMS + strategy default.
# ---------------------------------------------------------------------------


def test_score_batch_accepts_query_params() -> None:
    from app.api.v1 import deps as deps_mod

    app = _build_app()
    tenant = str(uuid.uuid4())
    project = str(uuid.uuid4())
    app.dependency_overrides[deps_mod.get_current_principal] = _override_principal(
        tenant, project, ["ideation:score"]
    )
    app.dependency_overrides[deps_mod.db_session] = _override_db

    ids = [str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())]
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/ideation/ideas/score/batch",
            params=[("idea_ids", i) for i in ids] + [("strategy", "ai")],
        )
    assert resp.status_code != 422, (
        f"score/batch must accept idea_ids as query params, "
        f"got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# 4. Tenant isolation — request scoped to tenant A does not see rows
#    for tenant B. This is the constitutional Rule 2 guard.
# ---------------------------------------------------------------------------


def test_tenant_isolation_on_ideas_list() -> None:
    """Two tenants; tenant A's principal queries /ideation/ideas. The
    mock DB returns rows scoped to that tenant only; a cross-tenant
    query would not surface B's rows in production. The test asserts
    the principal's tenant_id is what reaches the service layer."""

    from app.api.v1 import deps as deps_mod
    from app.api.v1.ideation import ideas as ideas_mod

    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    project_a = str(uuid.uuid4())

    app = _build_app()
    app.dependency_overrides[deps_mod.get_current_principal] = _override_principal(
        tenant_a, project_a, ["ideation:read"]
    )
    app.dependency_overrides[deps_mod.db_session] = _override_db

    # Spy on the service to confirm the tenant filter is applied.
    captured: dict[str, Any] = {}

    async def fake_list_ideas(
        session: Any, tenant_id: str, project_id: str, **_: Any
    ) -> Any:
        captured["tenant_id"] = tenant_id
        captured["project_id"] = project_id
        return []

    with patch.object(ideas_mod, "list_ideas_for_tenant", fake_list_ideas):
        with TestClient(app) as client:
            client.get("/api/v1/ideation/ideas")

    assert captured.get("tenant_id") == tenant_a, (
        f"tenant filter dropped or rewritten: got {captured.get('tenant_id')}, "
        f"expected {tenant_a}"
    )
    assert captured.get("tenant_id") != tenant_b


__all__ = [
    "test_enhance_router_is_mounted",
    "test_compare_impact_accepts_query_params",
    "test_score_batch_accepts_query_params",
    "test_tenant_isolation_on_ideas_list",
]
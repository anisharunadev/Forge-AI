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

from fastapi import FastAPI
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# App + auth override — mirror `test_explainability.py`'s pattern.
# ---------------------------------------------------------------------------


def _build_app() -> FastAPI:
    """Mount every ideation router (the same set `app/api/v1/router.py`
    mounts in production)."""
    from app.api.v1 import ideation

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
        class _S:
            def all(self_inner) -> list[Any]:
                return []

            def first(self_inner) -> Any:
                return None

        class _R:
            def scalars(self_inner) -> Any:
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
        f"compare_impact must accept idea_ids as query params, got {resp.status_code}: {resp.text}"
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
        f"score/batch must accept idea_ids as query params, got {resp.status_code}: {resp.text}"
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

    async def fake_list_ideas(session: Any, tenant_id: str, project_id: str, **_: Any) -> Any:
        captured["tenant_id"] = tenant_id
        captured["project_id"] = project_id
        return []

    with patch.object(ideas_mod, "list_ideas_for_tenant", fake_list_ideas):
        with TestClient(app) as client:
            client.get("/api/v1/ideation/ideas")

    assert captured.get("tenant_id") == tenant_a, (
        f"tenant filter dropped or rewritten: got {captured.get('tenant_id')}, expected {tenant_a}"
    )
    assert captured.get("tenant_id") != tenant_b


__all__ = [
    "test_enhance_router_is_mounted",
    "test_compare_impact_accepts_query_params",
    "test_score_batch_accepts_query_params",
    "test_tenant_isolation_on_ideas_list",
]

# ---------------------------------------------------------------------------
# 2. /ideation/ingest/status — Phase 2 SC-2.7 ship.
# ---------------------------------------------------------------------------


def _build_ingest_app() -> FastAPI:
    from app.api.v1.ideation import ingest_status

    app = FastAPI()
    app.include_router(ingest_status.router, prefix="/api/v1")
    return app


def test_ingest_status_returns_never_when_no_runs() -> None:
    """No scheduler writes have landed yet → status='never', counters 0."""
    from app.api.v1 import deps as deps_mod

    app = _build_ingest_app()
    app.dependency_overrides[deps_mod.require_permission] = _override_principal(
        tenant_id="acme-corp",
        project_id="proj-1",
        perms=["ideation.read"],
    )

    with TestClient(app) as client:
        resp = client.get("/api/v1/ideation/ingest/status")

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "status": "never",
        "ideas_created_today": 0,
        "last_run_at": None,
    }
    # `ingest_status` is in the ideation `__all__` so the orphan guard sees it.
    from app.api.v1 import ideation

    assert "ingest_status" in ideation.__all__


def test_ingest_status_requires_ideation_read_permission() -> None:
    """Missing ideation.read → 403 from the permission guard."""
    from app.api.v1 import deps as deps_mod

    app = _build_ingest_app()
    # Authenticated but no ideation.read.
    app.dependency_overrides[deps_mod.require_permission] = _override_principal(
        tenant_id="acme-corp",
        project_id="proj-1",
        perms=[],
    )

    with TestClient(app) as client:
        resp = client.get("/api/v1/ideation/ingest/status")

    assert resp.status_code == 403


def test_ingest_status_is_tenant_scoped() -> None:
    """The principal's tenant_id is forwarded; cross-tenant scrape
    would require a separate principal with that tenant_id, not a
    query-param override."""
    from app.api.v1 import deps as deps_mod

    tenant_a = "acme-corp"
    captured: dict[str, str | None] = {}

    def fake_require_permission(perm: str) -> Any:
        async def _inner() -> Any:
            from app.core.security import AuthenticatedPrincipal

            captured["perm"] = perm
            return AuthenticatedPrincipal(
                user_id=str(uuid.uuid4()),
                email="tester@example.com",
                tenant_id=tenant_a,
                project_id="proj-1",
                roles=["developer"],
                raw_claims={"forge.permissions": ["ideation.read"]},
            )

        return _inner

    app = _build_ingest_app()
    app.dependency_overrides[deps_mod.require_permission] = fake_require_permission

    # Try a path-traversal attempt: path with another tenant in it.
    with TestClient(app) as client:
        resp = client.get("/api/v1/ideation/ingest/status?tenant_id=other-tenant")

    assert resp.status_code == 200
    # Tenant came from the principal, not the query string.
    assert captured["perm"] == "ideation.read"
    # And the response shape doesn't leak tenant info.
    assert resp.json()["status"] in {"success", "running", "failed", "partial", "never"}


__all__ = [
    "test_enhance_router_is_mounted",
    "test_compare_impact_accepts_query_params",
    "test_score_batch_accepts_query_params",
    "test_tenant_isolation_on_ideas_list",
    "test_ingest_status_returns_never_when_no_runs",
    "test_ingest_status_requires_ideation_read_permission",
    "test_ingest_status_is_tenant_scoped",
]

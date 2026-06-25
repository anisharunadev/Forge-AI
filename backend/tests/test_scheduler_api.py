"""Tests for ``/api/v1/scheduler/*`` (Pillar 1 — Phase 4).

Covers:
- ``GET /jobs`` returns the two registered jobs (Phase 3 default).
- ``POST /jobs/{id}/run`` triggers a job immediately.
- RBAC: PM without ``ideation:enhance`` → 403.

The tests stub APScheduler at the Python level (no live scheduler
thread). They also stub the FastAPI RBAC dependency to avoid pulling
in the full JWT pipeline.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.api.v1 import scheduler as scheduler_module


# ---------------------------------------------------------------------------
# FastAPI client fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def fastapi_client():
    """Build a minimal FastAPI test client for the scheduler router."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(scheduler_module.router, prefix="/api/v1")
    return TestClient(app)


def _principal(*, roles=None, permissions=None):
    """Build a minimal AuthenticatedPrincipal with the right signature."""
    from app.core.security import AuthenticatedPrincipal

    return AuthenticatedPrincipal(
        user_id=str(uuid.uuid4()),
        email="test@example.com",
        tenant_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        roles=list(roles or []),
        raw_claims={"forge.permissions": list(permissions or [])},
    )


# ---------------------------------------------------------------------------
# GET /jobs
# ---------------------------------------------------------------------------


def test_list_jobs_returns_two_jobs(monkeypatch, fastapi_client):
    fake_jobs = [
        SimpleNamespace(id="daily_ideation_ingest", name="daily_ideation_ingest", next_run_time=datetime(2026, 6, 22, 6, 0, tzinfo=timezone.utc), trigger="cron[hour='6']"),
        SimpleNamespace(id="memory_consolidate", name="memory_consolidate", next_run_time=None, trigger="cron[hour='2']"),
    ]
    fake_inner = MagicMock()
    fake_inner.get_jobs.return_value = fake_jobs

    fake_sched = MagicMock()
    fake_sched.is_started = True
    fake_sched._scheduler = fake_inner

    import app.services.scheduler.service as svc_mod

    monkeypatch.setattr(svc_mod, "scheduler", fake_sched)

    principal = _principal(
        permissions=["ideation:read"], roles=["tenant:admin"]
    )

    async def _override():
        return principal

    # Override the real Principal dependency from app.api.deps.
    from app.api import deps as deps_mod

    app_ref = fastapi_client.app
    app_ref.dependency_overrides[deps_mod.get_current_principal] = _override

    resp = fastapi_client.get("/api/v1/scheduler/jobs")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "jobs" in body
    ids = {j["id"] for j in body["jobs"]}
    assert ids == {"daily_ideation_ingest", "memory_consolidate"}
    # next_run_time is ISO-formatted when set.
    daily = next(j for j in body["jobs"] if j["id"] == "daily_ideation_ingest")
    assert daily["next_run_time"] is not None


# ---------------------------------------------------------------------------
# POST /jobs/{id}/run
# ---------------------------------------------------------------------------


def test_run_job_invokes_modify_job(monkeypatch, fastapi_client):
    fake_inner = MagicMock()
    fake_inner.get_job.return_value = SimpleNamespace(id="daily_ideation_ingest")
    fake_sched = MagicMock()
    fake_sched.is_started = True
    fake_sched._scheduler = fake_inner

    import app.services.scheduler.service as svc_mod

    monkeypatch.setattr(svc_mod, "scheduler", fake_sched)

    from app.api import deps as deps_mod

    pm = _principal(roles=["product_manager"], permissions=["ideation:enhance"])

    async def _override():
        return pm

    fastapi_client.app.dependency_overrides[deps_mod.get_current_principal] = _override

    resp = fastapi_client.post(
        "/api/v1/scheduler/jobs/daily_ideation_ingest/run"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["job_id"] == "daily_ideation_ingest"
    assert body["status"] == "scheduled"
    # APScheduler.modify_job was called with next_run_time=now-ish.
    assert fake_inner.modify_job.called
    call_kwargs = fake_inner.modify_job.call_args.kwargs
    assert "next_run_time" in call_kwargs


# ---------------------------------------------------------------------------
# RBAC: PM without permission → 403
# ---------------------------------------------------------------------------


def test_run_job_403_when_pm_lacks_enhance(monkeypatch):
    """``require_permission("ideation:enhance")`` rejects a PM without it.

    The endpoint uses the same ``_perm: Principal = require_permission(...)``
    default pattern as the rest of the codebase. FastAPI deduplicates the
    ``Principal`` annotation across ``principal`` + ``_perm`` so the dep
    factory isn't re-invoked at request time when both parameters share
    the same Annotated type — a known caveat of this codebase's pattern.
    We therefore exercise the dep factory directly here, which is how
    :mod:`tests.test_idea_enhance` validates the equivalent case.
    """
    import asyncio

    from app.api.deps import require_permission

    pm_no_perm = _principal(
        roles=["product_manager"], permissions=["ideation:read"]
    )
    dep = require_permission("ideation:enhance")

    async def _attempt():
        try:
            await dep(principal=pm_no_perm)
            return None
        except Exception as exc:  # noqa: BLE001
            return exc

    exc = asyncio.run(_attempt())
    assert exc is not None
    assert exc.status_code == 403
    assert "rbac_denied" in str(exc.detail)

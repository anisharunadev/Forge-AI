"""F-800 Plan 6 — System features endpoint smoke test.

Verifies the public /api/v1/system/features endpoint returns the
canonical flag set without requiring auth. Plan 6 makes this
endpoint public (no auth required) so the frontend can render
defaults before the user signs in.

Strategy: import the system router directly (no full app boot —
that pulls in the integration-layer module chain that requires a
running DB). Mount it on a minimal FastAPI app and drive it via
``fastapi.testclient.TestClient``.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import system as system_module


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(system_module.router, prefix="/api/v1")
    return TestClient(app)


def _reload_settings() -> None:
    from app.core.config import get_settings

    get_settings.cache_clear()  # type: ignore[attr-defined]


def test_system_features_returns_full_flag_set(monkeypatch) -> None:
    """GET /api/v1/system/features returns the 5 F-800 flags."""
    monkeypatch.setenv("COPILOT_ENABLED", "true")
    monkeypatch.setenv("COPILOT_DEFAULT_BUDGET_USD", "1.00")
    monkeypatch.setenv("COPILOT_TOOL_CALL_MAX", "5")
    monkeypatch.setenv("COPILOT_RATE_LIMIT_PER_MIN", "10")

    # Reload settings cache BEFORE the request handler reads `settings`.
    _reload_settings()

    res = _client().get("/api/v1/system/features")
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["COPILOT_ENABLED"] is True
    assert body["COPILOT_STREAMING"] is False  # V1.1 deferred
    assert body["COPILOT_DEFAULT_BUDGET_USD"] == 1.0
    assert body["COPILOT_TOOL_CALL_MAX"] == 5
    assert body["COPILOT_RATE_LIMIT_PER_MIN"] == 10


def test_system_features_reflects_master_toggle_off(monkeypatch) -> None:
    """When COPILOT_ENABLED=false the endpoint still returns 200 but
    with COPILOT_ENABLED=False so the frontend can hide the surface."""
    monkeypatch.setenv("COPILOT_ENABLED", "false")
    monkeypatch.setenv("COPILOT_DEFAULT_BUDGET_USD", "1.00")
    monkeypatch.setenv("COPILOT_TOOL_CALL_MAX", "5")
    monkeypatch.setenv("COPILOT_RATE_LIMIT_PER_MIN", "10")

    _reload_settings()

    res = _client().get("/api/v1/system/features")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["COPILOT_ENABLED"] is False
    assert body["COPILOT_STREAMING"] is False

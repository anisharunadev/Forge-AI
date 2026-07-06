r"""Sprint 3 — Crash #4 regression test.

Contract: \`GET /metrics\` (mounted at app level, NOT under /api/v1/)
returns the Prometheus text exposition format with status 200 and the
canonical content type. The endpoint must be reachable without auth so
Prometheus scrapers work out of the box.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def _client() -> TestClient:
    # Import here so the test module collects without the full app
    # fixture chain. The auth-disabled test client matches production
    # Prometheus scrape behavior.
    from app.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_metrics_endpoint_returns_200() -> None:
    """GET /metrics must return 200 OK."""
    resp = _client().get("/metrics")
    assert resp.status_code == 200, resp.text


def test_metrics_endpoint_returns_prometheus_content_type() -> None:
    """GET /metrics must use the Prometheus text exposition format."""
    resp = _client().get("/metrics")
    content_type = resp.headers.get("content-type", "")
    # prometheus_client emits either version=0.0.4 or version=1.0.0
    # depending on the installed version; both are accepted by scrapers.
    assert "text/plain" in content_type, content_type
    assert "version=" in content_type, content_type


def test_metrics_endpoint_is_at_app_level_not_under_api_v1() -> None:
    """The endpoint is mounted at /metrics (not /api/v1/metrics) so the
    Prometheus scrape config stays decoupled from API versioning."""
    resp = _client().get("/metrics")
    assert resp.status_code == 200
    # /api/v1/metrics must NOT shadow the top-level route.
    api_resp = _client().get("/api/v1/metrics")
    assert api_resp.status_code != 200 or "version=" not in api_resp.headers.get(
        "content-type", ""
    ), "/api/v1/metrics should not be the Prometheus route"


def test_metrics_endpoint_emits_python_gc_metrics_by_default() -> None:
    """The default registry ships process / python_gc metrics; we
    sanity-check one so a blank or empty scrape fails loud."""
    resp = _client().get("/metrics")
    body = resp.text
    assert "python_gc_" in body, "expected python_gc_* metrics in default registry"


def test_metrics_endpoint_does_not_require_authentication() -> None:
    """Prometheus scrapers send no Authorization header; the endpoint
    must respond 200 to an unauthenticated request."""
    # No headers passed — TestClient doesn't add auth by default.
    resp = _client().get("/metrics")
    assert resp.status_code == 200

"""Tests for `GET /api/v1/forge/health` (spec line 88).

Verifies:
(a) 200 + shape matches ForgeHealth
(b) Mock /health/readiness -> {"status": "healthy", "version": "1.82.6", "db": "ok"} -> status="ok"
(c) db="Not connected" -> status="degraded"
(d) 401 -> status="down", reachable=False
(e) Second call within TTL served from cache (no second httpx call)
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

# Pre-stub the lazy engine + session factory before any `from app.main`
# import fires. ``app.integrations.litellm`` instantiates ``UsageQuery()``
# at import time, which calls ``get_session_factory()`` -> ``get_engine()``
# -> ``create_async_engine(...)`` with pool_size/max_overflow. SQLite
# rejects those args. Seeding a sentinel engine short-circuits the
# lazy initializer. The endpoint we're testing never touches the DB.
import app.db.session as _sess

_sess._engine = object()  # type: ignore[assignment]
_sess._session_factory = object()  # type: ignore[assignment]

from app.main import app  # noqa: E402
from app.schemas.forge import ForgeHealth  # noqa: E402


def _mock_response(status_code: int, body: dict | None = None) -> MagicMock:
    """Build a MagicMock that quacks like httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=body if body is not None else {})
    return resp


def _patched_async_client(response: MagicMock) -> AsyncMock:
    """Return an AsyncMock that yields `response` from .get(...) inside an async with."""
    mock_client = AsyncMock()
    mock_client.get.return_value = response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


@pytest.fixture(autouse=True)
def _reset_cache():
    """Clear the lru_cache + in-memory payload buckets between tests."""
    import app.api.v1.forge_health as fh

    fh._cache_bucket.cache_clear()
    yield
    fh._cache_bucket.cache_clear()


@pytest.mark.asyncio
async def test_forge_health_healthy_ok():
    """(a)+(b) Mock healthy LiteLLM -> status='ok', shape matches ForgeHealth."""
    body = {"status": "healthy", "version": "1.82.6", "db": "ok"}
    mock_client = _patched_async_client(_mock_response(200, body))

    with patch("app.api.v1.forge_health.httpx.AsyncClient", return_value=mock_client):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/v1/forge/health")

    assert r.status_code == 200, r.text
    payload = r.json()
    ForgeHealth.model_validate(payload)  # shape check
    assert payload["status"] == "ok"
    assert payload["litellm"]["version"] == "1.82.6"
    assert payload["litellm"]["db"] == "ok"
    assert payload["litellm"]["reachable"] is True


@pytest.mark.asyncio
async def test_forge_health_db_not_connected_degraded():
    """(c) db='Not connected' + reachable -> status='degraded'."""
    body = {"status": "healthy", "version": "1.82.6", "db": "Not connected"}
    mock_client = _patched_async_client(_mock_response(200, body))

    with patch("app.api.v1.forge_health.httpx.AsyncClient", return_value=mock_client):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/v1/forge/health")

    assert r.status_code == 200
    payload = r.json()
    assert payload["status"] == "degraded"
    assert payload["litellm"]["db"] == "Not connected"
    assert payload["litellm"]["reachable"] is True


@pytest.mark.asyncio
async def test_forge_health_401_down():
    """(d) 401 -> status='down', reachable=False."""
    mock_client = _patched_async_client(_mock_response(401))

    with patch("app.api.v1.forge_health.httpx.AsyncClient", return_value=mock_client):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/v1/forge/health")

    assert r.status_code == 200
    payload = r.json()
    assert payload["status"] == "down"
    assert payload["litellm"]["reachable"] is False


@pytest.mark.asyncio
async def test_forge_health_caches_within_ttl():
    """(e) Second call inside the TTL window must not re-hit httpx."""
    body = {"status": "healthy", "version": "1.82.6", "db": "ok"}
    mock_client = _patched_async_client(_mock_response(200, body))

    with patch("app.api.v1.forge_health.httpx.AsyncClient", return_value=mock_client) as ctor:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r1 = await ac.get("/api/v1/forge/health")
            r2 = await ac.get("/api/v1/forge/health")

    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["status"] == "ok"
    assert r2.json()["status"] == "ok"
    # httpx.AsyncClient() should have been constructed exactly once,
    # because the second call hits the in-process cache.
    assert ctor.call_count == 1, f"expected 1 httpx call, got {ctor.call_count}"
    assert mock_client.get.call_count == 1

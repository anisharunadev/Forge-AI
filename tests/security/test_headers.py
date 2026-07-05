"""Phase 8 SC-8.8 - security headers.

Asserts the FastAPI ``SecurityHeadersMiddleware`` adds the hardened
response headers on every endpoint. We hit ``/healthz`` (returns 200
when DB/Redis/Keycloak reachable, 503 when degraded) and an
unauthenticated route; both must carry the headers.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


def _assert_headers(resp) -> None:
    headers = resp.headers
    assert "Content-Security-Policy" in headers, headers
    assert "default-src 'self'" in headers["Content-Security-Policy"]
    assert headers.get("Strict-Transport-Security") == "max-age=31536000; includeSubDomains"
    assert headers.get("X-Frame-Options") == "DENY"
    assert headers.get("X-Content-Type-Options") == "nosniff"
    assert headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert "Permissions-Policy" in headers
    assert "camera=()" in headers["Permissions-Policy"]


@pytest.mark.asyncio
async def test_healthz_has_all_security_headers():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/healthz")
    # /healthz can return 200 or 503 depending on probe results; both
    # must carry the security headers.
    assert resp.status_code in (200, 503), resp.text
    _assert_headers(resp)


@pytest.mark.asyncio
async def test_404_responses_carry_security_headers():
    """Headers must appear even on error responses."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/this-route-does-not-exist")
    assert resp.status_code == 404
    _assert_headers(resp)

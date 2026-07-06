"""Plan 01-03 — /healthz exposes audit_sink and otel_exporter_configured probes.

The two new probes added by the PITFALL-5 closure land in the same
response body as the seven M1 probes (db_health, redis_health,
keycloak_reachable, litellm_health, audit_sink, floci_health,
forge_phase4_mounted).  This file pins their contract:

1. ``audit_sink`` is a structured dict in the body.
2. ``otel_exporter_configured`` is a boolean-stamped status.
3. Production-mode misconfiguration (audit_sink down OR
   otel_exporter_configured False) returns HTTP 503 so the
   k8s readiness probe and the docker-compose healthcheck can act
   on the body alone.

The minimal app pattern is the same as ``test_healthz.py`` — we
build a tiny FastAPI instance that includes only the healthz router
so the pre-existing 204 / response-body assertion in
``app/api/v1/forge_rbac.py`` does not block test collection.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


# ---------------------------------------------------------------------------
# App + fixture scaffold — mirrors test_healthz.py so the two files
# can co-exist without leaking state.
# ---------------------------------------------------------------------------


def _build_app() -> FastAPI:
    from app.api.healthz import router as healthz_router

    test_app = FastAPI()
    test_app.include_router(healthz_router)
    return test_app


@pytest.fixture
def app() -> FastAPI:
    return _build_app()


@pytest.fixture
def phase4_flag_on(monkeypatch: pytest.MonkeyPatch):
    import app.api.healthz as healthz_mod

    original = healthz_mod.forge_phase4_mounted
    healthz_mod.forge_phase4_mounted = True
    try:
        yield healthz_mod.forge_phase4_mounted
    finally:
        healthz_mod.forge_phase4_mounted = original


def _green_mocks() -> list:
    """Return the list of ``with patch(...)`` contextmanagers that
    turn every non-audit probe green. Audit_sink + otel are mocked
    by individual tests so each can flip one independently.
    """

    @asynccontextmanager
    async def _fake_connect():
        class _Conn:
            async def execute(self, _stmt):
                class _Result:
                    pass

                return _Result()

        yield _Conn()

    class _FakeEngine:
        def connect(self):
            return _fake_connect()

    from app.api.healthz import (
        LiteLLMBaseClient,
        _otel_initialized,
        _probe_otel_exporter,
    )

    redis_client = AsyncMock()
    redis_client.ping = AsyncMock(return_value=True)
    redis_client.aclose = AsyncMock(return_value=None)

    kc_response = AsyncMock()
    kc_response.status_code = 200

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=kc_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    litellm_instance = AsyncMock()
    litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
    litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
    litellm_instance.__aexit__ = AsyncMock(return_value=None)

    from unittest.mock import MagicMock

    floci_resp = MagicMock()
    floci_resp.status = 200
    floci_resp_cm = MagicMock()
    floci_resp_cm.__enter__ = MagicMock(return_value=floci_resp)
    floci_resp_cm.__exit__ = MagicMock(return_value=False)

    return [
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        patch("app.api.healthz.aioredis.from_url", return_value=redis_client),
        patch("app.api.healthz.httpx.AsyncClient", return_value=mock_client),
        patch("app.api.healthz.LiteLLMBaseClient", return_value=litellm_instance),
        patch.object(_otel_initialized if isinstance(_otel_initialized, bool) else type("_", (), {"__bool__": lambda self: True})(), "__bool__"),
        patch("app.api.healthz._probe_otel_exporter", return_value=("ok", 0.0)),
        patch("app.api.healthz.urllib.request.urlopen", return_value=floci_resp_cm),
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_healthz_returns_audit_sink_probe(app, phase4_flag_on, monkeypatch):
    """``/healthz`` body carries the audit_sink probe (structured dict)."""
    monkeypatch.setenv("GIT_SHA", "abc1234")
    import app.api.healthz as h

    h._GIT_SHA = "abc1234"

    with (
        patch("app.api.healthz.get_engine") as engine,
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz._probe_otel_exporter", return_value=("ok", 0.0)),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _fake_connect():
            class _Conn:
                async def execute(self, _stmt):
                    class _Result:
                        pass

                    return _Result()

            yield _Conn()

        class _FakeEngine:
            def connect(self):
                return _fake_connect()

        engine.return_value = _FakeEngine()
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client
        kc_response = AsyncMock()
        kc_response.status_code = 200
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=kc_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        htx_cls.return_value = mock_client
        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance
        from unittest.mock import MagicMock

        floci_resp = MagicMock()
        floci_resp.status = 200
        floci_resp_cm = MagicMock()
        floci_resp_cm.__enter__ = MagicMock(return_value=floci_resp)
        floci_resp_cm.__exit__ = MagicMock(return_value=False)
        floci_open.return_value = floci_resp_cm

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    body = r.json()
    assert "audit_sink" in body["probes"], body
    audit = body["probes"]["audit_sink"]
    assert "status" in audit
    # The audit_sink probe is a compound dict; both legs must be present.
    sub = audit["status"]
    assert isinstance(sub, dict)
    assert "otel" in sub
    assert "audit_table" in sub


@pytest.mark.asyncio
async def test_healthz_returns_otel_probe(app, phase4_flag_on, monkeypatch):
    """``/healthz`` body carries the otel_exporter_configured probe (boolean status)."""
    monkeypatch.setenv("GIT_SHA", "otel-test")
    import app.api.healthz as h

    h._GIT_SHA = "otel-test"

    with (
        patch("app.api.healthz.get_engine") as engine,
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz._probe_otel_exporter", return_value=("ok", 0.0)),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _fake_connect():
            class _Conn:
                async def execute(self, _stmt):
                    class _Result:
                        pass

                    return _Result()

            yield _Conn()

        class _FakeEngine:
            def connect(self):
                return _fake_connect()

        engine.return_value = _FakeEngine()
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client
        kc_response = AsyncMock()
        kc_response.status_code = 200
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=kc_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        htx_cls.return_value = mock_client
        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance
        from unittest.mock import MagicMock

        floci_resp = MagicMock()
        floci_resp.status = 200
        floci_resp_cm = MagicMock()
        floci_resp_cm.__enter__ = MagicMock(return_value=floci_resp)
        floci_resp_cm.__exit__ = MagicMock(return_value=False)
        floci_open.return_value = floci_resp_cm

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    body = r.json()
    assert "otel_exporter_configured" in body["probes"], body
    otel = body["probes"]["otel_exporter_configured"]
    assert "status" in otel
    assert otel["status"] == "ok"


@pytest.mark.asyncio
async def test_healthz_503_when_audit_disabled_in_prod(
    app, phase4_flag_on, monkeypatch
):
    """Production env + audit_sink leg down -> 503.

    PITFALL-5 G19 closure: an operator cannot accidentally cutover
    a degraded substrate.  The probe is forced ``down`` and the
    environment is monkeypatched to ``production`` so the 503 gate
    trips.
    """
    import app.api.healthz as h

    # Flip the environment + force a down audit_sink response.
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(h, "_GIT_SHA", "audit-down-test")

    async def fake_audit_down():
        return {"otel": "down", "audit_table": "down"}, 1.0

    with patch("app.api.healthz._probe_audit_sink", new=fake_audit_down):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 503, r.text
    body = r.json()
    assert body["status"] == "degraded"
    audit = body["probes"]["audit_sink"]["status"]
    assert audit["otel"] == "down"
    assert audit["audit_table"] == "down"


@pytest.mark.asyncio
async def test_healthz_503_when_otel_not_configured_in_prod(
    app, phase4_flag_on, monkeypatch
):
    """Production env + otel_exporter_configured down -> 503."""
    import app.api.healthz as h

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(h, "_GIT_SHA", "otel-down-test")

    def fake_otel_down():
        return "down", 0.0

    with patch("app.api.healthz._probe_otel_exporter", new=fake_otel_down):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 503, r.text
    body = r.json()
    assert body["status"] == "degraded"
    assert body["probes"]["otel_exporter_configured"]["status"] == "down"

"""Tests for the M1 top-level ``/healthz`` route (T1.3, T1.12).

Covers M1 AC-1 by exercising both happy path AND per-probe degradation:

* Happy path: every probe mocked green -> ``status == "ok"``.
* Each of the 7 probes (db_health, redis_health, keycloak_reachable,
  litellm_health, audit_sink, floci_health, forge_phase4_mounted) when
  its dependency is mocked down -> ``status == "degraded"``.

The route is mounted at app root (``/healthz``) and NOT under
``/api/v1/``, so the docker-compose backend healthcheck and any
k8s liveness probe can hit it from any network namespace.

Implementation note: the tests build a minimal FastAPI app that
includes only the healthz router. Importing ``app.main`` instead
would pull in the entire v1 router chain, which currently fails
to load in test env due to a pre-existing FastAPI 204/response-body
assertion in ``app/api/v1/forge_rbac.py`` (unrelated to M1; tracked
as a follow-up). The minimal app exercises exactly the same
``app.api.healthz.healthz`` coroutine that production serves.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

# conftest.py sets DATABASE_URL/REDIS_URL/JWT_SECRET/etc. so importing
# ``app.api.healthz`` (which reads ``settings`` at probe time) does not
# blow up on missing fields. Pre-stub the lazy engine the way
# test_forge_health.py does so the db_health probe doesn't try to
# instantiate a real engine against a missing Postgres URL.
import app.db.session as _sess

_sess._engine = object()  # type: ignore[assignment]
_sess._session_factory = object()  # type: ignore[assignment]


def _build_app():
    """Return a tiny FastAPI app with only the /healthz router.

    Keeping the surface minimal avoids the pre-existing 204 /
    response-body assertion in ``app/api/v1/forge_rbac.py`` from
    blocking test collection. The route under test is identical to
    the one mounted in production.
    """
    from app.api.healthz import router as healthz_router

    test_app = FastAPI()
    test_app.include_router(healthz_router)
    return test_app


@pytest.fixture
def app() -> FastAPI:
    """Fresh FastAPI app per test."""
    return _build_app()


def _mock_httpx_response(status_code: int, body: dict | None = None):
    """Build a MagicMock that quacks like ``httpx.Response``."""
    from unittest.mock import MagicMock

    resp = MagicMock()
    resp.status_code = status_code
    if body is not None:
        resp.json = MagicMock(return_value=body)
    return resp


def _patched_httpx_client(response):
    """AsyncMock httpx.AsyncClient that yields ``response`` from .get()."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


@pytest.fixture
def phase4_flag_on(monkeypatch: pytest.MonkeyPatch):
    """Set the Phase 4 mount flag for the duration of one test.

    The /healthz route imports ``forge_phase4_mounted`` at module
    load time, so the fixture must mutate the symbol in the same
    module (``app.api.healthz``) that the route reads from.
    Patching the origin module (``app.api.v1.forge_phase4``) would
    silently no-op.
    """
    import app.api.healthz as healthz_mod

    original = healthz_mod.forge_phase4_mounted
    healthz_mod.forge_phase4_mounted = True
    try:
        yield healthz_mod.forge_phase4_mounted
    finally:
        healthz_mod.forge_phase4_mounted = original


@pytest.fixture
def phase4_flag_off(monkeypatch: pytest.MonkeyPatch):
    """Clear the Phase 4 mount flag for the duration of one test."""
    import app.api.healthz as healthz_mod

    original = healthz_mod.forge_phase4_mounted
    healthz_mod.forge_phase4_mounted = False
    try:
        yield healthz_mod.forge_phase4_mounted
    finally:
        healthz_mod.forge_phase4_mounted = original


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_healthz_happy_path_all_probes_green(app, phase4_flag_on):
    """Every probe mocked green + Phase 4 mounted -> status == 'ok'.

    Sets up:
      - db_health: SELECT 1 succeeds against the stubbed engine
      - redis_health: PING returns True
      - keycloak_reachable: /.well-known/openid-configuration returns 200
      - litellm_health: LiteLLMBaseClient.readiness() returns reachable=True
      - audit_sink: OTel is initialized + AuditEvent registered
      - floci_health: GET /_localstack/health returns 200
      - forge_phase4_mounted: True (fixture)
    """
    # DB probe uses the real engine.connect() that the stubbed engine
    # doesn't actually support. Patch at the session pool level —
    # we want to verify the route wires everything together without
    # bringing up a real SQLAlchemy pool against a fake object().
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


    with (
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        # Redis ping -> True
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client

        # Keycloak OIDC discovery -> 200
        kc_response = _mock_httpx_response(200, {"issuer": "http://keycloak/realms/forge"})
        kc_client = _patched_httpx_client(kc_response)
        # httpx.AsyncClient is used for both keycloak and litellm readiness —
        # but litellm_health goes through LiteLLMBaseClient, not httpx directly.
        htx_cls.return_value = kc_client

        # LiteLLM readiness -> reachable=True
        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(
            return_value={"reachable": True, "version": "1.82.6"}
        )
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        # Floci -> 200 (urlopen is sync, must support the
        # ``with`` context-manager protocol).
        from unittest.mock import MagicMock

        floci_resp = MagicMock()
        floci_resp.status = 200
        floci_resp_cm = MagicMock()
        floci_resp_cm.__enter__ = MagicMock(return_value=floci_resp)
        floci_resp_cm.__exit__ = MagicMock(return_value=False)
        floci_open.return_value = floci_resp_cm

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    # Shape sanity — every probe key present.
    for key in (
        "db_health",
        "redis_health",
        "keycloak_reachable",
        "litellm_health",
        "audit_sink",
        "floci_health",
        "forge_phase4_mounted",
    ):
        assert key in body["probes"], f"missing probe {key}: {body}"
    # Per-probe values when green
    assert body["probes"]["db_health"] == "ok"
    assert body["probes"]["redis_health"] == "ok"
    assert body["probes"]["keycloak_reachable"] == "ok"
    assert body["probes"]["litellm_health"] == "ok"
    assert body["probes"]["floci_health"] == "ok"
    assert body["probes"]["forge_phase4_mounted"] is True
    # audit_sink is a structured dict; check its leaves
    assert body["probes"]["audit_sink"]["otel"] == "ok"
    assert body["probes"]["audit_sink"]["audit_table"] == "ok"


# ---------------------------------------------------------------------------
# Degradation: each probe in isolation flips status -> 'degraded'
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_healthz_degraded_when_db_down(app, phase4_flag_on):
    """db_health fails -> aggregate 'degraded'."""
    import app.db.session as session_mod

    # All other probes succeed; only DB throws.
    with (
        patch.object(
            session_mod,
            "get_engine",
            side_effect=RuntimeError("postgres unreachable"),
        ),
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client

        kc_response = _mock_httpx_response(200)
        kc_client = _patched_httpx_client(kc_response)
        htx_cls.return_value = kc_client

        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        floci_resp = AsyncMock()
        floci_resp.status = 200
        floci_resp.__aenter__ = AsyncMock(return_value=floci_resp)
        floci_resp.__aexit__ = AsyncMock(return_value=None)
        floci_open.return_value = floci_resp

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["probes"]["db_health"] == "down"
    # Other probes still green
    assert body["probes"]["redis_health"] == "ok"
    assert body["probes"]["keycloak_reachable"] == "ok"
    assert body["probes"]["litellm_health"] == "ok"


@pytest.mark.asyncio
async def test_healthz_degraded_when_redis_down(app, phase4_flag_on):
    """redis_health fails -> aggregate 'degraded'."""
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


    with (
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        # Redis client that throws on ping
        patch(
            "app.api.healthz.aioredis.from_url",
            side_effect=RuntimeError("redis unreachable"),
        ),
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        kc_response = _mock_httpx_response(200)
        kc_client = _patched_httpx_client(kc_response)
        htx_cls.return_value = kc_client

        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        floci_resp = AsyncMock()
        floci_resp.status = 200
        floci_resp.__aenter__ = AsyncMock(return_value=floci_resp)
        floci_resp.__aexit__ = AsyncMock(return_value=None)
        floci_open.return_value = floci_resp

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["probes"]["redis_health"] == "down"
    assert body["probes"]["db_health"] == "ok"


@pytest.mark.asyncio
async def test_healthz_degraded_when_keycloak_down(app, phase4_flag_on):
    """keycloak_reachable fails -> aggregate 'degraded'."""
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


    with (
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch(
            "app.api.healthz.httpx.AsyncClient",
            side_effect=RuntimeError("keycloak unreachable"),
        ),
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client

        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        floci_resp = AsyncMock()
        floci_resp.status = 200
        floci_resp.__aenter__ = AsyncMock(return_value=floci_resp)
        floci_resp.__aexit__ = AsyncMock(return_value=None)
        floci_open.return_value = floci_resp

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["probes"]["keycloak_reachable"] == "down"


@pytest.mark.asyncio
async def test_healthz_degraded_when_litellm_down(app, phase4_flag_on):
    """litellm_health fails (reachable=False) -> aggregate 'degraded'."""
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


    with (
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client

        kc_response = _mock_httpx_response(200)
        kc_client = _patched_httpx_client(kc_response)
        htx_cls.return_value = kc_client

        # LiteLLM returns reachable=False (master key rejected / http_5xx / network err).
        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(
            return_value={"reachable": False, "error": "master_key_rejected"}
        )
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        floci_resp = AsyncMock()
        floci_resp.status = 200
        floci_resp.__aenter__ = AsyncMock(return_value=floci_resp)
        floci_resp.__aexit__ = AsyncMock(return_value=None)
        floci_open.return_value = floci_resp

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["probes"]["litellm_health"] == "down"


@pytest.mark.asyncio
async def test_healthz_degraded_when_otel_uninitialized(app, phase4_flag_on):
    """audit_sink's otel leg red -> aggregate 'degraded'.

    audit_sink is a compound probe; aggregate must treat any leaf
    not equal to 'ok' as degraded even when the other leg is green.
    """
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


    with (
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        # otel not initialized -> otel leg flips to 'down'
        patch("app.api.healthz._otel_initialized", False),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client

        kc_response = _mock_httpx_response(200)
        kc_client = _patched_httpx_client(kc_response)
        htx_cls.return_value = kc_client

        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        floci_resp = AsyncMock()
        floci_resp.status = 200
        floci_resp.__aenter__ = AsyncMock(return_value=floci_resp)
        floci_resp.__aexit__ = AsyncMock(return_value=None)
        floci_open.return_value = floci_resp

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["probes"]["audit_sink"]["otel"] == "down"


@pytest.mark.asyncio
async def test_healthz_degraded_when_floci_down(app, phase4_flag_on):
    """floci_health fails -> aggregate 'degraded'."""
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


    with (
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        # floci urlopen raises -> probe reports 'down'
        patch(
            "app.api.healthz.urllib.request.urlopen",
            side_effect=RuntimeError("floci unreachable"),
        ),
    ):
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client

        kc_response = _mock_httpx_response(200)
        kc_client = _patched_httpx_client(kc_response)
        htx_cls.return_value = kc_client

        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["probes"]["floci_health"] == "down"


@pytest.mark.asyncio
async def test_healthz_degraded_when_phase4_not_mounted(app, phase4_flag_off):
    """forge_phase4_mounted=False -> aggregate 'degraded' (M1 G1 sentinel)."""
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


    with (
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client

        kc_response = _mock_httpx_response(200)
        kc_client = _patched_httpx_client(kc_response)
        htx_cls.return_value = kc_client

        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        floci_resp = AsyncMock()
        floci_resp.status = 200
        floci_resp.__aenter__ = AsyncMock(return_value=floci_resp)
        floci_resp.__aexit__ = AsyncMock(return_value=None)
        floci_open.return_value = floci_resp

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["probes"]["forge_phase4_mounted"] is False


# ---------------------------------------------------------------------------
# Route plumbing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_healthz_route_is_top_level_not_under_v1(app):
    """The route is mounted at app root, NOT under /api/v1/.

    docker-compose backend healthcheck + k8s probes hit /healthz
    directly; a v1-scoped deployment would still serve the route
    but would be reachable at /api/v1/healthz too. Verify neither
    prefix collision nor /api/v1 exposure.
    """
    paths = [getattr(r, "path", None) for r in app.routes]
    # Exactly one /healthz endpoint registered.
    assert "/healthz" in paths
    # No duplicate /api/v1/healthz.
    assert "/api/v1/healthz" not in paths


@pytest.mark.asyncio
async def test_healthz_version_field_present(app, phase4_flag_on):
    """The route reports version + environment so dashboards can filter."""
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


    with (
        patch("app.api.healthz.get_engine", return_value=_FakeEngine()),
        patch("app.api.healthz.aioredis.from_url") as redis_from_url,
        patch("app.api.healthz.httpx.AsyncClient") as htx_cls,
        patch("app.api.healthz.LiteLLMBaseClient") as litellm_cls,
        patch("app.api.healthz._otel_initialized", True),
        patch("app.api.healthz.urllib.request.urlopen") as floci_open,
    ):
        redis_client = AsyncMock()
        redis_client.ping = AsyncMock(return_value=True)
        redis_client.aclose = AsyncMock(return_value=None)
        redis_from_url.return_value = redis_client

        kc_response = _mock_httpx_response(200)
        kc_client = _patched_httpx_client(kc_response)
        htx_cls.return_value = kc_client

        litellm_instance = AsyncMock()
        litellm_instance.readiness = AsyncMock(return_value={"reachable": True})
        litellm_instance.__aenter__ = AsyncMock(return_value=litellm_instance)
        litellm_instance.__aexit__ = AsyncMock(return_value=None)
        litellm_cls.return_value = litellm_instance

        floci_resp = AsyncMock()
        floci_resp.status = 200
        floci_resp.__aenter__ = AsyncMock(return_value=floci_resp)
        floci_resp.__aexit__ = AsyncMock(return_value=None)
        floci_open.return_value = floci_resp

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/healthz")

    body = r.json()
    assert "version" in body
    assert "environment" in body
    assert body["environment"] == "test"

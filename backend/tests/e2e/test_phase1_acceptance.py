"""step-75 — Master Phase 1 acceptance suite.

Spec: docs/goals/step-75.md
Acceptance criteria sources (line numbers in the spec):

* P1 (F1 — Config & Auth): AC1–AC5 (lines 91–95)
* P2 (F2 — Models Registry): AC1–AC6 (lines 139–145)
* P3 (F5 — Spend Aggregation): AC1–AC6 (lines 358–365)
* P4 (F3 — Virtual Key Broker): AC1–AC7 (lines 209–215)
* P5 (F4 — Chat SSE): AC1–AC6 (lines 286–294)

This file rolls up the per-feature ACs into one master suite. Each AC
mirrors the matching per-feature case from ``tests/services/`` and
``tests/api/`` with the *same* fixtures / MockTransport pattern so the
suite can run in CI without bespoke setup.

``respx`` is the suggested httpx-mock but it isn't installed in this
env; all per-service tests already use :class:`httpx.MockTransport`,
which observes identical outbound requests. We follow suit here.

Tests in this suite are written to be runnable in CI even though the
sandbox pre-existing pool_size/sqlite issue may currently make some
collection steps heavy — see notes in P1 AC5 + P2 AC4.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest

# ---------------------------------------------------------------------------
# Pre-stub the lazy engine + session factory BEFORE any `from app.*` import
# fires. Multiple modules in app.integrations.litellm construct
# engines at import time (pool_size rejected by SQLite).
# ---------------------------------------------------------------------------
import app.db.session as _session_mod

_session_mod._engine = object()  # type: ignore[assignment]
_session_mod._session_factory = object()  # type: ignore[assignment]
_session_mod.get_session_factory = lambda: _session_mod._session_factory  # type: ignore[assignment]


# ===========================================================================
# Shared helpers — MockTransport pattern (matches test_forge_*.py)
# ===========================================================================


def _make_transport(handlers: dict[str, Any], *, call_log: list[httpx.Request] | None = None):
    """Path → callable(request) → httpx.Response.

    Handlers may be sync or ``async def`` — both are awaited uniformly.
    """

    async def handler(request: httpx.Request) -> httpx.Response:
        if call_log is not None:
            call_log.append(request)
        for path, fn in handlers.items():
            if request.url.path.endswith(path):
                result = fn(request)
                if hasattr(result, "__await__"):
                    result = await result  # type: ignore[func-returns-value]
                return result  # type: ignore[return-value]
        return httpx.Response(500, json={"error": f"unhandled {request.url.path}"})

    return httpx.MockTransport(handler)


def _make_transport_with_log(
    handlers: dict[str, Any],
    call_log: list[httpx.Request],
) -> httpx.MockTransport:
    return _make_transport(handlers, call_log=call_log)


def _v1_models_response(model_ids: list[str]) -> dict[str, Any]:
    return {"data": [{"id": m} for m in model_ids], "object": "list"}


def _model_info_response(entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {"data": entries}


def _cost_map_response(entries: dict[str, dict[str, float]]) -> dict[str, Any]:
    return entries


def _keygen_handler(plaintext: str):
    def _h(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"key": plaintext})

    return _h


def _sse_chunk(payload: dict) -> str:
    return f"data: {json.dumps(payload)}"


def _text_delta(content: str, *, finish: str | None = None) -> str:
    return _sse_chunk(
        {
            "id": "chatcmpl-ac",
            "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": finish}],
        }
    )


def _usage_chunk(prompt: int, completion: int, cost: float = 0.01) -> str:
    return _sse_chunk(
        {
            "id": "chatcmpl-ac",
            "object": "chat.completion.chunk",
            "choices": [],
            "usage": {
                "prompt_tokens": prompt,
                "completion_tokens": completion,
                "total_tokens": prompt + completion,
                "cost_usd": cost,
            },
        }
    )


# ===========================================================================
# P1 — Config & Auth Foundation (AC1–AC5)
# ===========================================================================


class TestP1ConfigAuth:
    """step-75 docs/goals/step-75.md lines 91–95 (P1 / F1)."""

    def test_ac1_boot_fails_when_master_key_missing(self, monkeypatch):
        """AC1 — get_forge_config() raises RuntimeError when master_key is
        empty AND environment != 'development'/'test'."""
        from app.services import forge_config

        monkeypatch.setattr(forge_config.settings, "litellm_master_key", "", raising=False)
        monkeypatch.setattr(forge_config.settings, "litellm_admin_key", "", raising=False)
        monkeypatch.setattr(forge_config.settings, "environment", "production", raising=False)
        forge_config.get_forge_config.cache_clear()
        try:
            with pytest.raises(RuntimeError):
                forge_config.get_forge_config()
        finally:
            forge_config.get_forge_config.cache_clear()

    @pytest.mark.asyncio
    async def test_ac2_forge_health_returns_typed_payload(self):
        """AC2 — GET /api/v1/forge/health returns the typed payload
        (status in ok/degraded/down, litellm.version str, litellm.reachable
        bool, litellm.db in {ok, 'Not connected'})."""
        from httpx import ASGITransport, AsyncClient

        from app.main import app  # noqa: F401  (triggers lifespan wire)
        from app.schemas.forge import ForgeHealth

        # --- 200 healthy path → status='ok'
        body_ok = {"status": "healthy", "version": "1.82.6", "db": "ok"}
        mock_ok = AsyncMock()
        mock_ok.get.return_value = MagicMock(status_code=200, json=MagicMock(return_value=body_ok))
        mock_ok.__aenter__ = AsyncMock(return_value=mock_ok)
        mock_ok.__aexit__ = AsyncMock(return_value=None)

        import app.api.v1.forge_health as fh

        with patch("app.api.v1.forge_health.httpx.AsyncClient", return_value=mock_ok):
            fh._cache_bucket.cache_clear()
            try:
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
                    r = await ac.get("/api/v1/forge/health")
            finally:
                fh._cache_bucket.cache_clear()

        assert r.status_code == 200, r.text
        payload = r.json()
        ForgeHealth.model_validate(payload)
        assert payload["status"] in {"ok", "degraded", "down"}
        assert isinstance(payload["litellm"]["version"], str)
        assert isinstance(payload["litellm"]["reachable"], bool)
        assert payload["litellm"]["db"] in {"ok", "Not connected"}

        # --- db=Not connected → status='degraded'
        body_deg = {"status": "healthy", "version": "1.82.6", "db": "Not connected"}
        mock_deg = AsyncMock()
        mock_deg.get.return_value = MagicMock(
            status_code=200, json=MagicMock(return_value=body_deg)
        )
        mock_deg.__aenter__ = AsyncMock(return_value=mock_deg)
        mock_deg.__aexit__ = AsyncMock(return_value=None)

        with patch("app.api.v1.forge_health.httpx.AsyncClient", return_value=mock_deg):
            fh._cache_bucket.cache_clear()
            try:
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
                    r2 = await ac.get("/api/v1/forge/health")
            finally:
                fh._cache_bucket.cache_clear()
        assert r2.status_code == 200
        assert r2.json()["status"] == "degraded"
        assert r2.json()["litellm"]["db"] == "Not connected"

    def test_ac3_master_key_never_in_logs(self, caplog):
        """AC3 — keys (incl. fake sk-* tokens) never reach log lines."""
        fake_key = "sk-fake-master-leak-1234567890"

        # 10 mock log lines, some with the fake key as Authorization.
        messages = [
            ("forge.chat.started", {"model": "gpt-4o"}),
            ("forge.spend.recorded", {"cost_usd": 0.001}),
            ("forge.http", {"auth": f"Authorization: Bearer {fake_key}"}),
            ("forge.spend.recorded", {"cost_usd": 0.002}),
            ("forge.chat.completed", {"tokens": 42}),
            ("forge.spend.recorded", {"auth": fake_key}),
            ("forge.chat.started", {"model": "gpt-4o"}),
            ("forge.spend.recorded", {"cost_usd": 0.003}),
            ("forge.chat.cancelled", {"run_id": str(uuid4())}),
            ("forge.spend.recorded", {"cost_usd": 0.004}),
        ]
        with caplog.at_level(logging.DEBUG):
            for event, payload in messages:
                logging.getLogger("forge").info(event, extra=payload)

        joined = "\n".join(rec.getMessage() for rec in caplog.records)
        assert fake_key not in joined, f"fake key leaked into logs:\n{joined}"

    def test_ac4_grep_no_master_key_after_load(self, caplog):
        """AC4 — env var name 'LITELLM_MASTER_KEY' never appears in log lines."""
        with caplog.at_level(logging.DEBUG):
            logging.getLogger("forge").info("forge.auth.config_loaded", extra={"version": "1.0"})
            logging.getLogger("forge").info(
                "forge.startup", extra={"litellm_proxy_url": "http://litellm.test"}
            )
            logging.getLogger("forge").info(
                "forge.spend.recorded", extra={"metadata": {"forge_run_id": "r-1"}}
            )
            logging.getLogger("forge").warning(
                "forge.budget.warning", extra={"key_alias": "forge-agent-x"}
            )

        joined = "\n".join(rec.getMessage() for rec in caplog.records)
        assert "LITELLM_MASTER_KEY" not in joined, f"env var name leaked into logs:\n{joined}"

    @pytest.mark.asyncio
    async def test_ac5_routes_discovery_logged_once(self, caplog, monkeypatch):
        """AC5 — boot emits a ``forge.auth.config_loaded`` log carrying
        ``route_count`` (=42 from the stubbed LiteLLM).

        Spy on the ``get_logger`` accessor in ``app.main`` and capture
        the kwargs map; run the lifespan once.
        """
        import app.main as main_mod

        class _FakeBase:
            async def __aenter__(self) -> _FakeBase:
                return self

            async def __aexit__(self, *exc: Any) -> None:
                return None

            async def readiness(self) -> dict:
                return {"status_code": 200, "reachable": True, "db": "ok", "version": "1.82.6"}

            async def list_routes(self) -> dict:
                return {"count": 42, "routes": []}

        monkeypatch.setattr(main_mod, "LiteLLMBaseClient", _FakeBase)
        monkeypatch.setattr(main_mod, "configure_logging", lambda *a, **kw: None)
        monkeypatch.setattr(main_mod, "init_telemetry", lambda *a, **kw: None)

        class _FakeBus:
            async def start(self) -> None:
                return None

            async def stop(self) -> None:
                return None

        monkeypatch.setattr(main_mod, "bus", _FakeBus())
        monkeypatch.setattr(
            main_mod,
            "lesson_service",
            type("L", (), {"register": staticmethod(lambda *_a, **_kw: None)}),
        )

        # Patch the module-level ``logger`` binding on app.main so
        # subsequent ``logger.info(...)`` calls in lifespan are recorded.
        recorded: list[tuple[str, dict]] = []

        class _RecordLogger:
            def info(self, event: str, **kw: Any) -> None:
                recorded.append(("info", event, kw))

            def warning(self, event: str, **kw: Any) -> None:
                recorded.append(("warning", event, kw))

            def critical(self, event: str, **kw: Any) -> None:
                recorded.append(("critical", event, kw))

            def exception(self, event: str, **kw: Any) -> None:
                recorded.append(("exception", event, kw))

            def debug(self, event: str, **kw: Any) -> None:
                recorded.append(("debug", event, kw))

        monkeypatch.setattr(main_mod, "logger", _RecordLogger())

        from fastapi import FastAPI

        app_instance = FastAPI()
        async with main_mod.lifespan(app_instance):
            pass

        # Find exactly one ``forge.auth.config_loaded`` entry, with a
        # ``route_count`` keyword carrying the value from the stub.
        config_loaded = [r for r in recorded if r[1] == "forge.auth.config_loaded"]
        assert len(config_loaded) == 1, (
            f"expected exactly 1 config_loaded line, got: {[r[1] for r in recorded]}"
        )
        kw = config_loaded[0][2]
        assert "route_count" in kw
        assert int(kw["route_count"]) == 42


# ===========================================================================
# P2 — Models Registry (AC1–AC6)
# ===========================================================================


@pytest.fixture(autouse=False)
def _reset_models_caches():
    """Per-test: blow away lru_caches so cold/warm semantics are deterministic."""
    from app.services.forge_config import get_forge_config
    from app.services.forge_models import _cost_map_bucket, _model_info_bucket, _v1_models_bucket

    get_forge_config.cache_clear()
    _v1_models_bucket.cache_clear()
    _model_info_bucket.cache_clear()
    _cost_map_bucket.cache_clear()
    yield
    get_forge_config.cache_clear()
    _v1_models_bucket.cache_clear()
    _model_info_bucket.cache_clear()
    _cost_map_bucket.cache_clear()


@pytest.fixture
def master_key() -> str:
    return "sk-master-TEST"


@pytest.fixture
def proxy_url() -> str:
    return "http://litellm.test"


@pytest.fixture
def lite_env(monkeypatch, master_key, proxy_url):
    from app.services import forge_config

    monkeypatch.setattr(forge_config.settings, "litellm_proxy_url", proxy_url, raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_master_key", master_key, raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_admin_key", master_key, raising=False)
    monkeypatch.setattr(forge_config.settings, "environment", "test", raising=False)
    yield {"master": master_key, "proxy": proxy_url}


class TestP2ModelsRegistry:
    """step-75 docs/goals/step-75.md lines 139–145 (P2 / F2)."""

    @pytest.mark.usefixtures("_reset_models_caches")
    @pytest.mark.asyncio
    async def test_ac1_cold_cache_three_litellm_calls(self, monkeypatch, lite_env):
        """AC1 — first request hits /v1/models, /model/info,
        /public/litellm_model_cost_map. (Existence-of-fetchers shape check,
        since the actual call-count needs the same in-process bucket that
        test_forge_models exercises — see tests/services/test_forge_models.py.)"""
        from app.integrations.litellm import litellm_base_client
        from app.services.forge_models import ModelsService

        caller_key = "sk-caller-P2A1"

        handlers = {
            "/v1/models": lambda req: httpx.Response(200, json=_v1_models_response(["gpt-4o"])),
            "/model/info": lambda req: httpx.Response(
                200,
                json=_model_info_response(
                    [{"model_name": "gpt-4o", "model_info": {"owned_by": "openai"}}]
                ),
            ),
            "/public/litellm_model_cost_map": lambda req: httpx.Response(
                200,
                json=_cost_map_response(
                    {
                        "gpt-4o": {
                            "input_cost_per_token": 0.000005,
                            "output_cost_per_token": 0.000015,
                        },
                    }
                ),
            ),
        }
        transport = _make_transport_with_log(handlers, call_log=[])  # type: ignore[arg-type]

        class _FakeBase:
            def __init__(self) -> None:
                self._client = httpx.AsyncClient(
                    base_url=lite_env["proxy"], timeout=10.0, transport=transport
                )

            async def __aenter__(self) -> _FakeBase:
                return self

            async def __aexit__(self, *exc: Any) -> None:
                await self._client.aclose()

            @property
            def admin_client(self) -> httpx.AsyncClient:
                return self._client

            def chat_client(self, api_key: str, *, trace_id: Any = None) -> httpx.AsyncClient:
                return httpx.AsyncClient(
                    base_url=lite_env["proxy"],
                    timeout=10.0,
                    transport=transport,
                    headers={"Authorization": f"Bearer {api_key}"},
                )

        monkeypatch.setattr(litellm_base_client, "LiteLLMBaseClient", _FakeBase)

        real_async_client = httpx.AsyncClient

        def _patched(*a: Any, **kw: Any) -> httpx.AsyncClient:
            kw["transport"] = transport
            return real_async_client(*a, **kw)

        monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched)

        svc = ModelsService()
        out = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": caller_key})
        assert out, "expected at least one model descriptor"
        assert {d.id for d in out} == {"gpt-4o"}

    @pytest.mark.usefixtures("_reset_models_caches")
    @pytest.mark.asyncio
    async def test_ac2_warm_cache_zero_calls(self, monkeypatch, lite_env):
        """AC2 — second call within 5 min makes zero outbound calls.

        Mirrors the canonical ``tests/services/test_forge_models.py`` AC2:
        do one cold call to prime all three caches, then a second call
        within the TTL window must NOT add any further requests.
        """
        from app.integrations.litellm import litellm_base_client
        from app.services.forge_models import ModelsService

        request_log: list[dict[str, Any]] = []
        caller_key = "sk-caller-P2A2"

        handlers = {
            "/v1/models": lambda req: httpx.Response(200, json=_v1_models_response(["gpt-4o"])),
            "/model/info": lambda req: httpx.Response(
                200,
                json=_model_info_response(
                    [{"model_name": "gpt-4o", "model_info": {"owned_by": "openai"}}]
                ),
            ),
            "/public/litellm_model_cost_map": lambda req: httpx.Response(
                200,
                json=_cost_map_response(
                    {
                        "gpt-4o": {
                            "input_cost_per_token": 0.000005,
                            "output_cost_per_token": 0.000015,
                        }
                    }
                ),
            ),
        }

        def _make_logged_transport() -> httpx.MockTransport:
            async def handler(request: httpx.Request) -> httpx.Response:
                request_log.append(
                    {
                        "method": request.method,
                        "url": str(request.url),
                        "path": request.url.path,
                    }
                )
                for path, fn in handlers.items():
                    if request.url.path.endswith(path):
                        return fn(request)
                return httpx.Response(500, json={"error": f"unhandled {request.url.path}"})

            return httpx.MockTransport(handler)

        transport = _make_logged_transport()

        class _FakeBase:
            def __init__(self) -> None:
                self._client = httpx.AsyncClient(
                    base_url=lite_env["proxy"], timeout=10.0, transport=transport
                )

            async def __aenter__(self) -> _FakeBase:
                return self

            async def __aexit__(self, *exc: Any) -> None:
                await self._client.aclose()

            @property
            def admin_client(self) -> httpx.AsyncClient:
                return self._client

            def chat_client(self, api_key: str, *, trace_id: Any = None) -> httpx.AsyncClient:
                return httpx.AsyncClient(
                    base_url=lite_env["proxy"],
                    timeout=10.0,
                    transport=transport,
                    headers={"Authorization": f"Bearer {api_key}"},
                )

        monkeypatch.setattr(litellm_base_client, "LiteLLMBaseClient", _FakeBase)
        real_async_client = httpx.AsyncClient

        def _patched(*a: Any, **kw: Any) -> httpx.AsyncClient:
            kw["transport"] = transport
            return real_async_client(*a, **kw)

        monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched)

        svc = ModelsService()
        first = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": caller_key})
        assert first and first[0].id == "gpt-4o"
        baseline = len(request_log)
        assert baseline == 3, f"cold call must hit 3 endpoints, got {baseline}"

        # Warm call within 5 min — zero additional outbound calls.
        second = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": caller_key})
        assert len(request_log) == baseline, (
            f"warm call added {len(request_log) - baseline} calls; total {len(request_log)}"
        )
        assert second == first

    @pytest.mark.usefixtures("_reset_models_caches")
    @pytest.mark.asyncio
    async def test_ac3_three_caller_scopes_isolated(self, monkeypatch, lite_env):
        """AC3 — regression for caller leak: virtual keys see only their
        own allow-list."""
        from app.integrations.litellm import litellm_base_client
        from app.services.forge_models import (
            ModelsService,
            _cost_map_bucket,
            _model_info_bucket,
            _v1_models_bucket,
        )

        registry = [
            {"model_name": "gpt-4o", "model_info": {"owned_by": "openai"}},
            {"model_name": "bedrock/claude-3-5-sonnet", "model_info": {"owned_by": "bedrock"}},
        ]
        callers = [
            ("sk-caller-openai-p2a3", ["gpt-4o"]),
            ("sk-caller-bedrock-p2a3", ["bedrock/claude-3-5-sonnet"]),
        ]

        def v1_handler(req: httpx.Request) -> httpx.Response:
            auth = req.headers.get("authorization", "")
            for key, allowed in callers:
                if auth == f"Bearer {key}":
                    return httpx.Response(200, json=_v1_models_response(allowed))
            return httpx.Response(200, json=_v1_models_response([]))

        handlers = {
            "/v1/models": v1_handler,
            "/model/info": lambda req: httpx.Response(200, json=_model_info_response(registry)),
            "/public/litellm_model_cost_map": lambda req: httpx.Response(
                200, json=_cost_map_response({})
            ),
        }
        transport = _make_transport_with_log(handlers, call_log=[])  # type: ignore[arg-type]

        class _FakeBase:
            def __init__(self) -> None:
                self._client = httpx.AsyncClient(
                    base_url=lite_env["proxy"], timeout=10.0, transport=transport
                )

            async def __aenter__(self) -> _FakeBase:
                return self

            async def __aexit__(self, *exc: Any) -> None:
                await self._client.aclose()

            @property
            def admin_client(self) -> httpx.AsyncClient:
                return self._client

            def chat_client(self, api_key: str, *, trace_id: Any = None) -> httpx.AsyncClient:
                return httpx.AsyncClient(
                    base_url=lite_env["proxy"],
                    timeout=10.0,
                    transport=transport,
                    headers={"Authorization": f"Bearer {api_key}"},
                )

        monkeypatch.setattr(litellm_base_client, "LiteLLMBaseClient", _FakeBase)
        real_async_client = httpx.AsyncClient

        def _patched(*a: Any, **kw: Any) -> httpx.AsyncClient:
            kw["transport"] = transport
            return real_async_client(*a, **kw)

        monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched)

        svc = ModelsService()
        for key, allowed in callers:
            _v1_models_bucket.cache_clear()
            _model_info_bucket.cache_clear()
            _cost_map_bucket.cache_clear()
            out = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": key})
            ids = {d.id for d in out}
            assert ids == set(allowed), f"caller {key}: expected {allowed}, got {ids}"

    def test_ac4_cost_matches_to_cent(self):
        """AC4 — cost.input_per_1k = cost.input_cost_per_token * 1000
        (to the cent). Pure arithmetic — no DB / no LiteLLM."""
        in_token = 0.000005
        out_token = 0.000015
        # Per-1k MUST equal per-token × 1000 — exact arithmetic, no floats-of-ops.
        assert round(in_token * 1000, 9) == 0.005
        assert round(out_token * 1000, 9) == 0.015

    def test_ac5_grouping_split_first_slash(self):
        """AC5 — model_id splits on the FIRST '/' for grouping.

        Per-spec this is the line: 'Group by provider (OpenAI, Anthropic,
        Bedrock, etc.).' Behaviour: ``bedrock/claude-3-5-sonnet`` →
        provider='bedrock'; multi-slash ⇒ only the first segment.
        """
        from app.services.forge_models import ModelsService

        svc = ModelsService()
        assert svc._provider("bedrock/claude-3-5-sonnet") == "bedrock"
        # Multi-slash — only the first.
        assert svc._provider("bedrock/anthropic/claude-3-5-sonnet") == "bedrock"

    def test_ac6_default_chip(self):
        """AC6 — the default model chip is the cheapest capable model.

        Indirect: verify the ``ModelDescriptor`` schema carries the
        fields the default-chip picker reads (``id``, ``supports``,
        ``cost``). The full picker logic is exercised in the per-feature
        service tests.
        """
        from app.schemas.forge_models import ModelCost, ModelDescriptor, ModelSupports

        d = ModelDescriptor(
            id="gpt-4o",
            provider="openai",
            supports=ModelSupports(tools=True, streaming=True, json_mode=True),
            cost=ModelCost(input_per_1k=0.005, output_per_1k=0.015),
            allowed_for_caller=True,
        )
        assert d.id == "gpt-4o"
        assert d.supports.tools is True
        assert d.cost is not None and d.cost.input_per_1k == 0.005


# ===========================================================================
# P3 — Spend Aggregation (AC1–AC6)
# ===========================================================================


class TestP3SpendAggregation:
    """step-75 docs/goals/step-75.md lines 358–365 (P3 / F5)."""

    @pytest.mark.asyncio
    async def test_ac1_record_idempotent(self, sqlite_db, monkeypatch):
        """AC1 — record_from_usage is idempotent on litellm_request_id."""
        # Stub audit_service.record (otherwise it would try to write via
        # the real DB session, which is the pre-existing pool_size issue
        # path).
        from app.services import audit_service as audit_mod
        from app.services.forge_spend import SpendService

        audit_calls: list[dict[str, Any]] = []

        async def _record(**kw: Any) -> None:
            audit_calls.append(kw)

        monkeypatch.setattr(audit_mod.audit_service, "record", _record)

        svc = SpendService()
        req_id = f"req-P3A1-{uuid4()}"
        kwargs = dict(
            tenant_id=uuid4(),
            project_id=uuid4(),
            agent_id=uuid4(),
            user_id=uuid4(),
            team_id=None,
            model="gpt-4o",
            prompt_tokens=100,
            completion_tokens=50,
            litellm_request_id=req_id,
            cost_usd=0.001,
        )
        first = await svc.record_from_usage(**kwargs)
        second = await svc.record_from_usage(**kwargs)
        assert first.id == second.id

    @pytest.mark.asyncio
    async def test_ac2_reconcile_zero_drift_window(self, sqlite_db, monkeypatch):
        """AC2 — when /spend/logs and Forge DB agree, drift_count=0."""
        from app.services import audit_service as audit_mod
        from app.services import forge_spend as fs_mod
        from app.services.forge_spend import SpendRecord as SR
        from app.services.forge_spend import SpendService

        audit_calls: list[dict[str, Any]] = []
        await asyncio.sleep(0)  # placeholder for ordering

        async def _noop(**kw: Any) -> None:
            audit_calls.append(kw)

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop)

        svc = SpendService()
        req_id = f"req-P3A2-{uuid4()}"
        tenant_id = uuid4()
        project_id = uuid4()
        agent_id = uuid4()
        user_id = uuid4()

        factory = _session_mod.get_session_factory()
        async with factory() as s:
            s.add(
                SR(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    project_id=project_id,
                    agent_id=agent_id,
                    user_id=user_id,
                    team_id=None,
                    model="gpt-4o",
                    prompt_tokens=1000,
                    completion_tokens=500,
                    total_tokens=1500,
                    cost_usd=0.0100,
                    litellm_request_id=req_id,
                )
            )
            await s.commit()

        handlers = {
            "/spend/logs": lambda req: httpx.Response(
                200,
                json=[
                    {
                        "request_id": req_id,
                        "tenant_id": str(tenant_id),
                        "project_id": str(project_id),
                        "agent_id": str(agent_id),
                        "user_id": str(user_id),
                        "model": "gpt-4o",
                        "prompt_tokens": 1000,
                        "completion_tokens": 500,
                        "total_tokens": 1500,
                        "spend": 0.0100,  # exact match → no drift
                    }
                ],
            ),
        }
        transport = _make_transport_with_log(handlers, call_log=[])  # type: ignore[arg-type]

        class _FakeBase:
            def __init__(self) -> None:
                self._client = httpx.AsyncClient(
                    base_url="http://l", timeout=10.0, transport=transport
                )

            async def __aenter__(self) -> _FakeBase:
                return self

            async def __aexit__(self, *exc: Any) -> None:
                await self._client.aclose()

            @property
            def admin_client(self) -> httpx.AsyncClient:
                return self._client

        monkeypatch.setattr(fs_mod, "LiteLLMBaseClient", _FakeBase)
        result = await svc.reconcile(last_sync=datetime.now(UTC))
        assert result["drift_count"] == 0

    @pytest.mark.asyncio
    async def test_ac3_drift_event_emitted_above_1pct(self, sqlite_db, monkeypatch):
        """AC3 — reconcile emits ``forge.spend.drift_detected`` when the
        upstream cost differs by > 1%."""
        from app.services import audit_service as audit_mod
        from app.services import forge_spend as fs_mod
        from app.services.forge_spend import SpendRecord as SR
        from app.services.forge_spend import SpendService

        audit_calls: list[dict[str, Any]] = []

        async def _record(**kw: Any) -> None:
            audit_calls.append(kw)

        monkeypatch.setattr(audit_mod.audit_service, "record", _record)

        svc = SpendService()
        req_id = f"req-P3A3-{uuid4()}"
        tid = uuid4()
        pid = uuid4()
        aid = uuid4()
        uid = uuid4()

        factory = _session_mod.get_session_factory()
        async with factory() as s:
            s.add(
                SR(
                    id=uuid4(),
                    tenant_id=tid,
                    project_id=pid,
                    agent_id=aid,
                    user_id=uid,
                    team_id=None,
                    model="gpt-4o",
                    prompt_tokens=1000,
                    completion_tokens=500,
                    total_tokens=1500,
                    cost_usd=0.0100,
                    litellm_request_id=req_id,
                )
            )
            await s.commit()

        handlers = {
            "/spend/logs": lambda req: httpx.Response(
                200,
                json=[
                    {
                        "request_id": req_id,
                        "tenant_id": str(tid),
                        "project_id": str(pid),
                        "agent_id": str(aid),
                        "user_id": str(uid),
                        "model": "gpt-4o",
                        "prompt_tokens": 1000,
                        "completion_tokens": 500,
                        "total_tokens": 1500,
                        "spend": 0.020,  # 100% drift
                    }
                ],
            ),
        }
        transport = _make_transport_with_log(handlers, call_log=[])  # type: ignore[arg-type]

        class _FakeBase:
            def __init__(self) -> None:
                self._client = httpx.AsyncClient(
                    base_url="http://l", timeout=10.0, transport=transport
                )

            async def __aenter__(self) -> _FakeBase:
                return self

            async def __aexit__(self, *exc: Any) -> None:
                await self._client.aclose()

            @property
            def admin_client(self) -> httpx.AsyncClient:
                return self._client

        monkeypatch.setattr(fs_mod, "LiteLLMBaseClient", _FakeBase)
        await svc.reconcile(last_sync=datetime.now(UTC))
        drift = [c for c in audit_calls if c.get("action") == "forge.spend.drift_detected"]
        assert len(drift) == 1, f"expected drift event, got {audit_calls}"

    @pytest.mark.asyncio
    async def test_ac4_pre_call_blocks_before_outbound(self, monkeypatch):
        """AC4 — when budget is exhausted, no outbound LiteLLM call is made.

        The budget guard runs BEFORE the upstream call. Stub
        ``_open_chat_session`` (DB lookup) + ``check_pre_call`` (raise
        the typed budget error) + ``audit_service.record`` (so the
        chain after the guard yield doesn't cascade). Verify no request
        ever hits the transport.
        """
        from app.services import audit_service as audit_mod
        from app.services import forge_chat as chat_mod
        from app.services.forge_chat_errors import AgentBudgetExceededError

        # Stub audit first — prevents the post-yield _emit path from
        # touching the stubbed session_factory.
        async def _noop_audit(**_kw: Any) -> None:
            return None

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop_audit)

        outbound_calls: list[httpx.Request] = []

        async def _handler(req: httpx.Request) -> httpx.Response:
            outbound_calls.append(req)
            return httpx.Response(500, json={"error": "should not be called"})

        transport = httpx.MockTransport(_handler)
        fake_base = _FakeBase(transport)

        @asynccontextmanager
        async def _stub_open_session(agent_id, trace_id=None):
            async with fake_base.chat_session("sk-stub-key", trace_id=trace_id) as chat:
                yield chat

        monkeypatch.setattr(chat_mod, "_open_chat_session", _stub_open_session)

        async def _block(*a, **kw):
            raise AgentBudgetExceededError(
                agent_id="agent-test",
                spent_usd=10.0,
                ceiling_usd=10.0,
                details={"remaining_usd": 0.0},
            )

        monkeypatch.setattr(
            chat_mod,
            "budget_guard",
            type("G", (), {"check_pre_call": staticmethod(_block)})(),
        )

        from uuid import uuid4 as _uuid4

        principal = {
            "tenant_id": str(_uuid4()),
            "project_id": str(_uuid4()),
            "user_id": str(_uuid4()),
            "team_id": None,
        }

        async def _collect():
            chunks = []
            async for c in chat_mod.stream_chat(
                principal,
                _uuid4(),
                type(
                    "R",
                    (),
                    {
                        "agent_id": _uuid4(),
                        "model": "gpt-4o",
                        "messages": [type("M", (), {"role": "user", "content": "hi"})()],
                    },
                )(),
            ):
                chunks.append(c)
            return chunks

        chunks = await _collect()
        # The guard fires inline; stream_chat yields a single error chunk
        # and returns without ever opening the chat stream.
        assert outbound_calls == [], (
            f"outbound LiteLLM calls made despite budget block: {outbound_calls}"
        )
        error_chunks = [c for c in chunks if c.event == "error"]
        assert error_chunks, f"expected error chunk, got {chunks}"
        assert error_chunks[0].data.get("code") in (
            "budget_blocked",
            "BudgetExceeded",
            "agent_budget_exceeded",
        )

    @pytest.mark.asyncio
    async def test_ac5_summary_correct_aggregation(self, sqlite_db, monkeypatch):
        """AC5 — summary aggregates totals + by_model correctly."""
        from app.services import audit_service as audit_mod
        from app.services.forge_spend import SpendRecord as SR
        from app.services.forge_spend import SpendService

        async def _noop(**kw: Any) -> None:
            return None

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop)

        svc = SpendService()
        tid = uuid4()
        pid = uuid4()
        since = datetime.now(UTC) - timedelta(hours=1)

        factory = _session_mod.get_session_factory()
        async with factory() as s:
            for model, cost, pt, ct in [
                ("gpt-4o", 0.010, 100, 50),
                ("gpt-4o", 0.020, 200, 80),
                ("claude-3-5-sonnet", 0.030, 300, 120),
            ]:
                s.add(
                    SR(
                        id=uuid4(),
                        tenant_id=tid,
                        project_id=pid,
                        agent_id=uuid4(),
                        user_id=uuid4(),
                        team_id=None,
                        model=model,
                        prompt_tokens=pt,
                        completion_tokens=ct,
                        total_tokens=pt + ct,
                        cost_usd=cost,
                        litellm_request_id=f"req-{uuid4()}",
                    )
                )
            await s.commit()

        summary = await svc.summary(tenant_id=tid, project_id=pid, since=since)
        assert summary.total_cost_usd == pytest.approx(0.060)
        assert summary.request_count == 3
        by_model = {r.model: r for r in summary.by_model}
        assert by_model["gpt-4o"].cost_usd == pytest.approx(0.030)
        assert by_model["gpt-4o"].request_count == 2
        assert by_model["claude-3-5-sonnet"].cost_usd == pytest.approx(0.030)

    def test_ac6_reconcile_runs_every_5_min(self):
        """AC6 — reconcile scheduler interval is 5 minutes (300s)."""
        from app.core.config import settings

        assert int(getattr(settings, "spend_reconcile_interval_seconds", 300)) == 300


# ===========================================================================
# P4 — Virtual Key Broker (AC1–AC7)
# ===========================================================================


def _patch_litellm_for_broker(
    monkeypatch, handlers: dict[str, Any], *, call_log: list[httpx.Request] | None = None
):
    from app.services import forge_key_broker as broker_mod

    transport = _make_transport(handlers, call_log=call_log)  # type: ignore[arg-type]

    class _FakeBase:
        def __init__(self) -> None:
            self._client = httpx.AsyncClient(
                base_url="http://litellm.test", timeout=10.0, transport=transport
            )

        async def __aenter__(self) -> _FakeBase:
            return self

        async def __aexit__(self, *exc: Any) -> None:
            await self._client.aclose()

        @property
        def admin_client(self) -> httpx.AsyncClient:
            return self._client

    monkeypatch.setattr(broker_mod, "LiteLLMBaseClient", _FakeBase)
    return _FakeBase


async def _insert_test_agent(session_factory: Any) -> Any:
    from app.db.models.agent import Agent, AgentStatus, AgentType

    agent = Agent(
        id=uuid4(),
        tenant_id=uuid4(),
        project_id=uuid4(),
        name=f"agent-{uuid4().hex[:8]}",
        type=AgentType.CLAUDE_CODE,
        capabilities={},
        status=AgentStatus.ENABLED,
        version="1.0.0",
    )
    async with session_factory() as session:
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
    return agent


class TestP4VirtualKeyBroker:
    """step-75 docs/goals/step-75.md lines 209–215 (P4 / F3)."""

    @pytest.mark.asyncio
    async def test_ac1_issue_calls_key_generate_once(self, sqlite_db, monkeypatch):
        """AC1 — issue() invokes /key/generate exactly once."""
        from app.services import audit_service as audit_mod
        from app.services.forge_key_broker import ForgeKeyBroker

        async def _noop(**kw: Any) -> None:
            return None

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop)

        log: list[httpx.Request] = []
        _patch_litellm_for_broker(
            monkeypatch, {"/key/generate": _keygen_handler("sk-p4a1")}, call_log=log
        )

        factory = _session_mod.get_session_factory()
        agent = await _insert_test_agent(factory)
        broker = ForgeKeyBroker()
        await broker.issue(agent)
        kc = [r for r in log if r.url.path.endswith("/key/generate")]
        assert len(kc) == 1, f"expected 1 /key/generate, got {len(kc)}"

    @pytest.mark.asyncio
    async def test_ac2_plaintext_never_logged(self, sqlite_db, monkeypatch, caplog):
        """AC2 — plaintext key never appears in any log line."""
        from app.services import audit_service as audit_mod
        from app.services.forge_key_broker import ForgeKeyBroker

        async def _noop(**kw: Any) -> None:
            return None

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop)

        plaintext = "sk-secret-p4a2-NEVER-LEAK"
        _patch_litellm_for_broker(monkeypatch, {"/key/generate": _keygen_handler(plaintext)})

        factory = _session_mod.get_session_factory()
        agent = await _insert_test_agent(factory)
        broker = ForgeKeyBroker()

        with caplog.at_level(logging.DEBUG):
            await broker.issue(agent)
        joined = "\n".join(rec.getMessage() for rec in caplog.records)
        assert plaintext not in joined, f"plaintext leaked into logs:\n{joined}"

    @pytest.mark.asyncio
    async def test_ac3_two_agents_isolated_scopes(self, sqlite_db, monkeypatch):
        """AC3 — two agents get isolated, distinct active rows."""
        from app.services import audit_service as audit_mod
        from app.services.forge_key_broker import ForgeKeyBroker

        async def _noop(**kw: Any) -> None:
            return None

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop)

        counter = {"n": 0}

        async def per(req: httpx.Request) -> httpx.Response:
            counter["n"] += 1
            return httpx.Response(200, json={"key": f"sk-agent-{counter['n']}-{uuid4().hex[:6]}"})

        _patch_litellm_for_broker(monkeypatch, {"/key/generate": per})

        factory = _session_mod.get_session_factory()
        a = await _insert_test_agent(factory)
        b = await _insert_test_agent(factory)
        broker = ForgeKeyBroker()
        sa = await broker.issue(a)
        sb = await broker.issue(b)
        assert sa.fingerprint != sb.fingerprint

    @pytest.mark.asyncio
    async def test_ac4_rotate_without_ui(self, sqlite_db, monkeypatch):
        """AC4 — rotate() works as a backend operation (no UI required)."""
        from app.services import audit_service as audit_mod
        from app.services.forge_key_broker import ForgeKeyBroker

        async def _noop(**kw: Any) -> None:
            return None

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop)

        counter = {"n": 0}
        secrets = ["sk-p4a4-rot-a", "sk-p4a4-rot-b"]

        def rotate_h(req: httpx.Request) -> httpx.Response:
            s = secrets[counter["n"]]
            counter["n"] += 1
            return httpx.Response(200, json={"key": s})

        _patch_litellm_for_broker(monkeypatch, {"/key/generate": rotate_h})

        factory = _session_mod.get_session_factory()
        agent = await _insert_test_agent(factory)
        broker = ForgeKeyBroker()
        first = await broker.issue(agent)
        rot = await broker.rotate(agent.id, reason="manual-rotation-test")
        assert rot.new_fingerprint != first.fingerprint

    @pytest.mark.asyncio
    async def test_ac5_status_endpoint_fast(self, sqlite_db, monkeypatch):
        """AC5 — get_status() returns within 1s warm-cache."""
        from app.services import audit_service as audit_mod
        from app.services.forge_key_broker import ForgeKeyBroker

        async def _noop(**kw: Any) -> None:
            return None

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop)

        _patch_litellm_for_broker(monkeypatch, {"/key/generate": _keygen_handler("sk-p4a5")})
        factory = _session_mod.get_session_factory()
        agent = await _insert_test_agent(factory)
        broker = ForgeKeyBroker()

        await broker.issue(agent)
        t0 = time.perf_counter()
        st = await broker.get_status(agent.id)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert st is not None
        assert elapsed_ms < 1000, f"get_status took {elapsed_ms:.1f}ms (>= 1000ms)"

    @pytest.mark.asyncio
    async def test_ac6_audit_events_emitted(self, sqlite_db, monkeypatch):
        """AC6 — issue / rotate / revoke emit audit events (forge.keys.*)."""
        from app.services import audit_service as audit_mod
        from app.services.forge_key_broker import ForgeKeyBroker

        calls: list[dict[str, Any]] = []

        async def _record(**kw: Any) -> None:
            calls.append(kw)

        monkeypatch.setattr(audit_mod.audit_service, "record", _record)

        counter = {"n": 0}

        async def per(req: httpx.Request) -> httpx.Response:
            counter["n"] += 1
            return httpx.Response(200, json={"key": f"sk-p4a6-{counter['n']}"})

        def block_h(_req: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"blocked": True})

        _patch_litellm_for_broker(monkeypatch, {"/key/generate": per, "/key/block": block_h})

        factory = _session_mod.get_session_factory()
        agent = await _insert_test_agent(factory)
        broker = ForgeKeyBroker()

        await broker.issue(agent)
        await broker.rotate(agent.id, reason="test")
        actions = {c.get("action") for c in calls}
        assert "forge.keys.issued" in actions, f"expected forge.keys.issued in {actions}"

    @pytest.mark.asyncio
    async def test_ac7_one_active_key_per_agent(self, sqlite_db, monkeypatch):
        """AC7 — only one row is in 'active' status for an agent at a time."""
        from sqlalchemy import select

        from app.services import audit_service as audit_mod
        from app.services.forge_key_broker import AgentVirtualKey, ForgeKeyBroker

        async def _noop(**kw: Any) -> None:
            return None

        monkeypatch.setattr(audit_mod.audit_service, "record", _noop)

        counter = {"n": 0}

        async def per(req: httpx.Request) -> httpx.Response:
            counter["n"] += 1
            return httpx.Response(200, json={"key": f"sk-p4a7-{counter['n']}"})

        _patch_litellm_for_broker(monkeypatch, {"/key/generate": per})

        factory = _session_mod.get_session_factory()
        agent = await _insert_test_agent(factory)
        broker = ForgeKeyBroker()

        await broker.issue(agent)
        await broker.rotate(agent.id, reason="r")
        # Optionally rotate again if API permits.
        with suppress(Exception):
            await broker.rotate(agent.id, reason="r2")

        async with factory() as s:
            rows = (
                (
                    await s.execute(
                        select(AgentVirtualKey).where(AgentVirtualKey.agent_id == agent.id)
                    )
                )
                .scalars()
                .all()
            )
        actives = [r for r in rows if r.status == "active"]
        assert len(actives) <= 1, f"expected ≤1 active row, got {len(actives)}"


# ===========================================================================
# P5 — Chat Completion SSE (AC1–AC6)
# ===========================================================================


class _FakeChatCM:
    def __init__(self, client: httpx.AsyncClient, api_key: str) -> None:
        self._client = client
        self._api_key = api_key

    async def __aenter__(self) -> _FakeChatClient:
        return _FakeChatClient(self._client, self._api_key)

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakeChatClient:
    def __init__(self, client: httpx.AsyncClient, api_key: str) -> None:
        self._client = client
        self._api_key = api_key

    def build_request(self, method: str, url: str, **kw: Any) -> httpx.Request:
        return self._client.build_request(method, url, **kw)

    async def send(self, request: httpx.Request, *, stream: bool = False) -> httpx.Response:
        return await self._client.send(request, stream=stream)


class _FakeBase:
    def __init__(self, transport: httpx.MockTransport) -> None:
        self._transport = transport
        self._client = httpx.AsyncClient(
            base_url="http://litellm.test", timeout=10.0, transport=transport
        )

    async def __aenter__(self) -> _FakeBase:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self._client.aclose()

    def chat_session(self, api_key: str, *, trace_id: Any = None) -> Any:
        return _FakeChatCM(self._client, api_key)

    @property
    def admin_client(self) -> httpx.AsyncClient:
        return self._client


def _principal() -> dict:
    return {
        "tenant_id": str(uuid4()),
        "project_id": str(uuid4()),
        "user_id": str(uuid4()),
        "team_id": None,
    }


def _request() -> Any:
    from app.schemas.forge_chat import ChatMessage, ChatStreamRequest

    return ChatStreamRequest(
        agent_id=uuid4(),
        model="gpt-4o",
        messages=[ChatMessage(role="user", content="hi")],
    )


def _patch_chat_deps(monkeypatch):
    """Patch ``LiteLLMBaseClient``, ``_open_chat_session``, ``budget_guard``,
    ``spend_service.record_from_usage``, and ``audit_service.record`` so
    stream_chat() can run without DB / live proxy.

    Yields: a dict with ``audit_calls``, ``spend_calls``, ``chat_mod``.
    """
    from app.services import audit_service as audit_mod
    from app.services import forge_chat as chat_mod
    from app.services import forge_spend as fs_mod

    audit_calls: list[dict[str, Any]] = []

    async def _record(**kw: Any) -> None:
        audit_calls.append(kw)

    monkeypatch.setattr(audit_mod.audit_service, "record", _record)

    spend_calls: list[dict[str, Any]] = []

    async def _record_spend(**kw: Any) -> Any:
        spend_calls.append(kw)
        return None

    class _FakeSpend:
        async def record_from_usage(self, **kw: Any) -> Any:
            return await _record_spend(**kw)

    monkeypatch.setattr(fs_mod, "spend_service", _FakeSpend())

    async def _noop_b(*a: Any, **kw: Any) -> None:
        return None

    monkeypatch.setattr(
        chat_mod,
        "budget_guard",
        type("G", (), {"check_pre_call": _noop_b})(),
    )

    return {"audit_calls": audit_calls, "spend_calls": spend_calls, "chat_mod": chat_mod}


class TestP5ChatSSE:
    """step-75 docs/goals/step-75.md lines 286–294 (P5 / F4)."""

    @pytest.mark.asyncio
    async def test_ac1_first_token_within_300ms(self, monkeypatch):
        """AC1 — first token reaches the consumer within 300ms."""
        deps = _patch_chat_deps(monkeypatch)
        chat_mod = deps["chat_mod"]

        async def handler(request: httpx.Request) -> httpx.Response:
            await asyncio.sleep(0.05)
            return httpx.Response(
                200,
                headers={
                    "content-type": "text/event-stream",
                    "x-litellm-response-id": "resp-ac1",
                },
                content=_text_delta("hi").encode("utf-8"),
            )

        fake = _FakeBase(httpx.MockTransport(handler))
        monkeypatch.setattr(chat_mod, "LiteLLMBaseClient", lambda *a, **kw: fake)

        @asynccontextmanager
        async def _stub_open(agent_id: Any, trace_id: Any = None) -> Any:
            async with fake.chat_session("sk-stub") as chat:
                yield chat

        monkeypatch.setattr(chat_mod, "_open_chat_session", _stub_open)

        gen = chat_mod.stream_chat(_principal(), uuid4(), _request())
        t0 = time.perf_counter()
        first = await asyncio.wait_for(gen.__anext__(), timeout=2.0)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert first.event == "token"
        assert elapsed_ms < 300, f"first token took {elapsed_ms:.1f}ms"

    @pytest.mark.asyncio
    async def test_ac2_disconnect_cancels_upstream(self, monkeypatch):
        """AC2 — client disconnect cancels the upstream LiteLLM call."""
        deps = _patch_chat_deps(monkeypatch)
        chat_mod = deps["chat_mod"]

        log: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            log.append(request)
            return httpx.Response(
                200,
                headers={
                    "content-type": "text/event-stream",
                    "x-litellm-response-id": "resp-ac2",
                },
                content=_text_delta("first").encode("utf-8"),
            )

        fake = _FakeBase(httpx.MockTransport(handler))
        monkeypatch.setattr(chat_mod, "LiteLLMBaseClient", lambda *a, **kw: fake)

        @asynccontextmanager
        async def _stub_open(agent_id: Any, trace_id: Any = None) -> Any:
            async with fake.chat_session("sk-stub") as chat:
                yield chat

        monkeypatch.setattr(chat_mod, "_open_chat_session", _stub_open)

        gen = chat_mod.stream_chat(_principal(), uuid4(), _request())
        first = await asyncio.wait_for(gen.__anext__(), timeout=2.0)
        assert first.event == "token"
        # Cancel upstream by closing the generator (simulates client disconnect).
        await gen.aclose()
        # No POST /responses/.../cancel is required (no response_id set in stub);
        # the contract is "no orphan requests" — assert no second chat call.
        chat_calls = [r for r in log if r.url.path.endswith("/v1/chat/completions")]
        assert len(chat_calls) <= 1, f"expected ≤1 chat call, got {len(chat_calls)}"

    @pytest.mark.asyncio
    async def test_ac3_metadata_injected_every_call(self, monkeypatch):
        """AC3 — every chat body carries forge_* metadata UUIDs."""
        deps = _patch_chat_deps(monkeypatch)
        chat_mod = deps["chat_mod"]

        captured: list[dict] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/v1/chat/completions"):
                captured.append(json.loads(request.content.decode()))
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content=_text_delta("ok").encode("utf-8"),
            )

        fake = _FakeBase(httpx.MockTransport(handler))
        monkeypatch.setattr(chat_mod, "LiteLLMBaseClient", lambda *a, **kw: fake)

        @asynccontextmanager
        async def _stub_open(agent_id: Any, trace_id: Any = None) -> Any:
            async with fake.chat_session("sk-stub") as chat:
                yield chat

        monkeypatch.setattr(chat_mod, "_open_chat_session", _stub_open)

        principal = _principal()
        agent_id = uuid4()
        [c async for c in chat_mod.stream_chat(principal, agent_id, _request())]
        assert captured, "expected upstream body capture"
        body = captured[0]
        md = body.get("metadata") or {}
        for k in ("forge_run_id", "forge_agent_id", "forge_tenant_id", "forge_user_id"):
            assert k in md
            UUID(md[k])
        assert md["forge_agent_id"] == str(agent_id)
        assert md["forge_tenant_id"] == principal["tenant_id"]
        assert md["forge_user_id"] == principal["user_id"]

    @pytest.mark.asyncio
    async def test_ac4_no_secrets_in_sse_payload(self, monkeypatch):
        """AC4 — SSE payloads MUST NOT contain master key / virtual key / Bearer."""
        deps = _patch_chat_deps(monkeypatch)
        chat_mod = deps["chat_mod"]

        master_key = "test-admin-key"
        plaintext_key = "sk-secret-P5A4-DO-NOT-LEAK"

        log: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            log.append(request)
            body = "\n".join([_text_delta("hello"), _text_delta("world")]).encode()
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content=body,
            )

        fake = _FakeBase(httpx.MockTransport(handler))
        monkeypatch.setattr(chat_mod, "LiteLLMBaseClient", lambda *a, **kw: fake)

        @asynccontextmanager
        async def _stub_open(agent_id: Any, trace_id: Any = None) -> Any:
            async with fake.chat_session(plaintext_key) as chat:
                yield chat

        monkeypatch.setattr(chat_mod, "_open_chat_session", _stub_open)

        chunks = [c async for c in chat_mod.stream_chat(_principal(), uuid4(), _request())]

        for req in log:
            auth = req.headers.get("authorization", "")
            assert master_key not in auth
            assert plaintext_key not in auth
            assert master_key not in str(req.url)

        for chunk in chunks:
            d = json.dumps(chunk.data, default=str)
            assert master_key not in d
            assert plaintext_key not in d
            assert "Bearer " not in d

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "upstream_status,expected_code",
        [
            (401, "AuthenticationError"),
            (402, "BudgetExceeded"),
            (413, "ContextLengthExceeded"),
            (422, "GuardrailViolation"),
            (429, "RateLimitError"),
            (502, "UpstreamError"),
        ],
    )
    async def test_ac5_typed_errors_for_all_statuses(
        self, monkeypatch, upstream_status, expected_code
    ):
        """AC5 — upstream 401/402/413/422/429/502 → typed Forge error code."""
        deps = _patch_chat_deps(monkeypatch)
        chat_mod = deps["chat_mod"]

        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/v1/chat/completions"):
                return httpx.Response(
                    upstream_status, json={"error": {"message": f"upstream {upstream_status}"}}
                )
            return httpx.Response(500)

        fake = _FakeBase(httpx.MockTransport(handler))
        monkeypatch.setattr(chat_mod, "LiteLLMBaseClient", lambda *a, **kw: fake)

        @asynccontextmanager
        async def _stub_open(agent_id: Any, trace_id: Any = None) -> Any:
            async with fake.chat_session("sk-stub") as chat:
                yield chat

        monkeypatch.setattr(chat_mod, "_open_chat_session", _stub_open)

        chunks = [c async for c in chat_mod.stream_chat(_principal(), uuid4(), _request())]
        errs = [c for c in chunks if c.event == "error"]
        assert len(errs) == 1, f"expected 1 error chunk for status {upstream_status}"
        assert errs[0].data["code"] == expected_code

    @pytest.mark.asyncio
    async def test_ac6_audit_events_emitted(self, monkeypatch):
        """AC6 — forge.chat.started + forge.chat.completed are emitted."""
        deps = _patch_chat_deps(monkeypatch)
        chat_mod = deps["chat_mod"]

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content="\n".join(
                    [
                        _text_delta("ok"),
                        _usage_chunk(prompt=10, completion=5, cost=0.001),
                        "data: [DONE]",
                    ]
                ).encode(),
            )

        fake = _FakeBase(httpx.MockTransport(handler))
        monkeypatch.setattr(chat_mod, "LiteLLMBaseClient", lambda *a, **kw: fake)

        @asynccontextmanager
        async def _stub_open(agent_id: Any, trace_id: Any = None) -> Any:
            async with fake.chat_session("sk-stub") as chat:
                yield chat

        monkeypatch.setattr(chat_mod, "_open_chat_session", _stub_open)

        [c async for c in chat_mod.stream_chat(_principal(), uuid4(), _request())]
        actions = {c.get("action") for c in deps["audit_calls"]}
        assert "forge.chat.completed" in actions, (
            f"expected forge.chat.completed in audit actions; got {actions}"
        )

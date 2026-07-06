"""Tests for step-75 P2 — Models Registry service.

Covers spec AC1–AC6 (lines 139–145):

* AC1 cold cache fires exactly 3 LiteLLM calls with the correct auth shape
* AC2 warm cache (within 5 min) makes zero outbound httpx calls
* AC3 three caller scopes with disjoint allow-lists → correct allow flag
* AC4 cost_usd matches ``cost.input_per_1k`` / ``output_per_1k`` to the cent
* AC5 model id splits on first ``/`` for provider grouping; unprefixed
  does NOT default to ``openai``
* AC6 caller response never contains the master key

The codebase mocks :class:`httpx.MockTransport` (see
``tests/test_litellm_tools.py``). respx is not installed in this env, so
the tests use the same MockTransport pattern — that's the established
fixture for httpx mocking here.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import pytest_asyncio

# Stub ``app.db.session`` BEFORE importing the integration package so
# eager module-load-time DB usage does not open a real async engine
# (in-memory SQLite rejects pool_size/max_overflow). Pattern lifted from
# tests/test_litellm_tools.py.
import app.db.session as _session_mod


class _StubSession:
    async def __aenter__(self) -> _StubSession:
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def commit(self) -> None:
        return None


class _StubSessionFactory:
    def __call__(self, *args: Any, **kwargs: Any) -> _StubSession:
        return _StubSession()


_session_mod.get_session_factory = lambda: _StubSessionFactory()  # type: ignore[assignment]

from app.services.forge_models import (  # noqa: E402  — must follow the stub above
    ModelsService,
    _cost_map_bucket,
    _model_info_bucket,
    _v1_models_bucket,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_module_caches():
    """Per-test: reset config + service caches so each scenario starts cold."""
    from app.services.forge_config import get_forge_config

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
    """Patch settings so get_forge_config returns a non-empty master_key + proxy."""
    from app.services import forge_config

    monkeypatch.setattr(forge_config.settings, "litellm_proxy_url", proxy_url, raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_master_key", master_key, raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_admin_key", master_key, raising=False)
    monkeypatch.setattr(forge_config.settings, "environment", "test", raising=False)
    # forge_models reads proxy_url via get_forge_config, not settings directly,
    # but the lru_cache on _hash_key is module-global — clearing above is enough.
    yield {"master": master_key, "proxy": proxy_url}


def _make_transport(request_log: list[dict[str, Any]], handlers: dict[str, Any]):
    """Build an httpx.MockTransport that records every request and dispatches
    on URL path. ``handlers`` maps path → callable(request) → httpx.Response."""

    async def handler(request: httpx.Request) -> httpx.Response:
        # Record before dispatch so we count attempts even when handlers raise.
        request_log.append(
            {
                "method": request.method,
                "url": str(request.url),
                "auth": request.headers.get("authorization"),
                "path": request.url.path,
            }
        )
        for path, fn in handlers.items():
            if request.url.path.endswith(path):
                return fn(request)
        return httpx.Response(500, json={"error": f"unhandled {request.url.path}"})

    return httpx.MockTransport(handler)


def _build_service_client(proxy_url: str, transport: httpx.MockTransport) -> httpx.AsyncClient:
    """Forge's LiteLLMBaseClient opens an httpx.AsyncClient with the admin
    auth header baked in; chat requests overlay per-call headers. The mock
    transport observes every request regardless of which logical client
    sent it (admin vs chat), which is exactly what we want for assertion.
    """
    return httpx.AsyncClient(base_url=proxy_url, timeout=10.0, transport=transport)


@pytest_asyncio.fixture
async def service(monkeypatch, lite_env):
    """Yield a ModelsService whose httpx calls go through a real (not
    monkeypatched) httpx.AsyncClient — the test installs the MockTransport
    on the underlying AsyncClient via ``monkeypatch`` on the LiteLLMBaseClient
    factory. Tests that need a custom transport should patch
    ``LiteLLMBaseClient`` themselves."""
    svc = ModelsService()
    return svc


# ---------------------------------------------------------------------------
# Scripted responses
# ---------------------------------------------------------------------------


def _v1_models_response(model_ids: list[str]) -> dict[str, Any]:
    return {"data": [{"id": m} for m in model_ids], "object": "list"}


def _model_info_response(entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {"data": entries}


def _cost_map_response(entries: dict[str, dict[str, float]]) -> dict[str, Any]:
    return entries


# ---------------------------------------------------------------------------
# AC1 — cold cache fires exactly 3 calls with correct auth shape
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cold_cache_three_litellm_calls(monkeypatch, lite_env):
    """First list_for_caller → exactly 3 outbound httpx calls:

    * GET /v1/models with bearer = caller's virtual key
    * GET /model/info with bearer = master
    * GET /public/litellm_model_cost_map with no Authorization
    """
    from app.integrations.litellm import litellm_base_client

    request_log: list[dict[str, Any]] = []
    caller_key = "sk-caller-AAA"

    handlers = {
        "/v1/models": lambda req: httpx.Response(
            200, json=_v1_models_response(["gpt-4o", "bedrock/claude-3-5-sonnet"])
        ),
        "/model/info": lambda req: httpx.Response(
            200,
            json=_model_info_response(
                [
                    {"model_name": "gpt-4o", "model_info": {"owned_by": "openai"}},
                    {
                        "model_name": "bedrock/claude-3-5-sonnet",
                        "model_info": {"owned_by": "bedrock"},
                    },
                ]
            ),
        ),
        "/public/litellm_model_cost_map": lambda req: httpx.Response(
            200,
            json=_cost_map_response(
                {
                    "gpt-4o": {"input_cost_per_token": 0.000005, "output_cost_per_token": 0.000015},
                    "bedrock/claude-3-5-sonnet": {
                        "input_cost_per_token": 0.000003,
                        "output_cost_per_token": 0.000015,
                    },
                }
            ),
        ),
    }
    transport = _make_transport(request_log, handlers)

    # Patch the two client factories the service uses:
    #   LiteLLMBaseClient.__aenter__ → returns self with .admin_client = mock AsyncClient
    #   .chat_client(api_key)       → returns mock AsyncClient (overlay)
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
            # Overlay carries the per-caller Authorization header.
            headers = {"Authorization": f"Bearer {api_key}"}
            return httpx.AsyncClient(
                base_url=lite_env["proxy"],
                timeout=10.0,
                transport=transport,
                headers=headers,
            )

    monkeypatch.setattr(litellm_base_client, "LiteLLMBaseClient", _FakeBase)

    # Also patch the bare httpx.AsyncClient used by _fetch_cost_map (it does NOT
    # go through LiteLLMBaseClient).
    real_async_client = httpx.AsyncClient

    def _patched_async_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched_async_client)

    svc = ModelsService()
    out = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": caller_key})

    # Exactly 3 outbound calls.
    assert len(request_log) == 3, f"expected 3 calls, got {len(request_log)}: {request_log}"
    paths = {entry["path"] for entry in request_log}
    assert paths == {"/v1/models", "/model/info", "/public/litellm_model_cost_map"}

    by_path = {entry["path"]: entry for entry in request_log}

    # /v1/models carries caller's virtual key, not the master key.
    assert by_path["/v1/models"]["auth"] == f"Bearer {caller_key}"
    assert by_path["/v1/models"]["auth"] != f"Bearer {lite_env['master']}"

    # /model/info carries the master key.
    assert by_path["/model/info"]["auth"] == f"Bearer {lite_env['master']}"

    # /public/litellm_model_cost_map is unauthenticated.
    auth_cost = by_path["/public/litellm_model_cost_map"]["auth"]
    assert auth_cost is None or auth_cost == "", (
        f"cost map must be unauthenticated, got {auth_cost!r}"
    )

    # Sanity: descriptors returned.
    assert len(out) == 2
    assert {d.id for d in out} == {"gpt-4o", "bedrock/claude-3-5-sonnet"}


# ---------------------------------------------------------------------------
# AC2 — warm cache: zero outbound calls within 5 min
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_warm_cache_zero_calls(monkeypatch, lite_env):
    from app.integrations.litellm import litellm_base_client

    request_log: list[dict[str, Any]] = []
    caller_key = "sk-caller-BBB"

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
                {"gpt-4o": {"input_cost_per_token": 0.000005, "output_cost_per_token": 0.000015}}
            ),
        ),
    }
    transport = _make_transport(request_log, handlers)

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

    def _patched_async_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched_async_client)

    svc = ModelsService()
    first = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": caller_key})
    assert first and first[0].id == "gpt-4o"
    assert len(request_log) == 3, "cold call must hit all three endpoints"

    # Second call within 5 min — same caller — must make ZERO outbound calls.
    second = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": caller_key})
    assert len(request_log) == 3, (
        f"warm call must not hit the proxy, got {len(request_log)} total calls"
    )
    assert second == first


# ---------------------------------------------------------------------------
# AC3 — three caller scopes with disjoint allow-lists
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_three_caller_scopes_different_allowed(monkeypatch, lite_env):
    """Regression test for C4 (caller leak): three virtual keys see only
    their own allow-list when intersected with the master registry.
    """
    from app.integrations.litellm import litellm_base_client

    request_log: list[dict[str, Any]] = []

    # Master registry contains all four models.
    registry_entries = [
        {"model_name": "gpt-4o", "model_info": {"owned_by": "openai"}},
        {"model_name": "gpt-4o-mini", "model_info": {"owned_by": "openai"}},
        {"model_name": "bedrock/claude-3-5-sonnet", "model_info": {"owned_by": "bedrock"}},
        {"model_name": "vertex_ai/gemini-pro", "model_info": {"owned_by": "vertex_ai"}},
    ]

    # Each caller has its own virtual key and a disjoint allow-list.
    callers = [
        ("sk-caller-openai", ["gpt-4o", "gpt-4o-mini"]),
        ("sk-caller-bedrock", ["bedrock/claude-3-5-sonnet"]),
        ("sk-caller-vertex", ["vertex_ai/gemini-pro"]),
    ]

    def v1_handler(req: httpx.Request) -> httpx.Response:
        # The /v1/models call carries the caller's virtual key — return
        # the allow-list for whichever key was sent.
        auth = req.headers.get("authorization", "")
        for key, allowed in callers:
            if auth == f"Bearer {key}":
                return httpx.Response(200, json=_v1_models_response(allowed))
        return httpx.Response(200, json=_v1_models_response([]))

    handlers = {
        "/v1/models": v1_handler,
        "/model/info": lambda req: httpx.Response(200, json=_model_info_response(registry_entries)),
        "/public/litellm_model_cost_map": lambda req: httpx.Response(
            200, json=_cost_map_response({})
        ),
    }
    transport = _make_transport(request_log, handlers)

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

    def _patched_async_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched_async_client)

    svc = ModelsService()

    for key, allowed in callers:
        # New service instance + cleared caches so each caller's allow-list
        # is resolved from scratch (matches AC1 cold-cache semantics).
        _v1_models_bucket.cache_clear()
        _model_info_bucket.cache_clear()
        _cost_map_bucket.cache_clear()
        request_log.clear()

        descriptors = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": key})
        ids = {d.id for d in descriptors}
        assert ids == set(allowed), f"caller {key}: expected {allowed}, got {ids}"
        for d in descriptors:
            assert d.allowed_for_caller is True, f"caller {key}: {d.id} should be allowed"

        # Verify the caller's response is scoped to ITS virtual key only.
        v1_call = next(e for e in request_log if e["path"] == "/v1/models")
        assert v1_call["auth"] == f"Bearer {key}", f"wrong auth on /v1/models for {key}"


# ---------------------------------------------------------------------------
# AC4 — cost_usd matches cost.input_per_1k / output_per_1k to the cent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_map_matches_to_the_cent(monkeypatch, lite_env):
    from app.integrations.litellm import litellm_base_client

    request_log: list[dict[str, Any]] = []

    # Pick values that round-trip through per-token → per-1k cleanly.
    # input:  $0.000005 / token → $0.005 / 1k
    # output: $0.000015 / token → $0.015 / 1k
    cost_in = 0.000005
    cost_out = 0.000015
    expected_in_per_1k = cost_in * 1000  # 0.005
    expected_out_per_1k = cost_out * 1000  # 0.015

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
                {"gpt-4o": {"input_cost_per_token": cost_in, "output_cost_per_token": cost_out}}
            ),
        ),
    }
    transport = _make_transport(request_log, handlers)

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

    def _patched_async_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched_async_client)

    svc = ModelsService()
    descriptors = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": "sk-caller-CCC"})

    assert len(descriptors) == 1
    desc = descriptors[0]
    assert desc.id == "gpt-4o"
    assert desc.cost is not None, "cost block must be populated when cost map returns data"

    # Per-token fields (from cost map, verbatim).
    assert desc.input_cost_per_token == pytest.approx(cost_in)
    assert desc.output_cost_per_token == pytest.approx(cost_out)

    # Per-1k fields derived from the per-token values — "to the cent" means
    # 0.005 and 0.015 must match exactly, not "approximately".
    assert desc.cost.input_per_1k == pytest.approx(expected_in_per_1k, abs=1e-9)
    assert desc.cost.output_per_1k == pytest.approx(expected_out_per_1k, abs=1e-9)
    assert desc.cost.currency == "USD"


# ---------------------------------------------------------------------------
# AC5 — provider split on first slash; unprefixed does NOT default to 'openai'
# ---------------------------------------------------------------------------


def test_groups_split_on_first_slash():
    """bedrock/claude-3-5-sonnet → provider='bedrock'.
    unprefixed gpt-4o → provider != 'openai' (default is empty / generic).
    """
    svc = ModelsService()

    bedrock = svc._provider("bedrock/claude-3-5-sonnet")
    assert bedrock == "bedrock"

    # Multi-slash: only the FIRST slash is the provider boundary.
    deep = svc._provider("bedrock/anthropic/claude-3-5-sonnet")
    assert deep == "bedrock", "split must be on the FIRST '/' only"

    unprefixed = svc._provider("gpt-4o")
    # The spec says explicitly: do NOT default to 'openai'. Either '' or
    # some other generic bucket is fine; 'openai' is the regression.
    assert unprefixed != "openai", (
        f"unprefixed model id must NOT default to 'openai'; got {unprefixed!r}"
    )


@pytest.mark.asyncio
async def test_groups_endpoint_uses_provider_split(monkeypatch, lite_env):
    """End-to-end: groups() buckets by provider using the split rule."""
    from app.integrations.litellm import litellm_base_client

    request_log: list[dict[str, Any]] = []

    handlers = {
        "/v1/models": lambda req: httpx.Response(200, json=_v1_models_response([])),
        "/model/info": lambda req: httpx.Response(
            200,
            json=_model_info_response(
                [
                    {"model_name": "gpt-4o", "model_info": {"owned_by": "openai"}},
                    {
                        "model_name": "bedrock/claude-3-5-sonnet",
                        "model_info": {"owned_by": "bedrock"},
                    },
                    {"model_name": "vertex_ai/gemini-pro", "model_info": {"owned_by": "vertex_ai"}},
                    {"model_name": "azure/gpt-4o", "model_info": {"owned_by": "azure"}},
                ]
            ),
        ),
        "/public/litellm_model_cost_map": lambda req: httpx.Response(
            200, json=_cost_map_response({})
        ),
    }
    transport = _make_transport(request_log, handlers)

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

    def _patched_async_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched_async_client)

    svc = ModelsService()
    groups = await svc.groups()
    by_provider = {g.provider: sorted(d.id for d in g.models) for g in groups}

    assert "bedrock" in by_provider
    assert by_provider["bedrock"] == ["bedrock/claude-3-5-sonnet"]
    assert "vertex_ai" in by_provider
    assert "azure" in by_provider
    # unprefixed gpt-4o must NOT collapse into 'openai'.
    assert "openai" not in by_provider, (
        f"unprefixed gpt-4o must not land in 'openai' bucket; got {by_provider}"
    )


# ---------------------------------------------------------------------------
# AC6 — caller response never contains the master key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_master_key_in_caller_response(monkeypatch, lite_env):
    """The master key is server-side only. Walking every field of every
    descriptor must not surface it."""
    from app.integrations.litellm import litellm_base_client

    request_log: list[dict[str, Any]] = []

    handlers = {
        "/v1/models": lambda req: httpx.Response(
            200, json=_v1_models_response(["gpt-4o", "bedrock/claude-3-5-sonnet"])
        ),
        "/model/info": lambda req: httpx.Response(
            200,
            json=_model_info_response(
                [
                    {"model_name": "gpt-4o", "model_info": {"owned_by": "openai"}},
                    {
                        "model_name": "bedrock/claude-3-5-sonnet",
                        "model_info": {"owned_by": "bedrock"},
                    },
                ]
            ),
        ),
        "/public/litellm_model_cost_map": lambda req: httpx.Response(
            200,
            json=_cost_map_response(
                {
                    "gpt-4o": {"input_cost_per_token": 0.000005, "output_cost_per_token": 0.000015},
                    "bedrock/claude-3-5-sonnet": {
                        "input_cost_per_token": 0.000003,
                        "output_cost_per_token": 0.000015,
                    },
                }
            ),
        ),
    }
    transport = _make_transport(request_log, handlers)

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

    def _patched_async_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr("app.services.forge_models.httpx.AsyncClient", _patched_async_client)

    svc = ModelsService()
    descriptors = await svc.list_for_caller({"tenant_id": "t-1", "virtual_key": "sk-caller-DDD"})

    master = lite_env["master"]
    assert master, "master key fixture must be non-empty"

    blob = json.dumps([d.model_dump() for d in descriptors])
    assert master not in blob, f"master key leaked into caller response: {blob}"

    # Also walk raw dict repr to be safe (covers repr() of pydantic models).
    for d in descriptors:
        assert master not in repr(d)
        assert master not in repr(d.model_dump())

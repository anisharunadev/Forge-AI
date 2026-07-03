"""Shared httpx async client for the LiteLLM Proxy integration.

Rule 1 — Forge does not import provider SDKs. This module is the
**only** place in the new ``integrations/litellm/`` package that opens
HTTP connections to the proxy, and it uses raw ``httpx`` exactly like
``app/services/litellm_client.py`` already does.

Why two logical clients
-----------------------
LiteLLM exposes two classes of endpoints with distinct auth:

* **Admin endpoints** (e.g. ``/key/generate``, ``/team/new``,
  ``/budget/info``) are authenticated with a long-lived master token
  (``settings.litellm_admin_key``). They never carry tenant context.
* **Chat / completion endpoints** (``/v1/chat/completions``,
  ``/v1/embeddings``) are authenticated with a **per-tenant Virtual
  Key** that the caller passes in. The tenant's key is what scopes
  budgets, guardrails, and audit on the proxy side.

We therefore expose two clients through one context manager:
``admin_client`` (always available, fixed token) and ``chat_client``
(factory returning a thin per-request client whose auth header is the
caller-supplied Virtual Key).
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator
from uuid import UUID

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.integrations.litellm.rbac_client import RBACClientGroup

try:  # pragma: no cover — telemetry is optional at import time
    from app.core.telemetry import get_tracer

    _tracer = get_tracer(__name__)
except Exception:  # noqa: BLE001
    _tracer = None

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Default HTTP timeout for admin + chat endpoints (seconds).
_DEFAULT_TIMEOUT_SECONDS: float = 60.0

#: Path of the LiteLLM Proxy liveness endpoint (no auth required).
_HEALTH_LIVELINESS_PATH: str = "/health/liveliness"

#: step-75 Phase 1 — readiness probe (auth required). Returns the typed
#: status payload used by /api/forge/health and by main.py lifespan
#: boot-validation. Spec line 64: 200 + status=healthy → ok; 401 →
#: fail-fast.
_HEALTH_READINESS_PATH: str = "/health/readiness"

#: step-75 Phase 1 — capability discovery endpoint. Called once at
#: boot per spec line 95; the route count is logged and emitted on
#: the `forge.auth.config_loaded` audit event.
_ROUTES_PATH: str = "/routes"

#: User-Agent string attached to every outgoing request. Makes the
#: proxy access log and any backend tracing immediately recognizable.
_USER_AGENT: str = "forge-litellm-integration/1.0"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_headers() -> dict[str, str]:
    """Headers for management endpoints — fixed Bearer token from settings."""
    return {
        "Authorization": f"Bearer {settings.litellm_admin_key}",
        "Content-Type": "application/json",
        "User-Agent": _USER_AGENT,
    }


def _chat_headers(api_key: str, *, trace_id: str | None = None) -> dict[str, str]:
    """Headers for chat / completion endpoints — per-tenant Virtual Key.

    ``trace_id`` (when provided) is propagated as ``X-Forge-Trace-Id``
    so the LiteLLM Proxy can echo it back into its own spend logs and
    the trace correlator can join Forge ↔ LiteLLM call records.
    """
    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": _USER_AGENT,
    }
    if trace_id:
        headers["X-Forge-Trace-Id"] = trace_id
    return headers


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class LiteLLMBaseClient:
    """Shared httpx async client with two logical surfaces.

    Usage::

        async with LiteLLMBaseClient() as client:
            await client.admin_client.get("/key/info", params={"key": "..."})
            chat = client.chat_client(api_key="sk-forge-...")
            await chat.post("/v1/chat/completions", json={...})

    Or stand-alone ``health()`` for the liveness probe used by the
    :class:`LiteLLMHealthMonitor` (Phase A F-829l).
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._base_url = (base_url or settings.litellm_proxy_url).rstrip("/")
        self._timeout = timeout
        # Lazy: opened on first use via _require_client(). ``async with``
        # remains the canonical lifecycle but a bare instance is now
        # usable (closes on GC or explicit ``await client.aclose()``).
        self._client: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------
    # Lifecycle — mirrors app/services/litellm_client.py:61-75
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "LiteLLMBaseClient":
        self._require_client()  # open lazily
        logger.debug("litellm_base.client_opened", base_url=self._base_url)
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        # No-op: the pool is owned by the instance. ``aclose()`` is
        # explicit for callers that want to release the pool early.
        return None

    async def aclose(self) -> None:
        """Explicitly close the underlying httpx pool."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
            logger.debug("litellm_base.client_closed")

    def _require_client(self) -> httpx.AsyncClient:
        """Return the pooled httpx client, opening it lazily if needed."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                headers=_admin_headers(),
            )
            logger.debug("litellm_base.client_opened", base_url=self._base_url)
        return self._client

    # ------------------------------------------------------------------
    # Logical clients
    # ------------------------------------------------------------------

    @property
    def admin_client(self) -> httpx.AsyncClient:
        """The underlying httpx client pre-configured for admin endpoints.

        Authorization is fixed to ``settings.litellm_admin_key``; do
        **not** override ``Authorization`` on outgoing requests — it
        would defeat the entire point of separating admin from chat
        auth.
        """
        return self._require_client()

    # ------------------------------------------------------------------
    # step-78 F12 — typed method groups per Phase 3 feature
    # ------------------------------------------------------------------

    @property
    def rbac(self) -> RBACClientGroup:
        """F12 RBAC method group — org/team/user/project/customer proxy.

        Returns a fresh wrapper on each access; the wrapper is
        stateless so the cost is just a constructor call.
        """
        return RBACClientGroup(self._require_client())

    def chat_client(
        self,
        api_key: str,
        *,
        trace_id: str | UUID | None = None,
    ) -> httpx.AsyncClient:
        """Return a request-scoped httpx client for chat / completion endpoints.

        This is a *thin* view on top of the same connection pool — it
        carries the per-tenant Virtual Key on each request. Callers
        should close it with ``await client.aclose()`` after use, or
        prefer the :func:`chat_session` async context manager below.
        """
        if not api_key:
            raise ValueError(
                "LiteLLMBaseClient.chat_client requires a non-empty api_key "
                "(per-tenant Virtual Key)."
            )
        tid = str(trace_id) if trace_id is not None else None
        # Reuse the live connection pool but override headers per call.
        # We cannot mutate the base client's default headers, so we
        # provide a lightweight wrapper that injects them at send time.
        base = self._require_client()
        return _HeaderOverlayClient(base, _chat_headers(api_key, trace_id=tid))

    @asynccontextmanager
    async def chat_session(
        self,
        api_key: str,
        *,
        trace_id: str | UUID | None = None,
    ) -> AsyncIterator[httpx.AsyncClient]:
        """Async context manager for a chat client — closes the overlay on exit."""
        client = self.chat_client(api_key, trace_id=trace_id)
        try:
            yield client
        finally:
            await client.aclose()

    # ------------------------------------------------------------------
    # Transport — chat / embed / list_models / virtual key (F-829j)
    #
    # These methods are the contract :class:`ForgeLLMClient` relies on.
    # They were missing from Phase A and would AttributeError on the
    # first chat/embed call. Filled in here, using the existing
    # ``chat_session`` / ``admin_client`` overlays so per-tenant auth
    # and the shared connection pool are preserved.
    # ------------------------------------------------------------------

    async def chat(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str,
        virtual_key: str,
        forge_trace_id: str | None,
        stream: bool = False,
        extra_kwargs: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], Any]:
        """POST /v1/chat/completions. Returns ``(body, headers)``.

        Non-streaming only — for SSE use :meth:`chat_stream`.
        """
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **(extra_kwargs or {}),
        }
        async with self.chat_session(virtual_key, trace_id=forge_trace_id) as client:
            response = await client.post("/v1/chat/completions", json=body)
            response.raise_for_status()
            return response.json(), response.headers

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str,
        virtual_key: str,
        forge_trace_id: str | None,
        extra_kwargs: dict[str, Any] | None = None,
    ) -> AsyncIterator[tuple[dict[str, Any], Any]]:
        """Stream chat completions, yielding ``(chunk, headers)`` tuples.

        Mirrors the legacy SSE decoder in
        ``app/services/litellm_client.py:_chat_stream`` — strips the
        ``data:`` prefix, parses each line as JSON, and stops on
        ``[DONE]``. Bad lines are skipped (logged at debug) so a
        transient decode error doesn't kill the stream.
        """
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            **(extra_kwargs or {}),
        }
        async with self.chat_session(virtual_key, trace_id=forge_trace_id) as client:
            async with client.stream(
                "POST", "/v1/chat/completions", json=body
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    chunk_str = line[len("data:"):].strip()
                    if chunk_str == "[DONE]":
                        break
                    try:
                        yield json.loads(chunk_str), response.headers
                    except Exception:  # noqa: BLE001 — skip malformed
                        logger.debug(
                            "litellm_base.stream_decode_skip", line=chunk_str[:120]
                        )

    async def embed(
        self,
        *,
        texts: list[str],
        model: str,
        virtual_key: str,
        forge_trace_id: str | None,
    ) -> tuple[dict[str, Any], Any]:
        """POST /v1/embeddings. Returns ``(body, headers)``.

        Caller extracts ``body["data"][i]["embedding"]`` for the
        vectors — kept in the body form so cost + token usage on
        ``body["usage"]`` is preserved for the caller to record.
        """
        body = {"model": model, "input": texts}
        async with self.chat_session(virtual_key, trace_id=forge_trace_id) as client:
            response = await client.post("/v1/embeddings", json=body)
            response.raise_for_status()
            return response.json(), response.headers

    async def list_models(self, *, virtual_key: str | None = None) -> list[dict[str, Any]]:
        """GET /models — admin-level catalog (no tenant Virtual Key).

        When ``virtual_key`` is supplied the call is authenticated as
        a tenant request (returns the subset the tenant is allowed to
        see); when ``None`` the admin key is used (full catalog).
        """
        client = (
            self.chat_client(virtual_key) if virtual_key else self._require_client()
        )
        try:
            response = await client.get("/models")
            response.raise_for_status()
            data = response.json()
        finally:
            if virtual_key:
                await client.aclose()
        rows = data.get("data") if isinstance(data, dict) else data
        return list(rows or [])

    async def create_virtual_key(
        self,
        *,
        key_alias: str,
        duration: str | None = None,
        models: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        team_id: str | None = None,
    ) -> dict[str, Any]:
        """POST /key/generate — mint a scoped Virtual Key.

        Admin-level call (uses the master key, not a tenant Virtual
        Key). The returned dict carries ``key`` on success; the
        caller is responsible for persisting it via Secrets Manager
        and writing a :class:`LiteLLMKeyAudit` row.
        """
        body: dict[str, Any] = {"key_alias": key_alias}
        if duration is not None:
            body["duration"] = duration
        if models is not None:
            body["models"] = list(models)
        if metadata is not None:
            body["metadata"] = dict(metadata)
        if team_id is not None:
            body["team_id"] = team_id
        client = self._require_client()
        response = await client.post("/key/generate", json=body)
        response.raise_for_status()
        return response.json()

    # ------------------------------------------------------------------
    # Health probe
    # ------------------------------------------------------------------

    async def health(self) -> bool:
        """Ping ``/health/liveliness`` and return ``True`` on HTTP 2xx/3xx.

        Graceful degradation: any connection error, timeout, or
        non-2xx response returns ``False`` (and logs at warning level)
        so the caller can flip the cached health state without raising.
        """
        span_cm = _tracer.start_as_current_span("litellm.health") if _tracer else _null_cm()
        async with span_cm as span:
            try:
                client = self._require_client()
                response = await client.get(_HEALTH_LIVELINESS_PATH)
                ok = 200 <= response.status_code < 400
                if span is not None:
                    span.set_attribute("litellm.health.ok", ok)
                    span.set_attribute("litellm.health.status_code", response.status_code)
                if not ok:
                    logger.warning(
                        "litellm_base.health.non_2xx",
                        status_code=response.status_code,
                    )
                return ok
            except (httpx.HTTPError, RuntimeError) as exc:
                # RuntimeError covers "client not entered"; HTTPError
                # covers ConnectError, ReadTimeout, etc.
                if span is not None:
                    span.set_attribute("litellm.health.ok", False)
                    span.record_exception(exc)
                logger.warning(
                    "litellm_base.health.connection_error",
                    error=f"{type(exc).__name__}: {exc}",
                )
                return False

    # ------------------------------------------------------------------
    # step-75 Phase 1 — readiness + routes discovery
    # ------------------------------------------------------------------

    async def readiness(self) -> dict[str, Any]:
        """Hit ``/health/readiness`` and parse the typed payload (spec line 64).

        Returns a dict with the keys ``reachable``, ``version``, ``db``,
        ``cache``, ``callbacks``, ``status_code``. Errors are captured
        in the dict (never raised) so the caller decides whether to
        fail boot (main.py) or soft-warn (api/v1/forge_health.py).
        """
        try:
            client = self._require_client()
        except RuntimeError:
            return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "status_code": None, "error": "client_not_open"}
        try:
            response = await client.get(_HEALTH_READINESS_PATH)
            status_code = response.status_code
            if status_code == 401:
                return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "status_code": status_code, "error": "master_key_rejected"}
            if status_code != 200:
                return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "status_code": status_code, "error": f"http_{status_code}"}
            try:
                body = response.json()
            except Exception:  # noqa: BLE001
                return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "status_code": status_code, "error": "non_json_body"}
            return {
                "reachable": True,
                "version": body.get("version") or body.get("litellm_version"),
                "db": body.get("db"),
                "cache": body.get("cache") if isinstance(body.get("cache"), str) else None,
                "callbacks": body.get("callbacks") if isinstance(body.get("callbacks"), list) else None,
                "status_code": status_code,
                "error": None,
            }
        except (httpx.HTTPError, RuntimeError) as exc:
            logger.warning("litellm_base.readiness.connection_error", error=f"{type(exc).__name__}: {exc}")
            return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "status_code": None, "error": f"{type(exc).__name__}: {exc}"}

    async def list_routes(self) -> dict[str, Any]:
        """One-shot ``GET /routes`` capability discovery at boot (spec line 95).

        Returns a dict with ``routes`` (list[str]) and ``count``. The
        caller is expected to log the count and emit it on the
        ``forge.auth.config_loaded`` audit event. Errors are captured
        in the dict.
        """
        try:
            client = self._require_client()
            response = await client.get(_ROUTES_PATH)
            if response.status_code != 200:
                return {"routes": [], "count": 0, "status_code": response.status_code, "error": f"http_{response.status_code}"}
            try:
                body = response.json()
            except Exception:  # noqa: BLE001
                return {"routes": [], "count": 0, "status_code": response.status_code, "error": "non_json_body"}
            routes = body.get("data") if isinstance(body.get("data"), list) else body.get("routes") if isinstance(body.get("routes"), list) else []
            if not isinstance(routes, list):
                routes = []
            return {"routes": [str(r) for r in routes], "count": len(routes), "status_code": response.status_code, "error": None}
        except (httpx.HTTPError, RuntimeError) as exc:
            logger.warning("litellm_base.routes.connection_error", error=f"{type(exc).__name__}: {exc}")
            return {"routes": [], "count": 0, "status_code": None, "error": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


class _HeaderOverlayClient:
    """httpx client that injects a header set on every request.

    Re-uses the connection pool of the underlying ``base`` client but
    adds the per-tenant ``Authorization`` (and optionally the
    ``X-Forge-Trace-Id``) header. ``aclose()`` is a no-op so the
    shared pool stays alive after the per-request scope ends.
    """

    __slots__ = ("_base", "_headers")

    def __init__(self, base: httpx.AsyncClient, headers: dict[str, str]) -> None:
        self._base = base
        self._headers = headers

    # We expose only the verbs the integration layer uses. If a new
    # verb is needed, add it here and the type checker will catch it.
    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._base.get(url, headers=self._headers, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._base.post(url, headers=self._headers, **kwargs)

    async def put(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._base.put(url, headers=self._headers, **kwargs)

    async def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self._base.delete(url, headers=self._headers, **kwargs)

    @asynccontextmanager
    async def stream(
        self, method: str, url: str, **kwargs: Any
    ) -> AsyncIterator[httpx.Response]:
        """Streaming request — mirrors ``httpx.AsyncClient.stream``.

        Used by the SSE chat path (``chat_stream``). Yields the
        :class:`httpx.Response` so the caller can iterate
        ``response.aiter_lines()`` and friends.
        """
        async with self._base.stream(
            method, url, headers=self._headers, **kwargs
        ) as response:
            yield response

    async def aclose(self) -> None:
        # No-op: the connection pool is owned by the base client.
        return None


class _NullCM:
    """Async context manager used when no tracer is configured."""

    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *_exc: Any) -> None:
        return None


def _null_cm() -> "_NullCM":
    return _NullCM()


__all__ = ["LiteLLMBaseClient", "RBACClientGroup"]
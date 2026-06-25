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

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator
from uuid import UUID

import httpx

from app.core.config import settings
from app.core.logging import get_logger

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
        self._client: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------
    # Lifecycle — mirrors app/services/litellm_client.py:61-75
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "LiteLLMBaseClient":
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
            headers=_admin_headers(),
        )
        logger.debug("litellm_base.client_opened", base_url=self._base_url)
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
            logger.debug("litellm_base.client_closed")

    def _require_client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError(
                "LiteLLMBaseClient must be used as an async context manager "
                "before admin_client / chat_client can be accessed."
            )
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


__all__ = ["LiteLLMBaseClient"]
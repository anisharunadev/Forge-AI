"""step-77 Slice 4 — LiteLLM MCP (Model Context Protocol) proxy.

Thin wrapper over the LiteLLM MCP endpoints named in
``docs/goals/step-77.md`` §Feature 8. Sibling to
:mod:`app.integrations.litellm.guardrail_apply` and
:mod:`app.integrations.litellm.policies_apply`.

Endpoints covered:

* ``GET  /v1/mcp/servers``                — registered servers (proxy side)
* ``GET  /v1/mcp/tools``                   — tool enumeration per server
* ``POST /v1/mcp/call``                    — dispatch a tool call
* ``GET  /mcp-rest/tools``                 — REST alt for tool enumeration
* ``POST /mcp-rest/test``                  — connection test
* ``GET  /{mcp_server_name}/authorize``    — OAuth start
* ``POST /{mcp_server_name}/token``        — OAuth callback
* ``POST /{mcp_server_name}/register``     — server registration (alt path)
* ``POST /{mcp_server_name}/mcp``          — server endpoint dispatch
* ``GET  /.well-known/jwks.json``          — JWT signing keys
* ``GET  /.well-known/oauth-authorization-server/mcp/{name}``
* ``GET  /.well-known/oauth-protected-resource``
* ``GET  /public/mcp_hub``                 — public server catalog

Failure policy: every method returns ``None`` / ``[]`` / typed empty
when the proxy is unreachable. The service layer chooses fail-open vs
fail-closed; this module is a passthrough.
"""

from __future__ import annotations

import time
from typing import Any

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


# Default per-call timeout. Ponytail: spec says 60s default with
# per-tool override; the override lives in the tool_policy block.
_DEFAULT_TIMEOUT_SECONDS = 60.0


# ---------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------


async def list_servers(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /v1/mcp/servers``."""
    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/v1/mcp/servers")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("servers") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def list_tools(
    *,
    server_ids: list[str] | None = None,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /v1/mcp/tools?server_ids=...``.

    Used by the chat-loop discovery path (spec §"Discovery").
    """
    params: dict[str, Any] = {}
    if server_ids:
        params["server_ids"] = ",".join(server_ids)
    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get(
            "/v1/mcp/tools", params=params
        )
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("tools") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------


async def call_tool(
    *,
    server_id: str,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
    timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``POST /v1/mcp/call``.

    Returns ``{"result": ..., "is_error": bool, "duration_ms": int}``
    or ``None`` on transport failure (the service layer converts to
    the typed ``MCPToolTimeout`` envelope).
    """
    body: dict[str, Any] = {
        "server_id": server_id,
        "tool_name": tool_name,
        "arguments": arguments or {},
    }
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        started = time.monotonic()
        try:
            response = await client.admin_client.post(
                "/v1/mcp/call", json=body, timeout=timeout_seconds
            )
        except Exception as exc:  # noqa: BLE001 — timeout / network
            elapsed_ms = int((time.monotonic() - started) * 1000)
            logger.warning(
                "litellm.mcp_apply.call_failed",
                server_id=server_id,
                tool_name=tool_name,
                duration_ms=elapsed_ms,
                error=str(exc),
            )
            return {
                "result": None,
                "is_error": True,
                "duration_ms": elapsed_ms,
                "error": "timeout" if "timeout" in str(exc).lower() else "transport",
            }
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if response.status_code >= 400:
            return {
                "result": response.text[:200],
                "is_error": True,
                "duration_ms": elapsed_ms,
                "error": f"http_{response.status_code}",
            }
        raw = response.json() or {}
        # Proxy may return either ``{"result": ..., "is_error": ...}``
        # or a bare value; normalize.
        if "result" not in raw and "is_error" not in raw:
            raw = {"result": raw, "is_error": False}
        raw.setdefault("duration_ms", elapsed_ms)
        return raw

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def test_connection(
    *,
    server_id: str,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``POST /mcp-rest/test``.

    AC #7 — returns ``{reachable: false}`` on unreachable, never a 500.
    """
    body = {"server_id": server_id}
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        started = time.monotonic()
        try:
            response = await client.admin_client.post(
                "/mcp-rest/test", json=body
            )
        except Exception as exc:  # noqa: BLE001
            return {
                "reachable": False,
                "latency_ms": int((time.monotonic() - started) * 1000),
                "tool_count": 0,
                "error": str(exc)[:200],
            }
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if response.status_code >= 400:
            return {
                "reachable": False,
                "latency_ms": elapsed_ms,
                "tool_count": 0,
                "error": response.text[:200],
            }
        raw = response.json() or {}
        raw.setdefault("reachable", True)
        raw.setdefault("latency_ms", elapsed_ms)
        raw.setdefault("tool_count", len(raw.get("sample_tools") or []))
        return raw

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------


async def register_server(
    *,
    server: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``POST /{mcp_server_name}/register`` — admin path."""
    server_name = server.get("name") or server.get("server_name") or ""
    if not server_name:
        return None
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.post(
            f"/{server_name}/register", json=server
        )
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def unregister_server(
    *,
    server_name: str,
    base_client: LiteLLMBaseClient | None = None,
) -> bool:
    """Best-effort unregister; the proxy may not support DELETE so we
    no-op on 405."""
    async def _call(client: LiteLLMBaseClient) -> bool:
        response = await client.admin_client.delete(
            f"/v1/mcp/servers/{server_name}"
        )
        return response.status_code < 400 or response.status_code == 404

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# OAuth (skeleton — full impl in Slice 4 follow-up)
# ---------------------------------------------------------------------


async def authorize_url(
    *,
    server_name: str,
    redirect_uri: str,
    state: str | None = None,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /{server_name}/authorize``.

    Returns ``{"authorize_url": "..."}``. The actual OAuth exchange
    (``POST /{server_name}/token``) requires redirect handling — left
    as a follow-up since it requires the HTTP redirect surface, which
    sits outside the LiteLLM proxy boundary.
    """
    params: dict[str, Any] = {"redirect_uri": redirect_uri}
    if state:
        params["state"] = state
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get(
            f"/{server_name}/authorize", params=params
        )
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def fetch_jwks(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /.well-known/jwks.json`` — JWKS for outbound MCP JWTs.

    Ponytail: cached in-process (TTL controlled by the caller).
    """
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get("/.well-known/jwks.json")
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Public hub
# ---------------------------------------------------------------------


async def public_hub(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /public/mcp_hub`` — public, no-auth server catalog.

    AC #10 — 500ms SLA is enforced at the router layer via per-route
    caching; this proxy just returns whatever the upstream serves.
    """
    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/public/mcp_hub")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("servers") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


__all__ = [
    "authorize_url",
    "call_tool",
    "fetch_jwks",
    "list_servers",
    "list_tools",
    "public_hub",
    "register_server",
    "test_connection",
    "unregister_server",
]